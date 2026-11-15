/**
 * Runs the integrity check for the active container and holds its result, so the pane and the
 * status bar item share one run. It reads the file only when the container becomes active while
 * the pane is open, when the user asks, and (debounced) after a part is saved or the container
 * changes on disk; never per keystroke. A newer run supersedes an older one.
 */
import { countBySeverity, sortFindings, type Finding } from "../../core/findings";
import type { OpenDocument } from "../../core/documents";
import type { Workbench } from "../workbench";

export const RERUN_DELAY_MS = 1500;

export type IntegrityState =
  | { container: null; status: "idle"; findings: null }
  | { container: string; status: "idle" | "running"; findings: Finding[] | null }
  | { container: string; status: "done"; findings: Finding[] }
  | { container: string; status: "failed"; findings: null; message: string };

const NONE: IntegrityState = { container: null, status: "idle", findings: null };

/** The container of `doc` if its format can inspect containers, else null. */
export function inspectableContainer(wb: Workbench, doc: OpenDocument | null): string | null {
  if (!doc?.path) return null;
  try {
    const container = wb.platform.containers?.containerOf(doc.path) ?? null;
    if (container === null) return null;
    const provider = wb.registry.forPath(container);
    return provider?.kind === "text" && provider.binary?.inspect ? container : null;
  } catch {
    return null;
  }
}

export class IntegrityController {
  private state: IntegrityState = NONE;
  private readonly listeners = new Set<() => void>();
  private runId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopWatch: (() => void) | null = null;
  private watching: string | null = null;
  private stops: (() => void)[] = [];

  constructor(private readonly wb: Workbench) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  readonly getState = (): IntegrityState => this.state;

  private set(state: IntegrityState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  private visible(): boolean {
    return this.wb.settings.get("integrity.visible");
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Follows the active document, the setting, saves and disk changes. Returns the stop function. */
  start(): () => void {
    const wb = this.wb;
    const sync = () => this.sync();
    this.stops = [
      wb.onDidChangeActiveDocument(sync),
      wb.settings.subscribe("integrity.visible", sync),
      wb.onDidSave((event) => {
        if (this.state.container !== null && this.containerOf(event.path) === this.state.container)
          this.changed();
      }),
    ];
    this.sync();
    return () => {
      for (const stop of this.stops) stop();
      this.stops = [];
      this.clearTimer();
      this.runId += 1;
      this.unwatch();
    };
  }

  private containerOf(path: string): string | null {
    try {
      return this.wb.platform.containers?.containerOf(path) ?? null;
    } catch {
      return null;
    }
  }

  private unwatch(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.watching = null;
  }

  private watch(container: string | null): void {
    if (this.watching === container) return;
    this.unwatch();
    if (container === null) return;
    this.watching = container;
    this.wb.platform
      .watchFile(container, () => this.changed())
      .then(
        (stop) => {
          if (this.watching === container) this.stopWatch = stop;
          else stop();
        },
        () => undefined,
      );
  }

  private sync(): void {
    const container = inspectableContainer(this.wb, this.wb.activeDocument());
    if (container !== this.state.container) {
      this.clearTimer();
      this.runId += 1; // Whatever was running belongs to another container now.
      this.set(container === null ? NONE : { container, status: "idle", findings: null });
    }
    this.watch(container);
    if (container !== null && this.visible() && this.state.status === "idle") void this.run();
  }

  /** A part was saved or the container changed on disk: check again soon, or when next shown. */
  private changed(): void {
    const state = this.state;
    if (state.container === null) return;
    this.clearTimer();
    if (!this.visible()) {
      this.runId += 1;
      this.set({ container: state.container, status: "idle", findings: state.findings });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, RERUN_DELAY_MS);
  }

  /** Checks the active container now. A run still in flight is superseded. */
  async run(): Promise<void> {
    const container = this.state.container;
    if (container === null) return;
    this.clearTimer();
    const mine = ++this.runId;
    const previous = this.state.findings;
    this.set({ container, status: "running", findings: previous });
    try {
      const provider = this.wb.registry.forPath(container);
      const inspect = provider?.kind === "text" ? provider.binary?.inspect : undefined;
      if (!inspect) throw new Error("This file's format cannot be checked.");
      const { bytes } = await this.wb.platform.readBinaryFile(container);
      const findings = await inspect(bytes, { path: container });
      if (mine !== this.runId) return;
      this.set({ container, status: "done", findings: sortFindings(findings) });
    } catch (e) {
      if (mine !== this.runId) return;
      this.set({
        container,
        status: "failed",
        findings: null,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

const controllers = new WeakMap<Workbench, IntegrityController>();

export function integrityController(wb: Workbench): IntegrityController {
  let controller = controllers.get(wb);
  if (!controller) {
    controller = new IntegrityController(wb);
    controllers.set(wb, controller);
  }
  return controller;
}

export function summarise(findings: readonly Finding[]): string {
  const counts = countBySeverity(findings);
  const parts = [
    counts.error > 0 && `${counts.error} ${counts.error === 1 ? "error" : "errors"}`,
    counts.warning > 0 && `${counts.warning} ${counts.warning === 1 ? "warning" : "warnings"}`,
    counts.info > 0 && `${counts.info} ${counts.info === 1 ? "note" : "notes"}`,
  ].filter(Boolean);
  return parts.length === 0 ? "no problems" : parts.join(", ");
}
