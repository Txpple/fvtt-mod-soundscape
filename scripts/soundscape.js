/**
 * Soundscape — atmospheric area sounds for Foundry scenes.
 *
 * A scene carries N sound sets in `flags.fvtt-mod-soundscape.sets` (see design.md for the
 * binding scope). Each active set runs its own client-side scheduler: interval sets fire
 * random one-shots separated by `interval ± variation` seconds of silence; loop sets play a
 * continuous bed under equal-power crossfades. Everything is client-side and stateless —
 * each client reads the flags and schedules for itself; unsynchronized randomness is a
 * feature, not a bug.
 */

import { SoundscapeEngine, normalizeSet } from "./engine.js";
import { FoundryAudioDriver } from "./driver.js";
import {
  SoundscapeSetConfig,
  addFromLibrary,
  createBlankSet,
  deleteSetWithConfirm,
} from "./config.js";

export const MODULE_ID = "fvtt-mod-soundscape";

const log = (msg, err) => console.warn(`${MODULE_ID} | ${msg}`, err ?? "");
const engine = new SoundscapeEngine(new FoundryAudioDriver(), log);

/** The raw sets array on a scene (plain flags read — no getFlag scope dance). */
export const getRawSets = scene => scene?.flags?.[MODULE_ID]?.sets ?? [];

/** Scene darkness on v14's environment path, with the legacy fallback. */
const darknessOf = scene => scene?.environment?.darknessLevel ?? scene?.darkness ?? 0;

/** Combat music is (about to be) playing when the viewed scene's combat has started. */
const combatActive = () => !!game.combat?.started;

function syncToCanvas() {
  const scene = canvas?.scene;
  if (!scene) return engine.stopAll();
  engine.setDucked(combatActive());
  engine.sync(getRawSets(scene), darknessOf(scene));
}

/* -------------------------------------------------------------------------------------- */
/*  Lifecycle                                                                             */
/* -------------------------------------------------------------------------------------- */

Hooks.on("canvasReady", async () => {
  // The browser's autoplay gate: wait for Foundry's first-gesture unlock before scheduling.
  await game.audio?.unlock;
  syncToCanvas();
});

Hooks.on("canvasTearDown", () => engine.stopAll());

Hooks.on("updateScene", (scene, changes) => {
  if (scene !== canvas?.scene) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return syncToCanvas();
  if (
    foundry.utils.hasProperty(changes, "environment.darknessLevel") ||
    foundry.utils.hasProperty(changes, "darkness")
  ) {
    engine.setDarkness(darknessOf(scene));
  }
});

// Duck under combat music (fvtt-mod-combatplus starts it at combatStart): interval sets go
// silent, loop beds drop low. Re-evaluated at combat start, end (deletion), and round flips.
const evalDuck = () => engine.setDucked(combatActive());
Hooks.on("combatStart", evalDuck);
Hooks.on("deleteCombat", evalDuck);
Hooks.on("updateCombat", (combat, changes) => {
  // Combat "start" reaches other clients as a round change (0 → 1); `started` is a getter
  // and never appears in the delta. Re-evaluate on any round/active flip — setDucked is
  // idempotent, so over-calling is free.
  if ("round" in changes || "active" in changes) evalDuck();
});

/* -------------------------------------------------------------------------------------- */
/*  API — MCP-friendly by construction (design.md): flags in, flags out                   */
/* -------------------------------------------------------------------------------------- */

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      /** The scene's sound sets, normalized. */
      getSets: scene => getRawSets(scene).map(normalizeSet),
      /** Add or replace a set (matched by id); returns the stored, normalized set. */
      async upsertSet(scene, raw) {
        const set = normalizeSet(raw);
        const sets = getRawSets(scene).map(normalizeSet);
        const i = sets.findIndex(s => s.id === set.id);
        if (i >= 0) sets[i] = set;
        else sets.push(set);
        await scene.setFlag(MODULE_ID, "sets", sets);
        return set;
      },
      /** Remove a set by id; returns true when something was removed. */
      async removeSet(scene, id) {
        const sets = getRawSets(scene).map(normalizeSet);
        const kept = sets.filter(s => s.id !== id);
        if (kept.length === sets.length) return false;
        await scene.setFlag(MODULE_ID, "sets", kept);
        return true;
      },
      /** Open a set's editor window (defaults to the viewed scene / its first set). */
      open: (scene, setId) => {
        const s = scene ?? canvas?.scene;
        return new SoundscapeSetConfig({
          scene: s,
          setId: setId ?? getRawSets(s).map(normalizeSet)[0]?.id,
        }).render(true);
      },
      /** What this client's engine is doing right now — for diagnostics and the bridge. */
      status: () => ({
        ducked: engine.ducked,
        darkness: engine.darkness,
        running: [...engine.schedulers.keys()],
      }),
    };
  }
});

/* -------------------------------------------------------------------------------------- */
/*  Scene configuration: a module-owned tab (the autoexplore precedent) with the count    */
/*  and the button into the editor window.                                                */
/* -------------------------------------------------------------------------------------- */

Hooks.on("renderSceneConfig", (app, element) => {
  const el = element instanceof HTMLElement ? element : element?.[0];
  const nav = el?.querySelector("nav.sheet-tabs");
  if (!nav) return;

  // This hook fires on EVERY re-render, and a re-render rebuilds some parts (the nav)
  // while injected sibling panels survive — a presence-check on the nav item alone lets
  // panels accumulate. Remove any of ours first, then inject fresh: idempotent no matter
  // which parts the render replaced.
  nav.querySelector(`[data-tab="${MODULE_ID}"]`)?.remove();
  for (const stale of el.querySelectorAll(`.tab[data-tab="${MODULE_ID}"]`)) stale.remove();

  const active = app.tabGroups?.sheet === MODULE_ID;

  const navItem = document.createElement("a");
  navItem.dataset.action = "tab";
  navItem.dataset.group = "sheet";
  navItem.dataset.tab = MODULE_ID;
  if (active) navItem.classList.add("active");
  navItem.innerHTML = `<i class="fa-solid fa-music" inert></i><span>Soundscape</span>`;
  nav.appendChild(navItem);

  const esc = foundry.utils.escapeHTML;
  const sets = getRawSets(app.document).map(normalizeSet);
  const rows = sets
    .map(s => {
      const timing =
        s.playStyle === "loop"
          ? `loop · ${s.crossfade}s crossfade`
          : `every ${s.interval} ± ${s.intervalVariation}s`;
      const gate = s.whenToPlay === "always" ? "" : ` · ${s.whenToPlay} only`;
      return `
        <li data-set-id="${s.id}"${s.active ? "" : ' class="inactive"'}>
          <i class="fa-solid ${s.playStyle === "loop" ? "fa-rotate" : "fa-wave-square"}"
             data-tooltip="${s.playStyle === "loop" ? "Ambient loop — a continuous crossfaded bed" : "Interval sounds — random one-shots with silence between"}"></i>
          <span class="set-name">${esc(s.name)}</span>
          <span class="set-meta">${s.files.length} file${s.files.length === 1 ? "" : "s"} · ${timing}${gate}</span>
          <a data-ss-action="toggle" data-tooltip="${s.active ? "Active — click to disable" : "Inactive — click to enable"}">
            <i class="fa-solid ${s.active ? "fa-toggle-on" : "fa-toggle-off"}" inert></i>
          </a>
          <a data-ss-action="edit" data-tooltip="Edit"><i class="fa-solid fa-pen-to-square" inert></i></a>
          <a data-ss-action="delete" data-tooltip="Delete"><i class="fa-solid fa-trash" inert></i></a>
        </li>`;
    })
    .join("");

  const panel = document.createElement("div");
  panel.className = `tab scrollable${active ? " active" : ""}`;
  panel.dataset.group = "sheet";
  panel.dataset.tab = MODULE_ID;
  panel.innerHTML = `
    <div class="form-group soundscape-head">
      <label>Sound Sets (${sets.length})</label>
      <div class="form-fields">
        <button type="button" data-ss-action="library" data-tooltip="Pick a prebaked set from the sound library">
          <i class="fa-solid fa-book-open" inert></i> Add from Library
        </button>
        <button type="button" data-ss-action="blank">
          <i class="fa-solid fa-plus" inert></i> Add Blank Set
        </button>
      </div>
      <p class="hint">Area sounds for this scene, played for everyone through the Ambient
      volume channel. They quiet down during combat and can be gated to day or night by
      scene darkness.</p>
    </div>
    <ul class="soundscape-list">
      ${rows || '<li class="empty">No sound sets yet — add one to bring this scene to life.</li>'}
    </ul>`;

  panel.addEventListener("click", async event => {
    const control = event.target.closest("[data-ss-action]");
    if (!control) return;
    event.preventDefault();
    const scene = app.document;
    const setId = control.closest("[data-set-id]")?.dataset.setId;
    switch (control.dataset.ssAction) {
      case "library":
        await addFromLibrary(scene); // the scene update re-renders this list
        break;
      case "blank": {
        const set = await createBlankSet(scene);
        new SoundscapeSetConfig({ scene, setId: set.id }).render(true);
        break;
      }
      case "edit":
        new SoundscapeSetConfig({ scene, setId }).render(true);
        break;
      case "toggle": {
        const sets = getRawSets(scene).map(normalizeSet);
        const set = sets.find(s => s.id === setId);
        if (set) {
          set.active = !set.active;
          await scene.setFlag(MODULE_ID, "sets", sets);
        }
        break;
      }
      case "delete":
        await deleteSetWithConfirm(scene, setId);
        break;
    }
  });

  const tabs = el.querySelectorAll('.tab[data-group="sheet"]');
  tabs[tabs.length - 1]?.after(panel);
});
