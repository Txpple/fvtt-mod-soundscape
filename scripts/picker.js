/**
 * Soundscape — the sound picker: a slim, audio-first alternative to core's FilePicker.
 *
 * Core's FilePicker is the whole Data browser (sources, tiles, upload) and cannot audition
 * audio. Picking sounds is a first-class action here, so this window does exactly that and
 * nothing else: browse folders (starting in the sound library), play any file in place
 * through the ambient channel, and add files to the set WITHOUT the window closing —
 * multi-add until Done. Server listing comes from FilePicker.browse, so anything under
 * Data works; only audio files are shown.
 */

const MODULE_ID = "fvtt-mod-soundscape";
const DEFAULT_START = "soundscape-sfx";
const AUDIO_RE = /\.(ogg|oga|wav|mp3|flac|webm|m4a|opus|aac)$/i;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SoundPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "soundscape-picker-{id}",
    classes: ["fvtt-mod-soundscape"],
    window: { title: "Add Sounds", icon: "fa-solid fa-file-audio", resizable: true },
    position: { width: 480, height: 620 },
    actions: {
      openDir: SoundPicker.#onOpenDir,
      up: SoundPicker.#onUp,
      home: SoundPicker.#onHome,
      play: SoundPicker.#onPlay,
      pick: SoundPicker.#onPick,
      done: SoundPicker.#onDone,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/picker.hbs`,
      scrollable: [".picker-listing"],
    },
  };

  /**
   * @param {object} options
   * @param {string}   [options.start]   Directory to open in (defaults to the library).
   * @param {number}   [options.volume]  Preview volume (the set's volume).
   * @param {Function} options.onPick    Called with each picked path; window stays open.
   */
  constructor(options = {}) {
    super(options);
    this.path = options.start || DEFAULT_START;
    this.volume = options.volume ?? 0.8;
    this.onPick = options.onPick ?? (() => {});
    this.added = new Set();
  }

  #previewSound = null;
  #previewPath = null;

  get title() {
    return "Add Sounds";
  }

  async _prepareContext() {
    let dirs = [];
    let files = [];
    try {
      const FP = foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
      const result = await FP.browse("data", this.path);
      this.path = result.target ?? this.path;
      dirs = (result.dirs ?? []).map(d => decodeURIComponent(d));
      files = (result.files ?? []).map(f => decodeURIComponent(f)).filter(f => AUDIO_RE.test(f));
    } catch (err) {
      ui.notifications?.warn(`Soundscape: cannot browse "${this.path}".`);
    }
    return {
      path: this.path || "(Data root)",
      atRoot: !this.path,
      dirs: dirs.map(d => ({ path: d, name: d.split("/").pop() })),
      files: files.map(f => ({
        path: f,
        name: f.split("/").pop(),
        added: this.added.has(f),
        playing: this.#previewPath === f && !!this.#previewSound?.playing,
      })),
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // Type-to-filter without re-rendering (a re-render would eat the caret).
    this.element.addEventListener("input", event => {
      if (event.target.name !== "filter") return;
      const q = event.target.value.toLowerCase();
      for (const row of this.element.querySelectorAll("[data-filterable]")) {
        row.classList.toggle("hidden", q !== "" && !row.dataset.filterable.includes(q));
      }
    });
  }

  _onClose(options) {
    super._onClose(options);
    this.#stopPreview();
  }

  static #onOpenDir(event, target) {
    this.path = target.dataset.path;
    this.#stopPreview();
    void this.render();
  }

  static #onUp() {
    this.path = this.path.split("/").slice(0, -1).join("/");
    this.#stopPreview();
    void this.render();
  }

  static #onHome() {
    this.path = DEFAULT_START;
    this.#stopPreview();
    void this.render();
  }

  /** Toggle playback of one file through the ambient channel. */
  static async #onPlay(event, target) {
    const path = target.dataset.path;
    const again = this.#previewPath === path && this.#previewSound?.playing;
    this.#stopPreview();
    if (again) return;
    try {
      const sound = new foundry.audio.Sound(path, { context: game.audio?.environment });
      await sound.load();
      this.#previewSound = sound;
      this.#previewPath = path;
      void sound.play({ volume: this.volume });
      this.#markPlaying(path);
    } catch (err) {
      ui.notifications?.warn("Soundscape: that file could not be loaded.");
    }
  }

  static #onPick(event, target) {
    const path = target.dataset.path;
    this.added.add(path);
    this.onPick(path);
    // Mark the row in place — no re-render, the listing scroll position matters here.
    const row = target.closest("li");
    row?.classList.add("added");
    row?.querySelector(".pick-state")?.replaceChildren(
      Object.assign(document.createElement("i"), { className: "fa-solid fa-check" }),
    );
  }

  static #onDone() {
    void this.close();
  }

  #markPlaying(path) {
    for (const row of this.element.querySelectorAll("li[data-filterable]")) {
      row.classList.toggle("playing", row.dataset.path === path);
    }
  }

  #stopPreview() {
    try { void this.#previewSound?.stop(); } catch (err) { /* already ended */ }
    this.#previewSound = null;
    this.#previewPath = null;
    this.#markPlaying(null);
  }
}
