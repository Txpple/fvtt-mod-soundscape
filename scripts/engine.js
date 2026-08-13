/**
 * Soundscape — the unified scheduler (design.md: "The unified engine").
 *
 * Interval and Loop are the same machine with one parameter flipped: the gap between pool
 * members. Interval sets have a positive gap — silence of `interval ± variation` seconds
 * between randomly drawn members. Loop sets have a negative gap — the next member starts
 * before the current one ends, overlapped under an equal-power crossfade. A single-file
 * loop set crossfades into itself, which makes any file a seamless loop.
 *
 * This file is deliberately free of Foundry globals so it runs headless under node
 * (tools/test-engine.mjs). All audio and clock access goes through a driver:
 *
 *   driver.now()                    → seconds on the audio clock
 *   driver.schedule(fn, seconds)    → timer handle          driver.cancel(handle)
 *   driver.random()                 → [0, 1)
 *   driver.spawn(src)               → Promise<handle>, loaded but not started; throws on
 *                                     a missing/broken file (fail open: we skip the draw)
 *
 * Sound handles: .duration, .start({volume}) → Promise, .rampTo(volume, seconds, shape),
 * .stop(afterSeconds).
 */

/** Loop sets duck to this fraction of their volume under combat music; interval sets duck to silence. */
export const DUCK_FACTOR = 0.15;

/** Ducking is asymmetric: get out of the music's way fast, come back like a crossfade. */
export const DUCK_FADE = 1;
export const UNDUCK_FADE = 5;

/**
 * The order to try pool members in: everything except the last-played, shuffled, with the
 * last-played appended as a final resort — a repeat beats silence when the rest of the pool
 * is broken, and it IS the design for a pool of one.
 */
export function drawOrder(poolSize, lastIndex, random) {
  const order = [...Array(poolSize).keys()].filter(i => i !== lastIndex);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (lastIndex >= 0 && lastIndex < poolSize) order.push(lastIndex);
  return order;
}

/** Draw a pool index, never the same twice in a row (pools > 1). */
export function drawNext(poolSize, lastIndex, random) {
  return drawOrder(poolSize, lastIndex, random)[0];
}

/** Silence gap for an interval set: interval ± variation, never under half a second. */
export function rollGap(interval, variation, random) {
  return Math.max(0.5, interval + (random() * 2 - 1) * variation);
}

/** Per-play volume: attenuate-only jitter — never louder than the set. */
export function rollVolume(set, random) {
  return set.volume * (1 - random() * (set.volumeVariation ?? 0));
}

/** Per-play playback rate: ± pitchVariation octaves, so 1 octave spans rate 0.5–2. */
export function rollRate(set, random) {
  const octaves = set.pitchVariation ?? 0;
  return octaves ? 2 ** ((random() * 2 - 1) * octaves) : 1;
}

/** Does this set's whenToPlay gate admit the current darkness? (day < 0.5 ≤ night) */
export function gateAllows(set, darkness) {
  if (set.whenToPlay === "always") return true;
  return (set.whenToPlay === "night") === (darkness >= 0.5);
}

/** Coerce an arbitrary flag blob into a valid set — malformed input is repaired, never thrown on. */
export function normalizeSet(raw = {}) {
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const interval = clamp(num(raw.interval, 25), 1, 3600);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : Math.random().toString(36).slice(2, 12),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "New Sound Set",
    active: raw.active !== false,
    files: Array.isArray(raw.files) ? raw.files.filter(f => typeof f === "string" && f) : [],
    playStyle: raw.playStyle === "loop" ? "loop" : "interval",
    interval,
    intervalVariation: clamp(num(raw.intervalVariation, 5), 0, interval),
    crossfade: clamp(num(raw.crossfade, 4), 0.5, 30),
    volume: clamp(num(raw.volume, 0.8), 0, 1),
    volumeVariation: clamp(num(raw.volumeVariation, 0), 0, 1),
    pitchVariation: clamp(num(raw.pitchVariation, 0), 0, 1),
    whenToPlay: ["day", "night"].includes(raw.whenToPlay) ? raw.whenToPlay : "always",
  };
}

/* -------------------------------------------------------------------------------------- */
/*  Interval sets — one-shots separated by silence                                        */
/* -------------------------------------------------------------------------------------- */

export class IntervalScheduler {
  constructor(driver, set, log = () => {}) {
    this.driver = driver;
    this.set = set;
    this.log = log;
    this.lastIndex = -1;
    this.running = false;
    this.ducked = false;
    this.timer = null;
    this.live = new Set(); // one-shots still sounding, so a scene switch can silence them
  }

  start() {
    this.running = true;
    // Stagger: a random first delay so several sets never all fire the moment a scene loads.
    this._arm(this.driver.random() * this.set.interval);
  }

  _arm(delay) {
    this.timer = this.driver.schedule(() => this._fire(), delay);
  }

  async _fire() {
    if (!this.running) return;
    // Re-arm before the (async) spawn so a slow file load never drifts the cadence.
    this._arm(rollGap(this.set.interval, this.set.intervalVariation, this.driver.random));
    if (this.ducked) return;
    for (const idx of drawOrder(this.set.files.length, this.lastIndex, this.driver.random)) {
      try {
        const handle = await this.driver.spawn(this.set.files[idx]);
        this.lastIndex = idx;
        if (!this.running || this.ducked) return handle.stop(0);
        const rate = rollRate(this.set, this.driver.random);
        void handle.start({ volume: rollVolume(this.set, this.driver.random), rate });
        this.live.add(handle);
        this.driver.schedule(() => this.live.delete(handle), (handle.duration || 10) / rate + 0.5);
        return;
      } catch (err) {
        this.log(`skipping unplayable file "${this.set.files[idx]}" in "${this.set.name}"`, err);
      }
    }
  }

  setDucked(ducked) {
    this.ducked = ducked;
    // A howl mid-flight when combat music slams in should get out of the way too.
    if (ducked) this._silenceLive(0.4);
  }

  _silenceLive(fade) {
    for (const handle of this.live) {
      handle.rampTo(0, fade, "out");
      handle.stop(fade + 0.1);
    }
    this.live.clear();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) this.driver.cancel(this.timer);
    this._silenceLive(0.4);
  }
}

/* -------------------------------------------------------------------------------------- */
/*  Loop sets — a continuous bed under equal-power crossfades                              */
/* -------------------------------------------------------------------------------------- */

export class LoopScheduler {
  constructor(driver, set, log = () => {}) {
    this.driver = driver;
    this.set = set;
    this.log = log;
    this.lastIndex = -1;
    this.running = false;
    this.ducked = false;
    this.timer = null;
    this.current = null; // { handle, startedAt, xf, effDur, base }
    this.next = null;    // prefetched member, loaded but not started
  }

  async start() {
    this.running = true;
    const first = await this._spawnDraw();
    if (!first) return void (this.running = false);
    await this._begin(first);
  }

  /** Draw + load the next member, skipping broken files; null when nothing in the pool plays. */
  async _spawnDraw() {
    for (const idx of drawOrder(this.set.files.length, this.lastIndex, this.driver.random)) {
      try {
        const handle = await this.driver.spawn(this.set.files[idx]);
        this.lastIndex = idx;
        return handle;
      } catch (err) {
        this.log(`skipping unplayable file "${this.set.files[idx]}" in "${this.set.name}"`, err);
      }
    }
    return null;
  }

  async _begin(handle) {
    if (!this.running) return handle.stop(0);
    // Pitch shift changes wall-clock length: a member at rate r lasts duration/r. All the
    // seam math below runs on this EFFECTIVE duration, or pitched-up members would gap.
    const rate = rollRate(this.set, this.driver.random);
    const base = rollVolume(this.set, this.driver.random);
    const effDur = (handle.duration || 1) / rate;
    // A crossfade longer than half the member would overlap three at once — clamp it.
    const xf = Math.min(this.set.crossfade, Math.max(effDur / 2, 0.25));
    await handle.start({ volume: 0, rate });
    if (!this.running) return handle.stop(0);
    handle.rampTo(base * (this.ducked ? DUCK_FACTOR : 1), xf, "in");
    this.current = { handle, startedAt: this.driver.now(), xf, effDur, base };
    // Prefetch the follow-up now, so the seam never waits on a network load.
    void this._spawnDraw().then(h => {
      if (!this.running) return h?.stop(0);
      this.next = h;
    });
    this._armSeam();
  }

  _armSeam() {
    const { startedAt, xf, effDur } = this.current;
    const fireIn = startedAt + effDur - xf - this.driver.now();
    this.timer = this.driver.schedule(() => this._seam(), Math.max(fireIn, 0.05));
  }

  _seam() {
    if (!this.running || !this.current) return;
    const { handle, startedAt, xf, effDur } = this.current;
    // Timers drift; the audio clock doesn't. Re-check and re-arm if we woke early.
    const remaining = startedAt + effDur - this.driver.now();
    if (remaining > xf + 0.1) return this._armSeam();
    const fade = Math.max(remaining, 0.1);
    handle.rampTo(0, fade, "out");
    handle.stop(fade + 0.2);
    const next = this.next;
    this.next = null;
    if (next) void this._begin(next);
    else void this._spawnDraw().then(h => (h ? this._begin(h) : (this.running = false)));
  }

  setDucked(ducked) {
    this.ducked = ducked;
    if (this.current) {
      this.current.handle.rampTo(
        this.current.base * (ducked ? DUCK_FACTOR : 1),
        ducked ? DUCK_FADE : UNDUCK_FADE,
        ducked ? "out" : "in",
      );
    }
  }

  stop() {
    this.running = false;
    if (this.timer !== null) this.driver.cancel(this.timer);
    if (this.current) {
      this.current.handle.rampTo(0, 0.8, "out");
      this.current.handle.stop(1);
      this.current = null;
    }
    this.next?.stop(0);
    this.next = null;
  }
}

/* -------------------------------------------------------------------------------------- */
/*  Engine — N independent schedulers per scene, gated by darkness, ducked under combat    */
/* -------------------------------------------------------------------------------------- */

export class SoundscapeEngine {
  constructor(driver, log = () => {}) {
    this.driver = driver;
    this.log = log;
    this.schedulers = new Map(); // set.id → scheduler
    this.sceneSets = [];
    this.darkness = 0;
    this.ducked = false;
  }

  /** Replace the running configuration with this scene's sets. */
  sync(rawSets, darkness) {
    this.stopAll();
    this.sceneSets = (Array.isArray(rawSets) ? rawSets : [])
      .map(normalizeSet)
      .filter(s => s.active && s.files.length);
    this.darkness = darkness;
    this._applyGates();
  }

  /** Darkness moved (GM slid the sun) — start/stop only the sets whose gate flipped. */
  setDarkness(darkness) {
    this.darkness = darkness;
    this._applyGates();
  }

  setDucked(ducked) {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    for (const s of this.schedulers.values()) s.setDucked(ducked);
  }

  _applyGates() {
    for (const set of this.sceneSets) {
      const should = gateAllows(set, this.darkness);
      const has = this.schedulers.has(set.id);
      if (should && !has) {
        const Cls = set.playStyle === "loop" ? LoopScheduler : IntervalScheduler;
        const scheduler = new Cls(this.driver, set, this.log);
        scheduler.setDucked(this.ducked);
        this.schedulers.set(set.id, scheduler);
        void scheduler.start();
      } else if (!should && has) {
        this.schedulers.get(set.id).stop();
        this.schedulers.delete(set.id);
      }
    }
  }

  stopAll() {
    for (const s of this.schedulers.values()) s.stop();
    this.schedulers.clear();
    this.sceneSets = [];
  }
}
