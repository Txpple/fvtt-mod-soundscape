# Soundscape — design (binding)

Owner-authored scope, decided 2026-08-12. This document is the north star for the module:
when in doubt, the answer that keeps Soundscape *smaller* is the right one.

## Mission

Bring **area sounds** to Foundry scenes: a per-scene list of small mp3/wav one-shots that
fire at randomized intervals (a crow, silence, a distant dog, silence…) plus seamless
ambient beds (frogs, crickets, wind). Foundry has nothing in this shape — AmbientSound
placeables are positional single-file loops, and Playlists have no concept of *silence
with variation* between sounds. That gap is the whole module.

## Scope — locked

One feature: per-scene **sound sets**, each a pool of audio files with a play style.
**That's it.**

A scene carries **N sets, no cap** — farm animals on one interval clock, wolf howls on
another, a cricket bed looping underneath, all stacked at once. Each set is an independent
scheduler; N of them cost a timer and ≤2 audio nodes apiece, so the ceiling is aesthetic
(mud past ~6 layers), never technical.

1. **Interval sets** — a pool of one-shots; play a random member, wait
   `interval ± variation` seconds of silence, repeat.
2. **Loop sets** — a continuous bed built from the same pool machinery (see *The unified
   engine* below). One file or many; never a hard cut, never a gap.

### Explicit non-goals

- **No positional interval sounds** — native AmbientSound placeables own "the waterfall is
  *here*". Soundscape sets are scene-global by design.
- **No sequences / sequential order** — random only (owner call, 2026-08-12).
- **No client synchronization** — deliberate. Random atmosphere sounds *better*
  per-client (two players hearing the crow 3 s apart is nature, not a bug), and it
  deletes the entire socket/GM-proxy problem class. Zero sockets in this module.
- **No clock-hours grid** — no 24-checkbox "specific hours" scheduling. Day/night gating
  is a darkness-level threshold (see below), not a calendar integration.
- **No playlist integration** — Playlists stay the music system; Soundscape never touches
  them.
- **No per-file volume mixing UI** — one volume per set. Normalize the assets instead.

## The unified engine (the one clever idea)

Interval and Loop are **the same scheduler with one parameter flipped**: the gap between
pool members.

- **Interval set:** gap **> 0** — silence of `interval ± variation` seconds between
  randomly drawn pool members.
- **Loop set:** gap **< 0** — the next randomly drawn member starts *before* the current
  one ends, overlapped under an **equal-power crossfade** (`crossfade` seconds, default 4).

Everything falls out of that:

- **A single-file loop set self-crossfades** — the file's tail fades into its own head.
  This makes *any* ambience file seamless, no loop-point authoring required. That is the
  killer practical win: every freesound.org frog recording becomes a perfect loop.
- **A multi-file loop set becomes an evolving bed** — the chorus drifts between variants
  over minutes, never repeating exactly, never cutting. Free of charge.
- Random draw is **no-repeat** (never the same member twice in a row) for pools > 1.
- One engine ≈ one code path to test. `playStyle` is stored for the UI's radio buttons,
  but at runtime it only selects the gap sign.

## Data shape — flags-only (family convention)

Everything lives on the Scene document; MCP-authorable by construction.

```js
flags["fvtt-mod-soundscape"].sets = [
  {
    id: "a1b2c3",             // random id, stable across edits
    name: "Animal Cries Day",
    active: true,
    files: ["worlds/my-world/sounds/crow-1.ogg", ...],   // 1..n paths
    playStyle: "interval",     // "interval" | "loop"
    interval: 25,              // seconds of silence (interval style only)
    intervalVariation: 5,      //   ± seconds
    crossfade: 4,              // overlap seconds (loop style only)
    volume: 0.8,               // 0..1, multiplied under the Ambient channel slider
    whenToPlay: "always"       // "always" | "day" | "night"
  }
]
```

`whenToPlay` gates on the scene's **darkness level** crossing 0.5 (day < 0.5 ≤ night) —
re-evaluated live on scene darkness updates, so a GM sliding the sun down hears the
crickets take over. Field is in the schema and wired from v1 (it's one comparison).

## Design principles

- **Client-side everything.** Each client reads the scene flags on `canvasReady`, runs its
  own schedulers, tears them down on scene switch / flag update (`updateScene` re-reads).
  No server state, no sockets, stateless like autoexplore.
- **Foundry's audio stack, not a parallel one.** `foundry.audio.Sound` on the **ambient
  audio context**, so the players' existing Ambient volume slider and the browser
  autoplay-unlock gate work untouched. Crossfades via the sound's gain node with
  equal-power (cos/sin) curves — `Sound#fade` is linear; equal-power is the audibly
  correct choice for overlapping beds and costs ~10 lines.
- **Schedule on the audio clock.** Crossfade timing uses `AudioContext.currentTime` and
  the decoded buffer duration, not naked `setTimeout` (which drifts in throttled tabs).
  One-shot gaps may use timers — a drifted crow is fine; a gapped frog chorus is not.
- **Preload, then stagger.** Pool files preload on scene ready; each set starts after a
  random initial delay (0..interval) so three interval sets don't all fire at t=0.
- **Play nice with combatplus.** While combat music is active, interval sets duck to
  silence and loop sets duck low (single hook pair on combat start/end). The two modules
  must never talk over each other.
- **Native UI or no UI.** Scene-config integration (the autoexplore precedent) with
  ApplicationV2 + Handlebars windows: the set list on the tab, a one-set editor with
  play-style radios and interval spinners, and an audio-first file picker with in-place
  preview. No Svelte/TyphonJS, no bundled UI runtime.
- **MCP-friendly by construction.** `game.modules.get("fvtt-mod-soundscape").api` with
  `getSets(scene)` / `upsertSet(scene, set)` / `removeSet(scene, id)` — so the molten5e
  bridge gets a `configure-soundscape` tool without UI scripting (new tool ⇒ CC restart,
  per convention).
- **Fail open, never destructive** (family convention): a missing file logs and skips its
  turn in the draw; a malformed set is ignored, never deleted.

## Conventions (family)

- House module **#6** under **Txpple** (public GitHub), sibling of openserver,
  autoexplore, combatplus, partystash, lootshelf.
- Module id `fvtt-mod-soundscape`, title **Soundscape**, MIT, author Matthew Sippel.
- Layout mirrors the family: `module.json` + `scripts/soundscape.js` (+ `templates/`,
  `styles/` for the config window). Release = manifest URL off GitHub releases.
- Compat pins (min v13 / verify on current, system-agnostic — no dnd5e dependency) set at
  first release against the live world's versions.

## First-session checklist

1. Scaffold `module.json` + entry script per family conventions.
2. Build the unified scheduler first (headless-testable: feed it a fake pool, assert the
   draw/gap/crossfade timeline). It is the module.
3. Wire scene lifecycle (canvasReady / updateScene / combat hooks) and the `api` object.
4. Config UI last (the one real window).
5. Deploy note (Molten-era): package registry is PROCESS-boot-scoped — a brand-new module
   needs `/setup installPackage`, not just a world bounce; never `game.shutDown()` through
   the bridge.
6. Asset pass is its own task: sourcing/normalizing the one-shot library (freesound et
   al.) may outweigh the code.
