/**
 * The workbench controller: plain TypeScript, no React. It owns the platform, format registry,
 * documents, editor buffers, commands and settings, and the file operations. React renders it
 * (see `App.tsx`); features extend it (see `feature.ts`).
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { editorHighlighting } from "./editor-highlight";
import {
  Compartment,
  EditorState,
  type Extension,
  type StateEffect,
  Transaction,
} from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { createStore, type StoreApi } from "zustand/vanilla";
import { CommandRegistry } from "../core/commands";
import { createDocumentsStore, type DocumentsStore, type OpenDocument } from "../core/documents";
import type { FormatRegistry } from "../core/registry";
import { SettingsStore } from "../core/settings";
import { minimalEdit } from "../core/text-diff";
import type { FileData, FileFilter, Platform } from "../platform/platform";
import { BufferStore } from "./buffers";
import { documentAssetUrl, followDocumentLink } from "./editor-links";
import type { Feature, MenuItem } from "./feature";
import { commandKeys, matchesKey } from "./keys";

export interface DialogAction {
  value: string;
  label: string;
}

export interface DialogRequest {
  title: string;
  message: string;
  actions: DialogAction[];
  /** Returned when the dialog is dismissed with Escape. */
  cancelValue: string;
}

export interface PendingDialog extends DialogRequest {
  id: number;
  resolve(value: string): void;
}

export interface NotificationAction {
  label: string;
  run(): void;
}

export interface NotificationRequest {
  message: string;
  /** Default `info`. Errors are announced assertively. */
  kind?: "info" | "warning" | "error";
  actions?: readonly NotificationAction[];
}

export interface Notification extends NotificationRequest {
  id: number;
}

/** What React renders from. Everything else is read from the stores and the controller. */
export interface UiState {
  /** Unsaved-changes flag per document id. */
  dirty: Record<string, boolean>;
  /** The first is shown; later ones wait their turn. */
  dialogs: PendingDialog[];
  notifications: Notification[];
  paletteOpen: boolean;
  /** Incremented to ask the menu bar to take keyboard focus. */
  menuFocusRequest: number;
}

export interface TextChange {
  docId: string;
  /** The editor state after the change; read `state.doc.toString()` for the text. */
  state: EditorState;
}

export interface EditorUpdate {
  /** The document the state belongs to, or null when no document is open. */
  docId: string | null;
  state: EditorState | null;
  docChanged: boolean;
}

/** Outcome of `saveDocument`. */
export type SaveResult =
  { ok: true } | { ok: false; reason: "cancelled" | "blocked" | "error"; error?: string };

export interface SaveOptions {
  /** An automatic save: never asks, never shows a Save dialog, reports errors to the caller. */
  auto?: boolean;
}

export interface SaveContext {
  doc: OpenDocument;
  /** Where the text is about to be written. Differs from `doc.path` for "Save as". */
  path: string;
  text: string;
  /** False for automatic saves, which must not open a dialog. */
  interactive: boolean;
}

/** Runs before a document is written. Resolve false to stop the save. */
export type SaveGuard = (context: SaveContext) => boolean | Promise<boolean>;

export interface SavedEvent {
  docId: string;
  path: string;
  /** The path before the save: null for a first save, another path for "Save as". */
  previousPath: string | null;
  modifiedMs: number;
}

export interface WorkbenchOptions {
  platform: Platform;
  registry: FormatRegistry;
  /** Features to activate. Default: none (the app passes `features/index.ts`). */
  features?: readonly Feature[];
  store?: DocumentsStore;
  commands?: CommandRegistry;
  settings?: SettingsStore;
  /** Quiet time before settings are written to disk. Default 400. */
  settingsSaveDelayMs?: number;
}

type Unsubscribe = () => void;

class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const baseExtensions: Extension[] = [
  history(),
  drawSelection(),
  // The buffer is always `\n`; a lone `\r` must stay part of the text (CLAUDE.md rule 1).
  EditorState.lineSeparator.of("\n"),
  editorHighlighting,
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.contentAttributes.of({ "aria-label": "Document text" }),
];

const emptyState = EditorState.create({
  doc: "",
  extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)],
});

export class Workbench {
  readonly platform: Platform;
  readonly registry: FormatRegistry;
  readonly documents: DocumentsStore;
  readonly buffers = new BufferStore();
  readonly commands: CommandRegistry;
  readonly settings: SettingsStore;
  readonly features: readonly Feature[];
  /** Dirty flags, dialogs, notifications and other UI state. React subscribes to it. */
  readonly ui: StoreApi<UiState> = createStore<UiState>()(() => ({
    dirty: {},
    dialogs: [],
    notifications: [],
    paletteOpen: false,
    menuFocusRequest: 0,
  }));

  private view: EditorView | null = null;
  private shownId: string | null = null;
  private stops: Unsubscribe[] | null = null;
  private readyPromise: Promise<void> = Promise.resolve();
  private readonly providerCompartment = new Compartment();
  private readonly featureCompartments = new Map<string, Compartment>();
  private readonly activeEmitter = new Emitter<OpenDocument | null>();
  private readonly editorEmitter = new Emitter<EditorUpdate>();
  private readonly textEmitter = new Emitter<TextChange>();
  private readonly openedEmitter = new Emitter<OpenDocument>();
  private readonly closedEmitter = new Emitter<OpenDocument>();
  private readonly savedEmitter = new Emitter<SavedEvent>();
  private readonly saveGuards = new Set<SaveGuard>();
  private readonly quitHooks = new Set<() => void | Promise<void>>();
  private readonly saving = new Map<string, Promise<void>>();
  private readonly autosaveHolds = new Map<string, Set<string>>();
  private knownDocuments = new Map<string, OpenDocument>();
  private readonly opens = new Set<Promise<void>>();
  private nextId = 1;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly settingsSaveDelayMs: number;

  constructor(options: WorkbenchOptions) {
    this.platform = options.platform;
    this.registry = options.registry;
    this.documents = options.store ?? createDocumentsStore();
    this.commands = options.commands ?? new CommandRegistry();
    this.settings = options.settings ?? new SettingsStore();
    this.features = options.features ?? [];
    this.settingsSaveDelayMs = options.settingsSaveDelayMs ?? 400;

    const seen = new Set<string>();
    for (const feature of this.features) {
      if (seen.has(feature.id)) throw new Error(`Duplicate feature id "${feature.id}"`);
      seen.add(feature.id);
      if (feature.id === "provider") throw new Error('"provider" is a reserved feature id');
      if (feature.editorExtensions) this.featureCompartments.set(feature.id, new Compartment());
    }
  }

  // Lifecycle -----------------------------------------------------------------------------

  /** Resolves once settings are loaded and the start-up documents are in place. */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Starts features, key handling and platform hooks. Safe to call again after `dispose`. */
  start(): void {
    if (this.stops) return;
    const stops: Unsubscribe[] = [];
    this.stops = stops;
    const current = () => this.stops === stops;

    this.knownDocuments = new Map(this.documents.getState().documents.map((d) => [d.id, d]));
    stops.push(this.documents.subscribe(() => this.onDocumentsChanged()));
    this.refreshDirty();

    this.registerProviderCommands(stops);
    for (const feature of this.features) this.activateFeature(feature, stops);

    for (const feature of this.features) {
      for (const key of feature.reconfigureOn ?? []) {
        stops.push(this.settings.subscribe(key, () => this.reconfigureEditors(feature.id)));
      }
    }
    stops.push(
      this.settings.subscribe("editor.viewMode", () => this.reconfigureEditors("provider")),
    );

    window.addEventListener("keydown", this.onKeyDown, true);
    stops.push(() => window.removeEventListener("keydown", this.onKeyDown, true));

    // Platform hooks. Each registration may finish after a dispose; undo it if so.
    const hook = (registration: Promise<Unsubscribe>): Promise<void> =>
      registration.then(
        (unlisten) => {
          if (current()) stops.push(unlisten);
          else unlisten();
        },
        (e: unknown) => {
          this.notify({ kind: "error", message: message(e) });
        },
      );

    const openHook = hook(this.platform.onOpenRequest((paths) => void this.openPaths(paths)));
    const closeHook = hook(this.platform.onCloseRequested(() => this.confirmQuit()));
    const settingsLoaded = this.loadSettings(stops, current);

    this.readyPromise = Promise.all([openHook, closeHook, settingsLoaded]).then(async () => {
      // Files passed on the command line are opened before deciding whether to show a blank tab.
      await Promise.allSettled([...this.opens]);
      if (!current()) return;
      const provider = this.registry.all()[0];
      if (provider && this.documents.getState().documents.length === 0) {
        this.documents.getState().openUntitled(provider.id);
      }
    });

    this.showActive();
  }

  dispose(): void {
    const stops = this.stops;
    if (!stops) return;
    this.stops = null;
    if (this.settingsTimer !== null) {
      clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
      void this.platform.writeSettings(this.settings.serialise()).catch(() => {});
    }
    for (const stop of stops.reverse()) {
      try {
        stop();
      } catch (e) {
        console.error(e);
      }
    }
  }

  // Dialogs and notifications -------------------------------------------------------------

  /** Shows a modal dialog and resolves with the value of the chosen action. */
  ask(request: DialogRequest): Promise<string> {
    return new Promise<string>((resolve) => {
      const dialog: PendingDialog = { ...request, id: this.nextId++, resolve };
      this.ui.setState((s) => ({ dialogs: [...s.dialogs, dialog] }));
    });
  }

  /** Called by the dialog component. */
  resolveDialog(id: number, value: string): void {
    const dialog = this.ui.getState().dialogs.find((d) => d.id === id);
    if (!dialog) return;
    this.ui.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }));
    dialog.resolve(value);
  }

  /** Shows a non-modal banner with optional action buttons. */
  notify(request: NotificationRequest): { id: number; dismiss(): void } {
    const id = this.nextId++;
    this.ui.setState((s) => ({ notifications: [...s.notifications, { ...request, id }] }));
    return { id, dismiss: () => this.dismissNotification(id) };
  }

  dismissNotification(id: number): void {
    this.ui.setState((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  }

  openPalette(): void {
    this.ui.setState({ paletteOpen: true });
  }

  closePalette(): void {
    this.ui.setState({ paletteOpen: false });
  }

  requestMenuFocus(): void {
    this.ui.setState((s) => ({ menuFocusRequest: s.menuFocusRequest + 1 }));
  }

  // Commands ------------------------------------------------------------------------------

  /** Runs a command, reporting any failure as a notification. Does nothing if it is disabled. */
  async runCommand(id: string): Promise<void> {
    const command = this.commands.get(id);
    if (!command) {
      this.notify({ kind: "error", message: `Unknown command "${id}"` });
      return;
    }
    if (command.enabled && !command.enabled()) return;
    try {
      await command.run();
    } catch (e) {
      this.notify({ kind: "error", message: message(e) });
    }
  }

  /** All menu contributions from features. */
  menuItems(): MenuItem[] {
    return this.features.flatMap((f) => f.menuItems ?? []);
  }

  // Documents and editor ------------------------------------------------------------------

  activeDocument(): OpenDocument | null {
    const { documents, activeId } = this.documents.getState();
    return documents.find((d) => d.id === activeId) ?? null;
  }

  /** The editor view, or null before the editor has mounted. */
  activeView(): EditorView | null {
    return this.view;
  }

  focusEditor(): void {
    if (this.shownId !== null) this.view?.focus();
  }

  /** EditorState of the active document, or null. Same instance until it changes. */
  activeEditorState(): EditorState | null {
    const id = this.documents.getState().activeId;
    return id === null ? null : (this.getEditorState(id) ?? null);
  }

  /** The state of a document, created on first use. */
  getEditorState(id: string): EditorState | undefined {
    const existing = this.buffers.get(id);
    if (existing) return existing;
    const doc = this.documents.getState().documents.find((d) => d.id === id);
    if (!doc) return undefined;
    const state = this.createState(doc);
    this.buffers.set(id, state);
    return state;
  }

  /** Current text of a document (`\n` line endings), including unsaved edits. */
  getText(id: string): string | undefined {
    return this.getEditorState(id)?.doc.toString();
  }

  /** Replaces a document's whole text (as one undoable edit if it is the one being shown). */
  replaceText(id: string, text: string): void {
    const state = this.getEditorState(id);
    if (!state || state.doc.toString() === text) return;
    this.applyChange(id, state, { from: 0, to: state.doc.length, insert: text }, true);
  }

  /**
   * Makes a document match what is on disk without disturbing the editor: only the part of the
   * text that differs is replaced, so the caret and scroll position survive, and the edit is
   * not added to the undo history. The saved state is updated to match.
   */
  reloadFromDisk(id: string, data: FileData): void {
    const state = this.getEditorState(id);
    if (state) {
      const edit = minimalEdit(state.doc.toString(), data.text);
      if (edit) this.applyChange(id, state, edit, false);
    }
    this.documents.getState().applyDisk(id, data);
  }

  isDirty(id: string): boolean {
    const doc = this.documents.getState().documents.find((d) => d.id === id);
    if (doc?.missingOnDisk) return true;
    const state = this.buffers.get(id);
    if (!doc || !state) return false;
    if (state.doc.length !== doc.savedText.length) return true;
    return state.doc.toString() !== doc.savedText;
  }

  /** Calls back after a document appears in the store (opened, restored or new). */
  onDidOpenDocument(callback: (doc: OpenDocument) => void): Unsubscribe {
    return this.openedEmitter.on(callback);
  }

  /** Calls back after a document has been removed, with the document as it last was. */
  onDidCloseDocument(callback: (doc: OpenDocument) => void): Unsubscribe {
    return this.closedEmitter.on(callback);
  }

  /** Calls back after a successful write of a document (manual or automatic). */
  onDidSave(callback: (event: SavedEvent) => void): Unsubscribe {
    return this.savedEmitter.on(callback);
  }

  /** Adds a check that runs before every write. Any guard resolving false stops the save. */
  addSaveGuard(guard: SaveGuard): Unsubscribe {
    this.saveGuards.add(guard);
    return () => {
      this.saveGuards.delete(guard);
    };
  }

  /** Runs once the user has agreed to quit (or nothing is unsaved), before the window closes. */
  onBeforeQuit(hook: () => void | Promise<void>): Unsubscribe {
    this.quitHooks.add(hook);
    return () => {
      this.quitHooks.delete(hook);
    };
  }

  /**
   * Asks automatic saving to leave a document alone (for example while a conflict with the file
   * on disk is unresolved). Holds are per reason; call the returned function to release it.
   */
  holdAutosave(docId: string, reason: string): Unsubscribe {
    let reasons = this.autosaveHolds.get(docId);
    if (!reasons) this.autosaveHolds.set(docId, (reasons = new Set()));
    reasons.add(reason);
    return () => {
      const held = this.autosaveHolds.get(docId);
      held?.delete(reason);
      if (held?.size === 0) this.autosaveHolds.delete(docId);
    };
  }

  isAutosaveHeld(docId: string): boolean {
    return (this.autosaveHolds.get(docId)?.size ?? 0) > 0;
  }

  /** True while the document's bytes are being written. */
  isSaving(docId: string): boolean {
    return this.saving.has(docId);
  }

  /** Resolves when no write of the document is in flight. */
  async whenSaveSettled(docId: string): Promise<void> {
    while (this.saving.has(docId)) await this.saving.get(docId);
  }

  /** Called by the editor component once its view exists. Returns a function to detach it. */
  attachView(view: EditorView): Unsubscribe {
    this.view = view;
    this.showActive();
    return () => {
      if (this.view === view) this.view = null;
    };
  }

  /** Calls back when the active document changes (including to null). */
  onDidChangeActiveDocument(callback: (doc: OpenDocument | null) => void): Unsubscribe {
    return this.activeEmitter.on(callback);
  }

  /** Calls back whenever any editor state changes: edits, selection, tab switches. */
  onEditorUpdate(callback: (update: EditorUpdate) => void): Unsubscribe {
    return this.editorEmitter.on(callback);
  }

  /**
   * Calls back when a document's text changes. With `debounceMs`, calls once after that much
   * quiet time per document, with the latest state.
   */
  onDidChangeText(
    callback: (change: TextChange) => void,
    options: { debounceMs?: number } = {},
  ): Unsubscribe {
    const delay = options.debounceMs ?? 0;
    if (delay <= 0) return this.textEmitter.on(callback);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const off = this.textEmitter.on((change) => {
      const pending = timers.get(change.docId);
      if (pending !== undefined) clearTimeout(pending);
      timers.set(
        change.docId,
        setTimeout(() => {
          timers.delete(change.docId);
          callback(change);
        }, delay),
      );
    });
    return () => {
      off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }

  /**
   * Rebuilds one feature's editor extensions in every open document, keeping editor state.
   * Pass `"provider"` to rebuild the format provider's extensions.
   */
  reconfigureEditors(featureId: string): void {
    for (const doc of this.documents.getState().documents) {
      const effect = this.reconfigureEffect(featureId, doc);
      if (!effect) continue;
      if (this.view && this.shownId === doc.id) {
        this.view.dispatch({ effects: effect });
        continue;
      }
      const state = this.buffers.get(doc.id);
      if (state) this.buffers.set(doc.id, state.update({ effects: effect }).state);
    }
  }

  // File operations -----------------------------------------------------------------------

  newFile(): string | null {
    const provider = this.registry.all()[0];
    if (!provider) return null;
    return this.documents.getState().openUntitled(provider.id);
  }

  fileFilters(): FileFilter[] {
    const known = this.registry
      .all()
      .map((p) => ({ name: p.name, extensions: [...p.fileExtensions] }));
    return [...known, { name: "All files", extensions: ["*"] }];
  }

  async openDialog(): Promise<void> {
    const paths = await this.platform.showOpenDialog({
      filters: this.fileFilters(),
      multiple: true,
    });
    await this.openPaths(paths);
  }

  openPaths(paths: string[]): Promise<void> {
    const run = this.openPathsNow(paths).finally(() => this.opens.delete(run));
    this.opens.add(run);
    return run;
  }

  async save(id: string | null = this.documents.getState().activeId): Promise<boolean> {
    return (await this.saveDocument(id)).ok;
  }

  async saveAs(id: string | null = this.documents.getState().activeId): Promise<boolean> {
    return (await this.saveAsNow(id)).ok;
  }

  /**
   * Saves a document and says how it went. With `auto`, an untitled document is never saved (no
   * dialog), guards may not ask questions, and a write error is returned rather than shown.
   */
  async saveDocument(
    id: string | null = this.documents.getState().activeId,
    options: SaveOptions = {},
  ): Promise<SaveResult> {
    const doc = this.docById(id);
    const text = doc && this.getText(doc.id);
    if (!doc || text === undefined)
      return { ok: false, reason: "error", error: "No such document" };
    if (doc.path === null) {
      return options.auto ? { ok: false, reason: "blocked" } : this.saveAsNow(doc.id);
    }
    return this.writeTo(doc, doc.path, text, options.auto === true);
  }

  private async saveAsNow(id: string | null): Promise<SaveResult> {
    const doc = this.docById(id);
    const text = doc && this.getText(doc.id);
    if (!doc || text === undefined)
      return { ok: false, reason: "error", error: "No such document" };
    const ext = this.registry.byId(doc.providerId)?.fileExtensions[0];
    const defaultPath = doc.path ?? (ext ? `${doc.title}.${ext}` : doc.title);
    const path = await this.platform.showSaveDialog({ filters: this.fileFilters(), defaultPath });
    if (path === null) return { ok: false, reason: "cancelled" };
    return this.writeTo(doc, path, text, false);
  }

  /** Closes a document, asking first if it has unsaved changes. Returns false if cancelled. */
  async closeDocument(id: string | null = this.documents.getState().activeId): Promise<boolean> {
    const doc = this.docById(id);
    if (!doc) return false;
    if (this.isDirty(doc.id)) {
      this.documents.getState().setActive(doc.id);
      const choice = await this.ask({
        title: `Save changes to ${doc.title}?`,
        message: "Your changes will be lost if you do not save them.",
        actions: [
          { value: "save", label: "Save" },
          { value: "discard", label: "Do not save" },
          { value: "cancel", label: "Cancel" },
        ],
        cancelValue: "cancel",
      });
      if (choice === "cancel") return false;
      if (choice === "save" && !(await this.save(doc.id))) return false;
    }
    this.buffers.delete(doc.id);
    this.documents.getState().close(doc.id);
    return true;
  }

  // Internals -----------------------------------------------------------------------------

  private docById(id: string | null): OpenDocument | undefined {
    return id === null ? undefined : this.documents.getState().documents.find((d) => d.id === id);
  }

  private async writeTo(
    doc: OpenDocument,
    path: string,
    text: string,
    auto: boolean,
  ): Promise<SaveResult> {
    try {
      for (const guard of [...this.saveGuards]) {
        if (!(await guard({ doc, path, text, interactive: !auto }))) {
          return { ok: false, reason: "blocked" };
        }
      }
      const write = (async () => {
        const { modifiedMs } = await this.platform.writeFile(path, text, doc.format);
        // Saving normalises line endings to the dominant style, so the file is no longer mixed.
        this.documents
          .getState()
          .markSaved(doc.id, path, text, modifiedMs, { ...doc.format, mixedEol: false });
        this.savedEmitter.emit({ docId: doc.id, path, previousPath: doc.path, modifiedMs });
      })();
      const settled = write.then(
        () => undefined,
        () => undefined,
      );
      this.saving.set(doc.id, settled);
      try {
        await write;
      } finally {
        if (this.saving.get(doc.id) === settled) this.saving.delete(doc.id);
      }
      return { ok: true };
    } catch (e) {
      const error = message(e);
      if (!auto) this.notify({ kind: "error", message: `Could not save ${path}: ${error}` });
      return { ok: false, reason: "error", error };
    }
  }

  private async openPathsNow(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        const provider = this.registry.forPath(path) ?? this.registry.all()[0];
        if (!provider) throw new Error("No document formats are registered");
        const data = await this.platform.readFile(path);
        // An untouched "Untitled" tab is replaced rather than left beside the new file.
        const docs = this.documents.getState().documents;
        const only = docs.length === 1 ? docs[0] : undefined;
        const replaceable = only && only.path === null && !this.isDirty(only.id) ? only.id : null;
        this.documents.getState().openFromFile(path, data, provider.id);
        if (replaceable) {
          this.buffers.delete(replaceable);
          this.documents.getState().close(replaceable);
        }
      } catch (e) {
        this.notify({ kind: "error", message: `Could not open ${path}: ${message(e)}` });
      }
    }
  }

  private async confirmQuit(): Promise<boolean> {
    if (!(await this.confirmUnsavedOnQuit())) return false;
    for (const hook of [...this.quitHooks]) {
      try {
        await hook();
      } catch (e) {
        console.error(e);
      }
    }
    return true;
  }

  private async confirmUnsavedOnQuit(): Promise<boolean> {
    const unsaved = this.documents.getState().documents.filter((d) => this.isDirty(d.id));
    if (unsaved.length === 0) return true;
    const names = unsaved.map((d) => d.title).join(", ");
    const choice = await this.ask({
      title: "Close without saving?",
      message: `These documents have unsaved changes: ${names}.`,
      actions: [
        { value: "close", label: "Close and discard changes" },
        { value: "cancel", label: "Cancel" },
      ],
      cancelValue: "cancel",
    });
    return choice === "close";
  }

  private activateFeature(feature: Feature, stops: Unsubscribe[]): void {
    try {
      for (const command of feature.commands?.(this) ?? []) {
        stops.push(this.commands.register(command));
      }
      const dispose = feature.activate?.(this);
      if (typeof dispose === "function") stops.push(dispose);
    } catch (e) {
      this.notify({
        kind: "error",
        message: `The "${feature.id}" feature could not start: ${message(e)}`,
      });
    }
  }

  /** Commands declared by a format provider run against the editor while its document is active. */
  private registerProviderCommands(stops: Unsubscribe[]): void {
    for (const provider of this.registry.all()) {
      for (const command of provider.commands ?? []) {
        const active = () => this.activeDocument()?.providerId === provider.id && !!this.view;
        try {
          stops.push(
            this.commands.register({
              id: command.id,
              title: command.title,
              defaultKey: command.defaultKey,
              enabled: active,
              run: () => {
                if (this.view) command.run(this.view);
              },
            }),
          );
        } catch (e) {
          this.notify({ kind: "error", message: message(e) });
        }
      }
    }
  }

  private async loadSettings(stops: Unsubscribe[], current: () => boolean): Promise<void> {
    try {
      const json = await this.platform.readSettings();
      if (!current()) return;
      if (json !== null) this.settings.load(json);
    } catch (e) {
      this.notify({ kind: "warning", message: `Could not read settings: ${message(e)}` });
    }
    if (!current()) return;
    // Subscribe only now, so loading the file does not write it straight back.
    stops.push(this.settings.subscribeAll(() => this.scheduleSettingsSave()));
    stops.push(() => {
      if (this.settingsTimer !== null) clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    });
  }

  private scheduleSettingsSave(): void {
    if (this.settingsTimer !== null) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      this.platform.writeSettings(this.settings.serialise()).catch((e: unknown) => {
        this.notify({ kind: "error", message: `Could not save settings: ${message(e)}` });
      });
    }, this.settingsSaveDelayMs);
  }

  /** One handler for every shortcut, whether focus is in the editor or elsewhere. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const ui = this.ui.getState();
    if (ui.dialogs.length > 0 || ui.paletteOpen) return;
    if (event.isComposing || event.repeat) return;
    for (const command of this.commands.all()) {
      if (command.nativeKey) continue;
      if (!commandKeys(command).some((key) => matchesKey(event, key))) continue;
      // Capture phase plus stopPropagation: CodeMirror and React never see the same key again.
      event.preventDefault();
      event.stopPropagation();
      void this.runCommand(command.id);
      return;
    }
  };

  private onDocumentsChanged(): void {
    const { documents, activeId } = this.documents.getState();
    for (const id of this.buffers.ids()) {
      if (!documents.some((d) => d.id === id)) this.buffers.delete(id);
    }
    this.refreshDirty();
    if (activeId !== this.shownId) this.showActive();

    const current = new Map(documents.map((d) => [d.id, d]));
    const opened = documents.filter((d) => !this.knownDocuments.has(d.id));
    const closed = [...this.knownDocuments.values()].filter((d) => !current.has(d.id));
    this.knownDocuments = current;
    for (const doc of closed) this.autosaveHolds.delete(doc.id);
    for (const doc of opened) this.openedEmitter.emit(doc);
    for (const doc of closed) this.closedEmitter.emit(doc);
  }

  /** Applies one change to a document's state, whether or not it is the one being shown. */
  private applyChange(
    id: string,
    state: EditorState,
    changes: { from: number; to: number; insert: string },
    addToHistory: boolean,
  ): void {
    const annotations = addToHistory ? [] : [Transaction.addToHistory.of(false)];
    if (this.view && this.shownId === id) {
      this.view.dispatch({ changes, annotations });
      return;
    }
    const next = state.update({ changes, annotations }).state;
    this.buffers.set(id, next);
    this.refreshDirty();
    this.textEmitter.emit({ docId: id, state: next });
    this.editorEmitter.emit({ docId: id, state: next, docChanged: true });
  }

  private refreshDirty(): void {
    const next: Record<string, boolean> = {};
    for (const d of this.documents.getState().documents) next[d.id] = this.isDirty(d.id);
    const prev = this.ui.getState().dirty;
    const keys = Object.keys(next);
    const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
    if (!same) this.ui.setState({ dirty: next });
  }

  private showActive(): void {
    const id = this.documents.getState().activeId;
    this.shownId = id;
    if (this.view) {
      if (id === null) {
        this.view.setState(emptyState);
      } else {
        const state = this.getEditorState(id);
        if (state) {
          this.view.setState(state);
          this.view.focus();
        }
      }
    }
    this.activeEmitter.emit(this.activeDocument());
    this.editorEmitter.emit({
      docId: id,
      state: id === null ? null : (this.buffers.get(id) ?? null),
      docChanged: false,
    });
  }

  private providerExtensions(doc: OpenDocument): Extension {
    const provider = this.registry.byId(doc.providerId);
    if (!provider) return [];
    const requested = this.settings.get("editor.viewMode");
    const mode = provider.viewModes.includes(requested) ? requested : "source";
    return provider.editorExtensions({
      mode,
      path: doc.path,
      setting: (key, fallback) => this.settings.getOr(key, fallback),
      // The path is read when used, so links and images follow a "Save as".
      openLink: (href) => followDocumentLink(this, href, this.docById(doc.id)?.path ?? null),
      resolveAsset: (rel) => documentAssetUrl(this, rel, this.docById(doc.id)?.path ?? null),
    });
  }

  private reconfigureEffect(featureId: string, doc: OpenDocument): StateEffect<unknown> | null {
    if (featureId === "provider") {
      return this.providerCompartment.reconfigure(this.providerExtensions(doc));
    }
    const feature = this.features.find((f) => f.id === featureId);
    const compartment = this.featureCompartments.get(featureId);
    if (!feature?.editorExtensions || !compartment) return null;
    return compartment.reconfigure(feature.editorExtensions(doc, this));
  }

  private createState(doc: OpenDocument): EditorState {
    const featureExtensions = this.features.flatMap((feature) => {
      const compartment = this.featureCompartments.get(feature.id);
      return compartment && feature.editorExtensions
        ? [compartment.of(feature.editorExtensions(doc, this))]
        : [];
    });
    return EditorState.create({
      doc: doc.savedText,
      extensions: [
        this.providerCompartment.of(this.providerExtensions(doc)),
        ...featureExtensions,
        ...baseExtensions,
        EditorView.updateListener.of((update) => {
          this.buffers.set(doc.id, update.state);
          if (update.docChanged) {
            this.refreshDirty();
            this.textEmitter.emit({ docId: doc.id, state: update.state });
          }
          this.editorEmitter.emit({
            docId: doc.id,
            state: update.state,
            docChanged: update.docChanged,
          });
        }),
      ],
    });
  }
}
