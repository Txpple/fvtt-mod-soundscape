/**
 * Soundscape — the single-set editor window and the small dialogs around it.
 *
 * The scene-config tab is the MAIN page (the set list with add/edit/remove lives there —
 * see soundscape.js); this window edits ONE set at a time, the family rule being native
 * ApplicationV2 + Handlebars and nothing else.
 *
 * Edits BUFFER in the window and persist on "Save Changes" (bottom, the Foundry design
 * language — owner-directed, replacing the earlier live-apply model). Closing without
 * saving discards. Per-file preview buttons audition the pool before committing.
 *
 * Field edits never re-render (a re-render mid-typing eats the caret); only structural
 * changes (add/remove file, play-style flip) do.
 */

import { normalizeSet } from "./engine.js";
import { SoundPicker } from "./picker.js";

const MODULE_ID = "fvtt-mod-soundscape";

/**
 * An optional template library: a Data-root manifest of prebaked sets (name, category, and
 * the full set schema with files pointing at uploaded audio). Lives OUTSIDE the module
 * folder on purpose — installPackage clean-reinstalls modules/<id>/ on every update.
 */
const LIBRARY_PATH = "soundscape-sfx/library.json";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const rawSets = scene => scene?.flags?.[MODULE_ID]?.sets ?? [];

/** Write one set back into the scene's array (replace by id, append when new). */
async function persistSet(scene, set) {
  const sets = rawSets(scene).map(normalizeSet);
  const i = sets.findIndex(s => s.id === set.id);
  if (i >= 0) sets[i] = set;
  else sets.push(set);
  await scene.setFlag(MODULE_ID, "sets", sets);
}

/** Confirm, then remove a set. Returns true when it was removed. */
export async function deleteSetWithConfirm(scene, setId) {
  const set = rawSets(scene).map(normalizeSet).find(s => s.id === setId);
  if (!set) return false;
  const sure = await DialogV2.confirm({
    window: { title: "Delete Sound Set" },
    content: `<p>Delete <strong>${foundry.utils.escapeHTML(set.name)}</strong> (${set.files.length} file${set.files.length === 1 ? "" : "s"})?</p>`,
  });
  if (!sure) return false;
  await scene.setFlag(MODULE_ID, "sets", rawSets(scene).map(normalizeSet).filter(s => s.id !== setId));
  return true;
}

/** Create a blank set on the scene and return it (the caller usually opens the editor). */
export async function createBlankSet(scene) {
  const set = normalizeSet({ name: `Sound Set ${rawSets(scene).length + 1}` });
  await persistSet(scene, set);
  return set;
}

/* -------------------------------------------------------------------------------------- */
/*  Library picker — one dialog, straight onto the scene                                  */
/* -------------------------------------------------------------------------------------- */

let libraryCache;

export async function loadLibrary() {
  if (libraryCache !== undefined) return libraryCache;
  try {
    const res = await fetch(LIBRARY_PATH, { cache: "no-cache" });
    libraryCache = res.ok ? await res.json() : null;
  } catch (err) {
    libraryCache = null;
  }
  return libraryCache;
}

/**
 * Pick a prebaked set and clone it onto the scene: Section (Ambient Loops / Interval Sounds)
 * → Category → Set, as cascading selects in one dialog. Returns the new set, or null.
 */
export async function addFromLibrary(scene) {
  const templates = (await loadLibrary())?.sets;
  if (!Array.isArray(templates) || !templates.length) {
    ui.notifications?.warn(`Soundscape: no template library found at ${LIBRARY_PATH}.`);
    return null;
  }
  // section → category → [{index, name}]
  const tree = new Map();
  templates.forEach((t, i) => {
    const sec = t.section || "Interval Sounds";
    const cat = t.category || "Uncategorized";
    if (!tree.has(sec)) tree.set(sec, new Map());
    if (!tree.get(sec).has(cat)) tree.get(sec).set(cat, []);
    tree.get(sec).get(cat).push({ index: i, name: t.name });
  });
  const esc = foundry.utils.escapeHTML;
  const optionsOf = list => list.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
  const sections = [...tree.keys()];

  const picked = await DialogV2.prompt({
    window: { title: "Add from Library", icon: "fa-solid fa-book-open" },
    content: `
      <p>${templates.length} prebaked sound sets. Pick one — its files, style, and timing
      come along; edit it afterwards like any other set.</p>
      <div class="form-group">
        <label>Section</label>
        <div class="form-fields"><select name="section" autofocus>
          ${optionsOf(sections.map(s => ({ value: s, label: s })))}
        </select></div>
      </div>
      <div class="form-group">
        <label>Category</label>
        <div class="form-fields"><select name="category"></select></div>
      </div>
      <div class="form-group">
        <label>Sound Set</label>
        <div class="form-fields"><select name="template"></select></div>
      </div>`,
    render: (event, dialog) => {
      // DialogV2 render hands the APPLICATION, not an element (family ground truth).
      const form = dialog.element.querySelector("form") ?? dialog.element;
      const secSel = form.querySelector('select[name="section"]');
      const catSel = form.querySelector('select[name="category"]');
      const setSel = form.querySelector('select[name="template"]');
      const fillSets = () => {
        const list = tree.get(secSel.value)?.get(catSel.value) ?? [];
        setSel.innerHTML = optionsOf(list.map(o => ({ value: o.index, label: o.name })));
      };
      const fillCategories = () => {
        const cats = [...(tree.get(secSel.value)?.keys() ?? [])];
        catSel.innerHTML = optionsOf(cats.map(c => ({ value: c, label: c })));
        fillSets();
      };
      secSel.addEventListener("change", fillCategories);
      catSel.addEventListener("change", fillSets);
      fillCategories();
    },
    ok: {
      label: "Add to Scene",
      icon: "fa-solid fa-plus",
      callback: (event, button) => button.form.elements.template.value,
    },
    rejectClose: false,
  });
  if (picked === null || picked === undefined || picked === "") return null;
  const { section, category, ...template } = templates[Number(picked)];
  const set = normalizeSet({ ...template, id: "" });
  await persistSet(scene, set);
  return set;
}

/* -------------------------------------------------------------------------------------- */
/*  The one-set editor                                                                    */
/* -------------------------------------------------------------------------------------- */

export class SoundscapeSetConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "soundscape-set-{id}",
    classes: ["fvtt-mod-soundscape"],
    window: { title: "Sound Set", icon: "fa-solid fa-music", resizable: true },
    position: { width: 540, height: "auto" },
    actions: {
      addFile: SoundscapeSetConfig.#onAddFile,
      removeFile: SoundscapeSetConfig.#onRemoveFile,
      previewFile: SoundscapeSetConfig.#onPreviewFile,
      save: SoundscapeSetConfig.#onSave,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/config.hbs`,
      scrollable: [".soundscape-body"],
    },
  };

  constructor(options = {}) {
    super(options);
    this.scene = options.scene;
    this.set =
      rawSets(this.scene).map(normalizeSet).find(s => s.id === options.setId) ??
      normalizeSet({});
  }

  #previewSound = null;

  get title() {
    return `Sound Set — ${this.set.name}`;
  }

  async _prepareContext() {
    return {
      set: {
        ...this.set,
        isLoop: this.set.playStyle === "loop",
        isInterval: this.set.playStyle !== "loop",
      },
      whenToPlayOptions: {
        always: "Play at all times",
        day: "Play during the day (darkness < 0.5)",
        night: "Play at night (darkness ≥ 0.5)",
      },
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("change", this.#onChange.bind(this));
  }

  _onClose(options) {
    super._onClose(options);
    this.#stopPreview();
  }

  #onChange(event) {
    const { name, value } = event.target;
    const set = this.set;
    switch (name) {
      case "name": set.name = value; break;
      case "active": set.active = event.target.checked; break;
      case "playStyle":
        set.playStyle = value === "loop" ? "loop" : "interval";
        void this.render();
        return;
      case "interval": set.interval = parseFloat(value); break;
      case "intervalVariation": set.intervalVariation = parseFloat(value); break;
      case "crossfade": set.crossfade = parseFloat(value); break;
      case "volume": set.volume = parseFloat(value); break;
      case "volumeVariation": set.volumeVariation = parseFloat(value); break;
      case "pitchVariation": set.pitchVariation = parseFloat(value); break;
      case "whenToPlay": set.whenToPlay = value; break;
      default: return;
    }
  }

  /** The one write: persist the buffered set and close, Foundry-form style. */
  static async #onSave() {
    if (this.scene) await persistSet(this.scene, normalizeSet(this.set));
    void this.close();
  }

  static #onAddFile() {
    new SoundPicker({
      start: this.set.files.at(-1)?.split("/").slice(0, -1).join("/") || undefined,
      volume: normalizeSet(this.set).volume,
      onPick: path => {
        this.set.files.push(path);
        void this.render();
      },
    }).render(true);
  }

  static #onRemoveFile(event, target) {
    this.set.files.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  #previewIndex = null;

  /** Play one specific file through the ambient channel; clicking it again stops it. */
  static async #onPreviewFile(event, target) {
    const index = Number(target.dataset.index);
    const again = this.#previewIndex === index && this.#previewSound?.playing;
    this.#stopPreview();
    if (again) return;
    const src = this.set.files[index];
    if (!src) return;
    try {
      const sound = new foundry.audio.Sound(src, { context: game.audio?.environment });
      await sound.load();
      this.#previewSound = sound;
      this.#previewIndex = index;
      void sound.play({ volume: normalizeSet(this.set).volume });
    } catch (err) {
      ui.notifications?.warn("Soundscape: that file could not be loaded.");
    }
  }

  #stopPreview() {
    try { void this.#previewSound?.stop(); } catch (err) { /* already ended */ }
    this.#previewSound = null;
    this.#previewIndex = null;
  }
}
