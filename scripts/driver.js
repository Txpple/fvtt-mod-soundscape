/**
 * Soundscape — the real audio driver behind the engine's driver contract.
 *
 * Everything plays through Foundry's ENVIRONMENT audio context, so the players' Ambient
 * volume slider and the browser autoplay-unlock gate apply untouched (design.md:
 * "Foundry's audio stack, not a parallel one").
 *
 * Ramps are equal-power (cos/sin curves on the gain AudioParam), because complementary
 * linear fades dip audibly at the crossfade midpoint. When the gain node isn't reachable
 * (or a running curve blocks new automation), we fall back to Sound#fade — linear, but
 * never broken.
 */

export class FoundryAudioDriver {
  get context() {
    return game.audio?.environment;
  }

  now() {
    const ctx = this.context;
    return ctx ? ctx.currentTime : performance.now() / 1000;
  }

  schedule(fn, seconds) {
    return setTimeout(fn, Math.max(seconds, 0) * 1000);
  }

  cancel(handle) {
    clearTimeout(handle);
  }

  random() {
    return Math.random();
  }

  async spawn(src) {
    const sound = new foundry.audio.Sound(src, { context: this.context });
    await sound.load();
    if (sound.failed || !(sound.duration > 0)) throw new Error(`could not load "${src}"`);
    return new FoundrySoundHandle(sound);
  }
}

class FoundrySoundHandle {
  constructor(sound) {
    this.sound = sound;
  }

  get duration() {
    return this.sound.duration ?? 0;
  }

  async start({ volume = 1, rate = 1 } = {}) {
    await this.sound.play({ volume });
    if (rate === 1) return;
    // Pitch shift = playback rate. Small files play through an AudioBufferSourceNode;
    // large ones stream through an HTMLAudioElement, which corrects pitch unless told not to.
    const node = this.sound.sourceNode;
    if (node?.playbackRate) node.playbackRate.value = rate;
    else if (this.sound.element) {
      this.sound.element.preservesPitch = false;
      this.sound.element.playbackRate = rate;
    }
  }

  /**
   * Equal-power ramp to `volume` over `seconds`. shape "in" follows sin(t·π/2), "out"
   * follows cos(t·π/2) — complementary pairs sum to constant power across a crossfade.
   */
  rampTo(volume, seconds, shape = "in") {
    const gain = this.sound.gainNode?.gain;
    const ctx = this.sound.context;
    if (gain && ctx) {
      try {
        const now = ctx.currentTime;
        const from = gain.value;
        if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
        else gain.cancelScheduledValues(now);
        const steps = 24;
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          curve[i] = shape === "out"
            ? volume + (from - volume) * Math.cos(t * Math.PI / 2)
            : from + (volume - from) * Math.sin(t * Math.PI / 2);
        }
        gain.setValueCurveAtTime(curve, now, Math.max(seconds, 0.05));
        return;
      } catch (err) {
        // A curve already in flight blocks new automation — linear fade is the safe exit.
      }
    }
    void this.sound.fade?.(volume, { duration: Math.max(seconds, 0.05) * 1000 });
  }

  stop(afterSeconds = 0) {
    const kill = () => void this.sound.stop();
    if (afterSeconds > 0) setTimeout(kill, afterSeconds * 1000);
    else kill();
  }
}
