# Open Roll 5e: Area Sounds

A Foundry VTT module that gives each scene its own background sound. Foundry's ambient sounds are
positional single-file loops, and playlists have no idea of silence between tracks, so there is no
native way to say "a crow, then quiet, then a distant dog". Area Sounds adds sound sets to a scene:
pools of small audio files that either fire at random with silence in between or play as a
continuous, seamless bed, the way area sounds work in the Aurora toolset.

**Formerly Soundscape.** Version 2.0.0 renamed the module, because another Foundry package already
has that name. See [Moving from Soundscape](#moving-from-soundscape).

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
https://github.com/Txpple/fvtt-mod-areasounds/releases/latest/download/module.json
```

Requires Foundry VTT v13 or v14. The module works with any game system and has no dependencies.

## Moving from Soundscape

Worlds that ran **Open Roll 5e: Soundscape** (`fvtt-mod-soundscape`) keep their sound sets:

1. Install Area Sounds from the manifest URL above. Foundry treats it as a new module, so the old
   one does not update into it.
2. Enable Area Sounds and disable Soundscape, then uninstall Soundscape.
3. Load the world as a GM. Area Sounds moves every scene's sets across (from
   `flags.fvtt-mod-soundscape` to `flags.fvtt-mod-areasounds`) and says how many it moved. Until a
   GM loads the world, it reads the old sets, so players already hear them.

File paths are left as they were. A library you built under `Data/soundscape-sfx/` keeps working:
Area Sounds reads `soundscape-sfx/library.json` when `areasounds-sfx/library.json` is absent.

## Setting up a scene

Open a scene's configuration and go to the **Area Sounds** tab. It lists the scene's sound sets with
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
`Data/areasounds-sfx/library.json` listing prebuilt sets (name, section, category, timing and file
paths) in the same shape the module stores on scenes. Sections are *Ambient Loops* and *Interval
Sounds*, and **Add from Library** drills Section, Category, then Set. Without a library the module
works fully from your own audio files; build one from any sounds you have the rights to use.

## Scripting

`game.modules.get("fvtt-mod-areasounds").api` exposes:

```js
api.getSets(scene);                 // the scene's sound sets, normalized
await api.upsertSet(scene, set);    // add or replace a set (matched by id)
await api.removeSet(scene, id);     // remove a set; true when one was removed
api.open(scene, setId);             // open a set's editor window
api.status();                       // { ducked, darkness, running: [set ids] } on this client
```

Sets live in the scene's `flags.fvtt-mod-areasounds.sets`. Malformed values are repaired to safe
defaults, never thrown on. The Open Roll 5e dnd5e MCP server writes the same flags through its
`configure-area-sounds` tool, so a scene's sound can also be authored from Claude Code.

## Repository layout

```
module.json              the Foundry manifest
scripts/
  areasounds.js          the module's entry point
  store.js               where sets and the library live; the move from Soundscape
  engine.js              the scheduler: intervals, crossfaded loops, ducking, day and night
  driver.js              starts and stops the engine as clients view scenes
  config.js              the Area Sounds tab on the scene configuration and the set editor
  picker.js              the audio file picker
styles/  templates/      the tab, the editor and the picker
tools/
  test-engine.mjs        exercises the scheduling engine
  verify-areasounds.mjs  the live suite against the local sandbox
design.md                what was decided while building
```

## Development

There is no build step: the module is plain ES modules loaded straight from `scripts/`. The live
suite runs against the local sandbox through the house MCP repo (`fvtt-mcp-dnd5e`, a `file:` dev
dependency beside this one); run `npm install` once. Releases: bump `version` and the `download`
URL in `module.json` together, tag `vX.Y.Z`, and publish a zip of `module.json`, `README.md`,
`LICENSE`, `scripts/`, `styles/` and `templates/` with the manifest as a GitHub release.

<!-- openroll5e:family -->
## Part of Open Roll 5e

Soundscape is one of the Open Roll 5e modules for Foundry VTT, a suite built for one D&D 5e table and
shared. Each module installs and works on its own and none needs another; together they cover the
table from the fog of war to the loot. The other modules:

- [Open Roll 5e: Autoexplore](https://github.com/Txpple/fvtt-mod-autoexplore): lets a scene start fully explored, so the whole map shows through the fog of war while tokens still need line of sight.
- [Open Roll 5e: Battle Flow](https://github.com/Txpple/fvtt-mod-battleflow): combat automation for dnd5e 2024 rules: a hit rolls and applies its own damage, saves resolve themselves, reactions hold, and concentration is tracked. Every rule that touches a fight in the 2024 core books, Heroes of Faerûn, Arcana Unleashed and Ravenloft: The Horrors Within.
- [Open Roll 5e: Combat Plus](https://github.com/Txpple/fvtt-mod-combatplus): automates the chores of running a fight: combat music, an initiative gate, an out-of-turn movement block, defeated marking at 0 HP and turn alerts.
- [Open Roll 5e: Errata](https://github.com/Txpple/fvtt-mod-errata5e): corrects, in memory, bugs in the premium D&D 2024 books, the dnd5e system and Foundry itself, each fix held until the vendor ships its own.
- [Open Roll 5e: FX Studio](https://github.com/Txpple/fvtt-mod-fxstudio): visual and sound effects for dnd5e, played from what actually happened at the table, with about a thousand stock FX and a window for authoring your own.
- [Open Roll 5e: Loot Shelf](https://github.com/Txpple/fvtt-mod-lootshelf): loot chests and merchant shelves that players can take from, buy from and sell to without owning them, with a receipt for every trade.
- [Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver): for hosted worlds: clears the startup pause so players can play before the GM arrives, and gives any user a landing scene of their own.
- [Open Roll 5e: Party Stash](https://github.com/Txpple/fvtt-mod-partystash): makes a dnd5e Group actor's inventory a working party stash: drags move instead of copying, coin moves through a dialog, and every transfer posts a receipt.

Three MCP servers for [Claude Code](https://claude.com/claude-code) complete the suite:

- [fvtt-mcp-dnd5e](https://github.com/Txpple/fvtt-mcp-dnd5e): builds D&D 5e content in a live Foundry world from Claude Code: a stat block becomes a complete NPC, a map image a walled and lit scene, an adventure its journals, tables and handouts.
- [fvtt-mcp-imagegen](https://github.com/Txpple/fvtt-mcp-imagegen): makes the art with Google's Gemini image models: icons, tokens, props, portraits and illustrations, token redresses and restyles, battlemap and overland-map repaints, and the illustrated session records, all grounded in what the world already shows.
- [fvtt-mcp-sessionscribe](https://github.com/Txpple/fvtt-mcp-sessionscribe): turns a session's Discord recording and Foundry chat log into its record. Its end-to-end `session-scribe` skill drives the server from the Craig link to a speaker-labelled transcript, a fully illustrated player recap, combat statistics, GM notes and a party snapshot.

Issues are welcome on every repo in the family; pull requests are not accepted, since each is one
author's design for one table, shared because it might suit yours. How they fit together is mapped in [fvtt-suite-openroll5e](https://github.com/Txpple/fvtt-suite-openroll5e).
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
