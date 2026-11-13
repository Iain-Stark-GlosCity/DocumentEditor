/**
 * The preview's state and its rendering schedule, without any React. It listens to the
 * workbench, renders after an adaptive pause, drops results that a newer render has replaced and
 * keeps the previous HTML while a new render is in progress.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { SETTINGS_SCHEMA, type SettingKey } from "../../core/settings";
import type { Workbench } from "../workbench";
import {
  createRenderer,
  SupersededError,
  type PreviewRenderer,
  type RendererOptions,
} from "./renderer";
import { debounceMs, SLOW_RENDER_MS } from "./scheduling";

export interface PreviewState {
  /** The document the HTML belongs to. */
  docId: string | null;
  /** Latest sanitised HTML for `docId`, or null before the first render finishes. */
  html: string | null;
  /** Counts applied renders, so a view can tell "new HTML" from "same HTML". */
  version: number;
  /** A render has been running longer than `SLOW_RENDER_MS`. */
  slow: boolean;
  /** Message from the last failed render, cleared by the next success. */
  error: string | null;
}

const EMPTY: PreviewState = { docId: null, html: null, version: 0, slow: false, error: null };

export class PreviewModel {
  readonly state: StoreApi<PreviewState> = createStore<PreviewState>()(() => EMPTY);

  private renderer: PreviewRenderer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderMs: number | null = null;
  /** `id|path` of the document last rendered; a change means "start afresh". */
  private key: string | null = null;
  private run = 0;

  constructor(
    private readonly workbench: Workbench,
    private readonly rendererOptions: RendererOptions = {},
  ) {}

  /** Starts listening and renders now. Returns a function that stops and releases the worker. */
  start(): () => void {
    this.renderer = createRenderer(this.workbench.registry, this.rendererOptions);
    const offText = this.workbench.onDidChangeText((change) => {
      if (change.docId === this.workbench.documents.getState().activeId) this.schedule();
    });
    // Covers switching tabs and "Save as", which changes the path that images resolve against.
    const offDocuments = this.workbench.documents.subscribe(() => this.checkDocument());
    // A change to one of the provider's own settings (for example `markdown.math`) changes the
    // HTML, so render again at once.
    const offSettings = this.workbench.settings.subscribeAll((key) => {
      const doc = this.workbench.activeDocument();
      if (doc && key.startsWith(`${doc.providerId}.`)) this.schedule(0);
    });
    this.checkDocument();

    return () => {
      offText();
      offDocuments();
      offSettings();
      this.clearTimers();
      this.renderer?.dispose();
      this.renderer = null;
      this.run++;
      this.key = null;
      this.state.setState(EMPTY, true);
    };
  }

  private checkDocument(): void {
    const doc = this.workbench.activeDocument();
    const key = doc ? `${doc.id}|${doc.path ?? ""}` : null;
    if (key === this.key) return;
    this.key = key;
    // A different document must not show the last one's preview while it renders.
    this.state.setState({ docId: doc?.id ?? null, html: null, slow: false, error: null });
    this.lastRenderMs = null;
    this.schedule(0);
  }

  /** Renders after the adaptive pause, or after `delay` if given. Restarts a pause in progress. */
  private schedule(delay?: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const doc = this.workbench.activeDocument();
    const length = doc ? (this.workbench.getText(doc.id)?.length ?? 0) : 0;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.render();
      },
      delay ?? debounceMs(this.lastRenderMs, length),
    );
  }

  /** The values of every setting whose key starts with `<providerId>.`. */
  private providerSettings(providerId: string): Record<string, boolean | number | string> {
    const settings: Record<string, boolean | number | string> = {};
    for (const key of Object.keys(SETTINGS_SCHEMA) as SettingKey[]) {
      if (!key.startsWith(`${providerId}.`)) continue;
      const value = this.workbench.settings.get(key);
      // Only plain values cross to the render worker; structured settings are not for renderers.
      if (typeof value !== "object") settings[key] = value;
    }
    return settings;
  }

  private clearTimers(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.slowTimer !== null) clearTimeout(this.slowTimer);
    this.timer = this.slowTimer = null;
  }

  private async render(): Promise<void> {
    const renderer = this.renderer;
    const doc = this.workbench.activeDocument();
    if (!renderer || !doc) return;
    const provider = this.workbench.registry.byId(doc.providerId);
    const text = this.workbench.getText(doc.id);
    if (!provider?.render || text === undefined) return;

    const run = ++this.run;
    const started = Date.now();
    if (this.slowTimer !== null) clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (run === this.run) this.state.setState({ slow: true });
    }, SLOW_RENDER_MS);

    try {
      const html = await renderer.render({
        providerId: provider.id,
        text,
        path: doc.path,
        settings: this.providerSettings(provider.id),
      });
      if (run !== this.run) return;
      this.lastRenderMs = Date.now() - started;
      this.state.setState((s) => ({
        docId: doc.id,
        html,
        version: s.version + 1,
        slow: false,
        error: null,
      }));
    } catch (error) {
      if (error instanceof SupersededError || run !== this.run) return;
      // Keep the previous preview on screen; say what went wrong beside it.
      this.state.setState({
        slow: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (run === this.run && this.slowTimer !== null) {
        clearTimeout(this.slowTimer);
        this.slowTimer = null;
      }
    }
  }
}
