# Soundscape

Atmospheric sound for the active scene in Foundry VTT. A scene carries any number of
**sound sets**, each a pool of small audio files with a play style:

- **Interval sets** fire a random file from the pool, then wait *interval ± variation*
  seconds of silence — the crow, the quiet, the distant dog that make a place feel alive.
- **Loop sets** play the pool as a continuous bed under equal-power crossfades. A single
  file loops seamlessly into itself with no loop-point authoring, and several files become
  a slowly evolving chorus that never repeats exactly and never cuts.

Sets stack — farm animals on one clock, wolf howls on another, crickets looping underneath
— and each can be varied per play in volume (randomly quieter, never louder) and pitch
(± up to an octave), so the same cry never sounds quite the same twice. Sets can be gated
to day or night by scene darkness, they quiet down automatically during combat (and fade
back in when it ends), and everything plays through the **Ambient** volume channel so
players' existing sliders apply.

Entirely client-side and stateless: each client reads the scene and schedules for itself.
No sockets, no dependencies, no bundled UI framework — and the unsynchronized randomness is
deliberate, because two players hearing the owl a few seconds apart is nature, not lag.

## GM quickstart

Open a scene's configuration → **Soundscape** tab. That's the whole interface:

- The tab lists the scene's sound sets — style, file count, timing, day/night gate — each
  with an **active toggle**, **edit**, and **delete** (confirmed) control.
- **Add from Library** picks a prebaked set from your sound library (see below): drill
  Section → Category → Set, and it lands on the scene ready to play, editable like any
  other set.
- **Add Blank Set** creates an empty set and opens its editor: name, play style,
  interval ± variation (or crossfade), volume, volume/pitch variation, when to play, and
  the file pool. Changes save with **Save Changes**; closing without saving discards.
- **Add Sound…** in the editor opens an audio-first file picker: browse folders, **play
  any file in place** before committing, filter by name, and add several files without the
  window closing.

Sounds start when a client is viewing the scene and stop when it leaves. Sliding the
scene's darkness across 0.5 starts and stops day/night-gated sets live.

## The sound library

The library is optional server-side content, deliberately not shipped with the module: a
manifest at `Data/soundscape-sfx/library.json` listing prebaked sets — name, section
(*Ambient Loops* / *Interval Sounds*), category, timing, and file paths — in the same
schema the module stores on scenes. If it exists, **Add from Library** offers it; if not,
the module works fully from your own audio files. Build it from any sounds you have the
rights to use.

## Scripting

`game.modules.get("fvtt-mod-soundscape").api` exposes:

```js
api.getSets(scene);                 // the scene's sound sets, normalized
await api.upsertSet(scene, set);    // add or replace a set (matched by id)
await api.removeSet(scene, id);
api.open(scene, setId);             // open a set's editor window
api.status();                       // { ducked, darkness, running: [set ids] } on this client
```

## Compatibility

System-agnostic. Foundry **v13+**, verified on v14. If an audio file is missing or broken
the engine logs it and plays the rest of the pool — it fails open, never silent when it
can help it.

## Installation

Install via manifest URL:

```
https://github.com/Txpple/fvtt-mod-soundscape/releases/latest/download/module.json
```

## License

MIT
