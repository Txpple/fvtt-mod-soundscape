# Open Roll 5e: Soundscape

A Foundry VTT module that gives each scene its own background sound. Foundry's ambient sounds are
positional single-file loops, and playlists have no idea of silence between tracks, so there is no
native way to say "a crow, then quiet, then a distant dog". Soundscape adds sound sets to a scene:
pools of small audio files that either fire at random with silence in between or play as a
continuous, seamless bed.

## How it works

- **Interval sets fire random one-shots.** A random file from the pool plays, then *interval ±
  variation* seconds of silence pass before the next. The same file never plays twice in a row.
- **Loop sets play a continuous bed.** Each file overlaps the next under an equal-power crossfade.
  A single file loops into itself with no loop points to author, and several files become a
  slowly shifting chorus that never cuts.
- **Sets stack.** A scene can carry any number of them: farm animals on one clock, wolf howls on
  another, crickets looping underneath.
- **Each play can vary.** Volume can drop at random (never rise above the set's level) and pitch
  can shift up or down by up to an octave, so a repeated cry rarely sounds the same twice.
- **Sets can follow the time of day.** A set can play always, only by day or only by night, judged
  by the scene's darkness crossing 0.5. Moving the darkness slider starts and stops them live.
- **Combat quiets the scene.** When a combat starts, interval sets fall silent and loop sets drop
  low. Loops fade back up when the combat ends, and interval sets resume.
- **Sound plays through the Ambient channel**, so each player's existing volume slider applies.
- **Every client plays for itself.** Each client reads the scene and schedules its own sounds, with
  no sockets and no server state. Two players hearing the owl a few seconds apart is intended.

## Installation

Paste the manifest URL into Foundry's *Install Module* dialog:

```
https://github.com/Txpple/fvtt-mod-soundscape/releases/latest/download/module.json
```

Requires Foundry VTT v13 or v14. The module works with any game system and has no dependencies.

## Setting up a scene

Open a scene's configuration and go to the **Soundscape** tab. It lists the scene's sound sets with
their style, file count, timing and day or night gate, and each row has an on/off toggle, an edit
button and a delete button that asks first.

- **Add Blank Set** creates an empty set and opens its editor.
- **Add from Library** clones a prebuilt set from the sound library (see below) onto the scene,
  ready to play and editable like any other.

The editor covers one set: name, active, play style, interval and variation (or crossfade for a
loop), volume, volume variation, pitch variation, when to play, and the file list. Each file can be
played in place before you commit. Edits are kept in the window until **Save Changes**; closing
without saving discards them. A set with no files stays silent.

**Add Sound…** opens a picker built for audio. Browse folders anywhere under Data, play any file in
place, filter by name, and add several files without the window closing.

Sounds start when a client views the scene and stop when it leaves. If a file is missing or broken,
it is logged and skipped, and the rest of the pool keeps playing.

## The sound library

The library is optional and not shipped with the module. It is a manifest at
`Data/soundscape-sfx/library.json` listing prebuilt sets (name, section, category, timing and file
paths) in the same shape the module stores on scenes. Sections are *Ambient Loops* and *Interval
Sounds*, and **Add from Library** drills Section, Category, then Set. Without a library the module
works fully from your own audio files; build one from any sounds you have the rights to use.

## Scripting

`game.modules.get("fvtt-mod-soundscape").api` exposes:

```js
api.getSets(scene);                 // the scene's sound sets, normalized
await api.upsertSet(scene, set);    // add or replace a set (matched by id)
await api.removeSet(scene, id);     // remove a set; true when one was removed
api.open(scene, setId);             // open a set's editor window
api.status();                       // { ducked, darkness, running: [set ids] } on this client
```

Sets live in the scene's `flags.fvtt-mod-soundscape.sets`. Malformed values are repaired to safe
defaults, never thrown on.

## License

MIT. See [LICENSE](LICENSE).
