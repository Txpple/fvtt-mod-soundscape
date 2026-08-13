// Headless proof of the unified scheduler (design.md first-session checklist, step 2).
// Feeds the engine a fake driver with a virtual audio clock and asserts the timeline:
// interval gaps inside ± variation, no-repeat draws, seamless loop coverage, self-crossfade,
// gate flips, and combat ducking. Run: node tools/test-engine.mjs
import {
  IntervalScheduler,
  LoopScheduler,
  SoundscapeEngine,
  drawNext,
  drawOrder,
  rollGap,
  rollVolume,
  rollRate,
  gateAllows,
  normalizeSet,
} from "../scripts/engine.js";

/* ---------------------------------- fake driver ---------------------------------- */

class FakeSound {
  constructor(src, driver, duration) {
    this.src = src;
    this.driver = driver;
    this.duration = duration;
    this.startedAt = null;
    this.stoppedAt = null;
    this.ramps = [];
  }
  async start({ volume = 1, rate = 1 } = {}) {
    this.startedAt = this.driver.t;
    this.volume = volume;
    this.rate = rate;
    this.driver.events.push({ t: this.driver.t, type: "start", src: this.src, volume, rate });
  }
  rampTo(volume, seconds, shape) {
    this.ramps.push({ t: this.driver.t, volume, seconds, shape });
    this.driver.events.push({ t: this.driver.t, type: "ramp", src: this.src, volume, seconds, shape });
  }
  stop(after = 0) {
    const at = this.driver.t + after;
    if (this.stoppedAt === null || at < this.stoppedAt) this.stoppedAt = at;
    this.driver.events.push({ t: this.driver.t, type: "stop", src: this.src, at });
  }
  /** Sounding at time t: started, not yet stopped, not past its natural end. A pitched
   *  member plays at `rate`, so its wall-clock length is duration/rate. */
  soundingAt(t) {
    if (this.startedAt === null || t < this.startedAt) return false;
    if (this.stoppedAt !== null && t >= this.stoppedAt) return false;
    return t < this.startedAt + this.duration / (this.rate || 1);
  }
}

class FakeDriver {
  constructor({ durations = {}, defaultDuration = 6, seed = 42, broken = new Set() } = {}) {
    this.t = 0;
    this.timers = new Map();
    this.nextId = 1;
    this.events = [];
    this.sounds = [];
    this.durations = durations;
    this.defaultDuration = defaultDuration;
    this.broken = broken;
    this._seed = seed;
    this.random = this.random.bind(this);
  }
  now() { return this.t; }
  random() { // deterministic LCG
    this._seed = (this._seed * 1664525 + 1013904223) % 4294967296;
    return this._seed / 4294967296;
  }
  schedule(fn, seconds) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + Math.max(seconds, 0), fn });
    return id;
  }
  cancel(id) { this.timers.delete(id); }
  async spawn(src) {
    if (this.broken.has(src)) throw new Error(`broken file ${src}`);
    const sound = new FakeSound(src, this, this.durations[src] ?? this.defaultDuration);
    this.sounds.push(sound);
    return sound;
  }
  /** Advance the virtual clock, firing timers in order and draining microtasks between. */
  async advanceTo(target) {
    for (;;) {
      let earliest = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (!earliest || timer.at < earliest.timer.at)) earliest = { id, timer };
      }
      if (!earliest) break;
      this.timers.delete(earliest.id);
      this.t = earliest.timer.at;
      earliest.timer.fn();
      // Drain the async chains (spawn → begin → arm) before firing the next timer.
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
    this.t = target;
  }
}

/* ------------------------------------ harness ------------------------------------ */

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

/* --------------------------------- pure helpers ---------------------------------- */

console.log("pure helpers");
{
  const d = new FakeDriver();
  let repeat = false;
  let last = -1;
  for (let i = 0; i < 500; i++) {
    const n = drawNext(4, last, d.random);
    if (n === last) repeat = true;
    if (n < 0 || n > 3) repeat = true;
    last = n;
  }
  check("drawNext never repeats in a pool of 4", !repeat);
  check("drawNext is identity for a pool of 1", drawNext(1, 0, d.random) === 0);

  let inRange = true;
  for (let i = 0; i < 500; i++) {
    const g = rollGap(25, 5, d.random);
    if (g < 20 || g > 30) inRange = false;
  }
  check("rollGap stays inside interval ± variation", inRange);
  check("rollGap floors at 0.5s", rollGap(1, 3600, () => 0) === 0.5);

  check("gate: always admits day", gateAllows({ whenToPlay: "always" }, 0));
  check("gate: night blocks day", !gateAllows({ whenToPlay: "night" }, 0.2));
  check("gate: night admits darkness 0.5", gateAllows({ whenToPlay: "night" }, 0.5));
  check("gate: day blocks night", !gateAllows({ whenToPlay: "day" }, 0.9));

  const n = normalizeSet({ interval: "nope", volume: 7, whenToPlay: "dusk", files: ["a", 3, "", "b"] });
  check("normalizeSet repairs garbage", n.interval === 25 && n.volume === 1 && n.whenToPlay === "always" && n.files.length === 2);
  check("normalizeSet clamps variation to interval", normalizeSet({ interval: 10, intervalVariation: 50 }).intervalVariation === 10);
}

/* --------------------------------- interval sets --------------------------------- */

console.log("interval scheduler");
{
  const d = new FakeDriver({ defaultDuration: 3 });
  const set = normalizeSet({ name: "Animal Cries", files: ["c1", "c2", "c3", "c4"], interval: 25, intervalVariation: 5, volume: 0.8 });
  const s = new IntervalScheduler(d, set);
  s.start();
  await d.advanceTo(600);
  s.stop();

  const starts = d.events.filter(e => e.type === "start");
  check("fires repeatedly over 10 minutes", starts.length >= 18, `${starts.length} fires`);
  check("first fire lands within one interval (stagger)", starts[0].t <= 25, `t=${starts[0].t}`);
  let gapsOk = true;
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i].t - starts[i - 1].t;
    if (gap < 20 - 0.01 || gap > 30 + 0.01) gapsOk = false;
  }
  check("every gap inside 25 ± 5 s", gapsOk);
  check("no file twice in a row", starts.every((e, i) => i === 0 || e.src !== starts[i - 1].src));
  check("one-shots play at set volume", starts.every(e => e.volume === 0.8));
}

console.log("interval scheduler — ducking and broken files");
{
  const d = new FakeDriver({ defaultDuration: 3, broken: new Set(["bad"]) });
  const set = normalizeSet({ name: "Wolves", files: ["howl", "bad"], interval: 10, intervalVariation: 0 });
  const s = new IntervalScheduler(d, set);
  s.start();
  await d.advanceTo(100);
  const before = d.events.filter(e => e.type === "start").length;
  check("broken file skipped, playable pool still fires", before >= 8, `${before} fires`);
  check("broken file never started", d.events.every(e => e.type !== "start" || e.src !== "bad"));
  s.setDucked(true);
  await d.advanceTo(200);
  const during = d.events.filter(e => e.type === "start").length;
  check("ducked: one-shots stop firing", during === before, `${during - before} fired while ducked`);
  s.setDucked(false);
  await d.advanceTo(300);
  const after = d.events.filter(e => e.type === "start").length;
  check("unducked: firing resumes", after > during);
  s.stop();
}

/* ----------------------------------- loop sets ----------------------------------- */

console.log("loop scheduler — single file self-crossfade");
{
  const d = new FakeDriver({ durations: { frogs: 30 } });
  const set = normalizeSet({ name: "Frogs", files: ["frogs"], playStyle: "loop", crossfade: 4, volume: 0.6 });
  const s = new LoopScheduler(d, set);
  await s.start();
  await d.advanceTo(120);

  const starts = d.events.filter(e => e.type === "start");
  check("bed starts immediately", starts[0].t < 0.01);
  check("members chain: ~5 starts in 120s of 30s files", starts.length >= 4 && starts.length <= 6, `${starts.length}`);
  let seamOk = true;
  for (let i = 1; i < starts.length; i++) {
    const seam = starts[i].t - starts[i - 1].t;
    if (Math.abs(seam - 26) > 0.5) seamOk = false; // 30s file, 4s crossfade → next starts at 26
  }
  check("each member starts crossfade-early (26s seams)", seamOk);
  let covered = true;
  for (let t = 1; t < 115; t += 0.5) {
    if (!d.sounds.some(snd => snd.soundingAt(t))) covered = false;
  }
  check("no silent gap anywhere in the bed", covered);
  let overlapOk = true;
  for (const t of [27, 53, 79]) { // mid-crossfade instants
    if (d.sounds.filter(snd => snd.soundingAt(t)).length !== 2) overlapOk = false;
  }
  check("exactly two members sounding mid-crossfade", overlapOk);
  const ramps = d.events.filter(e => e.type === "ramp");
  check("every member fades in equal-power", ramps.some(r => r.shape === "in" && r.volume === 0.6));
  check("every member fades out to silence", ramps.some(r => r.shape === "out" && r.volume === 0));
  s.stop();
}

console.log("loop scheduler — multi-file evolving bed");
{
  const d = new FakeDriver({ durations: { a: 20, b: 25, c: 30 } });
  const set = normalizeSet({ name: "Night Chorus", files: ["a", "b", "c"], playStyle: "loop", crossfade: 4 });
  const s = new LoopScheduler(d, set);
  await s.start();
  await d.advanceTo(400);
  const starts = d.events.filter(e => e.type === "start");
  check("bed keeps evolving", starts.length >= 14, `${starts.length} members`);
  check("no member twice in a row", starts.every((e, i) => i === 0 || e.src !== starts[i - 1].src));
  let covered = true;
  for (let t = 1; t < 395; t += 0.5) {
    if (!d.sounds.some(snd => snd.soundingAt(t))) covered = false;
  }
  check("continuous coverage across mixed durations", covered);
  s.stop();
  await d.advanceTo(402);
  check("stop() fades the bed out", d.events.some(e => e.type === "ramp" && e.volume === 0 && e.t >= 400));
}

console.log("loop scheduler — ducking");
{
  const d = new FakeDriver({ durations: { wind: 30 } });
  const set = normalizeSet({ name: "Wind", files: ["wind"], playStyle: "loop", volume: 0.8 });
  const s = new LoopScheduler(d, set);
  await s.start();
  await d.advanceTo(10);
  s.setDucked(true);
  const duckRamp = d.events.at(-1);
  check("duck ramps the bed low, not silent", duckRamp.type === "ramp" && Math.abs(duckRamp.volume - 0.12) < 1e-9, JSON.stringify(duckRamp));
  s.setDucked(false);
  const upRamp = d.events.at(-1);
  check("unduck restores full volume", upRamp.type === "ramp" && upRamp.volume === 0.8);
  check("unduck fades back slowly (5s crossfade feel)", upRamp.seconds === 5, `${upRamp.seconds}s`);
  s.stop();
}

/* ------------------------------ volume & pitch variation ------------------------- */

console.log("variations — rolls and integration");
{
  const d = new FakeDriver();
  const vset = normalizeSet({ volume: 0.8, volumeVariation: 0.5 });
  let vOk = true;
  for (let i = 0; i < 500; i++) {
    const v = rollVolume(vset, d.random);
    if (v < 0.4 - 1e-9 || v > 0.8 + 1e-9) vOk = false;
  }
  check("rollVolume attenuates only, inside volume·(1−variation)..volume", vOk);
  const pset = normalizeSet({ pitchVariation: 1 });
  let rOk = true;
  for (let i = 0; i < 500; i++) {
    const r = rollRate(pset, d.random);
    if (r < 0.5 - 1e-9 || r > 2 + 1e-9) rOk = false;
  }
  check("rollRate spans 0.5–2 at one octave", rOk);
  check("rollRate is exactly 1 with no variation", rollRate(normalizeSet({}), d.random) === 1);
}

{
  const d = new FakeDriver({ defaultDuration: 3 });
  const set = normalizeSet({
    name: "Varied Cries", files: ["a", "b", "c"], interval: 8, intervalVariation: 0,
    volume: 0.8, volumeVariation: 0.5, pitchVariation: 0.5,
  });
  const s = new IntervalScheduler(d, set);
  s.start();
  await d.advanceTo(400);
  s.stop();
  const starts = d.events.filter(e => e.type === "start");
  const lo = 2 ** -0.5, hi = 2 ** 0.5;
  check("interval fires carry jittered volumes in range",
    starts.every(e => e.volume >= 0.4 - 1e-9 && e.volume <= 0.8 + 1e-9) &&
    new Set(starts.map(e => e.volume)).size > 1);
  check("interval fires carry jittered rates in range",
    starts.every(e => e.rate >= lo - 1e-9 && e.rate <= hi + 1e-9) &&
    new Set(starts.map(e => e.rate)).size > 1);
}

{
  const d = new FakeDriver({ durations: { wind: 30 } });
  const set = normalizeSet({ name: "Wind", files: ["wind"], playStyle: "loop", crossfade: 4, pitchVariation: 1 });
  const s = new LoopScheduler(d, set);
  await s.start();
  await d.advanceTo(300);
  const starts = d.events.filter(e => e.type === "start");
  check("pitched bed keeps chaining", starts.length >= 5, `${starts.length} members`);
  check("bed members carry varied rates", new Set(starts.map(e => e.rate)).size > 1);
  let covered = true;
  for (let t = 1; t < 295; t += 0.5) {
    if (!d.sounds.some(snd => snd.soundingAt(t))) covered = false;
  }
  check("no silent gap despite pitch-scaled member lengths", covered);
  s.stop();
}

/* ------------------------------------- engine ------------------------------------ */

console.log("engine — gates, N sets, resync");
{
  const d = new FakeDriver({ durations: { crickets: 30, farm1: 5, farm2: 5, howl1: 8, howl2: 8 } });
  const engine = new SoundscapeEngine(d);
  const sets = [
    { id: "farm", name: "Farm", files: ["farm1", "farm2"], interval: 20, intervalVariation: 5 },
    { id: "howls", name: "Howls", files: ["howl1", "howl2"], interval: 40, intervalVariation: 15, whenToPlay: "night" },
    { id: "crickets", name: "Crickets", files: ["crickets"], playStyle: "loop", whenToPlay: "night" },
    { id: "off", name: "Disabled", files: ["farm1"], active: false },
    { id: "empty", name: "No files" },
  ];
  engine.sync(sets, 0.1); // daytime
  check("day: only the ungated set runs", engine.schedulers.size === 1 && engine.schedulers.has("farm"));
  await d.advanceTo(120);
  check("farm set is firing", d.events.some(e => e.type === "start" && e.src.startsWith("farm")));
  check("night sets silent during the day", !d.events.some(e => e.type === "start" && (e.src.startsWith("howl") || e.src === "crickets")));

  engine.setDarkness(0.8); // GM slides the sun down
  check("night: all three run, farm untouched", engine.schedulers.size === 3);
  await d.advanceTo(300);
  check("crickets bed came up with the dark", d.events.some(e => e.type === "start" && e.src === "crickets" && e.t >= 120));
  check("howls fire at night", d.events.some(e => e.type === "start" && e.src.startsWith("howl")));

  engine.setDarkness(0.2); // dawn
  check("dawn: night sets stopped, farm survives", engine.schedulers.size === 1 && engine.schedulers.has("farm"));

  engine.setDucked(true);
  const n = d.events.filter(e => e.type === "start").length;
  await d.advanceTo(400);
  check("engine duck silences interval fires", d.events.filter(e => e.type === "start").length === n);
  engine.setDucked(false);

  engine.sync([], 0.2);
  check("resync to empty stops everything", engine.schedulers.size === 0);
  const n2 = d.events.filter(e => e.type === "start").length;
  await d.advanceTo(600);
  check("nothing fires after teardown", d.events.filter(e => e.type === "start").length === n2);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
