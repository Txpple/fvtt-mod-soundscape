/**
 * Area Sounds — where the sets live, and the move from the module's old name.
 *
 * Until 2.0.0 the module was `fvtt-mod-soundscape` and its sets sat in
 * `flags.fvtt-mod-soundscape.sets`. Reads fall back to that scope so a scene sounds right
 * before the GM's first load; that load moves every world scene across for good
 * (migrateWorld). File paths are never rewritten: they point at the world's own audio,
 * wherever it was put.
 */

export const MODULE_ID = "fvtt-mod-areasounds";
const LEGACY_ID = "fvtt-mod-soundscape";

/**
 * An optional template library: a Data-root manifest of prebaked sets (name, category, and
 * the full set schema with files pointing at uploaded audio). Lives OUTSIDE the module
 * folder on purpose — installPackage clean-reinstalls modules/<id>/ on every update. Before
 * 2.0.0 the suggested folder was `soundscape-sfx/`; it is still read when the new one is absent.
 */
export const LIBRARY_PATH = "areasounds-sfx/library.json";
const LEGACY_LIBRARY_PATH = "soundscape-sfx/library.json";

const legacySets = scene => scene?.flags?.[LEGACY_ID]?.sets;

/** The raw sets array on a scene (plain flags read — no getFlag scope dance). */
export const getRawSets = scene => scene?.flags?.[MODULE_ID]?.sets ?? legacySets(scene) ?? [];

/** True when a scene change touches the sets, under either name. */
export const touchesSets = changes =>
  foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ||
  foundry.utils.hasProperty(changes, `flags.${LEGACY_ID}`);

/**
 * Move every world scene's sets from the old scope to this one, the old scope removed in the
 * same update. Active GM only. A scene that already has sets under the new name keeps them,
 * and its old scope is left alone (nothing is thrown away unread).
 */
export async function migrateWorld(log) {
  if (!game.users.activeGM?.isSelf) return;
  if (game.modules.get(LEGACY_ID)?.active) {
    ui.notifications?.warn(
      "Area Sounds is the new name of Soundscape, which is still enabled in this world. Disable Soundscape so scenes do not play twice.",
      { permanent: true }
    );
  }
  let moved = 0;
  for (const scene of game.scenes) {
    const old = legacySets(scene);
    if (old === undefined) continue;
    if (scene.flags?.[MODULE_ID]?.sets) {
      log(`"${scene.name}" has sets under both names; kept the new ones and left the old scope`);
      continue;
    }
    try {
      await scene.update({ [`flags.${MODULE_ID}.sets`]: old, [`flags.-=${LEGACY_ID}`]: null });
      moved++;
    } catch (err) {
      log(`could not move the sets of "${scene.name}" from Soundscape`, err);
    }
  }
  if (moved) {
    ui.notifications?.info(
      `Area Sounds: moved the sound sets of ${moved} scene${moved === 1 ? "" : "s"} from Soundscape.`
    );
  }
}

let libraryCache;

/** The template library manifest, or null when there is none. */
export async function loadLibrary() {
  if (libraryCache !== undefined) return libraryCache;
  libraryCache = null;
  for (const path of [LIBRARY_PATH, LEGACY_LIBRARY_PATH]) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (res.ok) {
        libraryCache = await res.json();
        break;
      }
    } catch {
      // try the next location
    }
  }
  return libraryCache;
}
