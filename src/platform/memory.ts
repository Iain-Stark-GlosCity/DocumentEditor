import {
  DEFAULT_FILE_FORMAT,
  type FileChange,
  type FileData,
  type FileFilter,
  type FileFormat,
  isExternalUrl,
  type Platform,
  type RecoverySnapshot,
} from "./platform";

interface StoredFile {
  text: string;
  format: FileFormat;
  modifiedMs: number;
}

/**
 * In-memory Platform for tests and browser-only development. Text is stored as given (`\n`),
 * together with the FileFormat it was written with, so tests can assert both.
 */
export class MemoryPlatform implements Platform {
  readonly files = new Map<string, StoredFile>();
  readonly recovery = new Map<string, RecoverySnapshot>();
  windowTitle = "";
  /** URLs passed to `openExternal`, in order. */
  readonly openedUrls: string[] = [];
  /** What `writeSettings` last stored (tests may set it to simulate an existing file). */
  settingsJson: string | null = null;

  private readonly openDialogResults: string[][] = [];
  private readonly saveDialogResults: (string | null)[] = [];
  private readonly watchers = new Map<string, Set<(change: FileChange) => void>>();
  private readonly openHandlers = new Set<(paths: string[]) => void>();
  private pendingOpenRequests: string[] = [];
  private closeHandler: (() => Promise<boolean>) | null = null;
  private lastModified = 0;

  // Test helpers ------------------------------------------------------------------------

  seedFile(path: string, text: string, format: FileFormat = DEFAULT_FILE_FORMAT): void {
    this.files.set(path, { text, format: { ...format }, modifiedMs: this.tick() });
  }

  /** The next `showOpenDialog` call resolves with these paths ([] means cancelled). */
  queueOpenDialog(paths: string[]): void {
    this.openDialogResults.push(paths);
  }

  /** The next `showSaveDialog` call resolves with this path (null means cancelled). */
  queueSaveDialog(path: string | null): void {
    this.saveDialogResults.push(path);
  }

  /** Simulates an external change; notifies watchers of the path. */
  triggerFileChange(path: string, kind: FileChange["kind"] = "modified"): void {
    for (const watcher of [...(this.watchers.get(path) ?? [])]) watcher({ path, kind });
  }

  /** Simulates "Open with" or a second instance. Queued if no handler is registered yet. */
  requestOpen(paths: string[]): void {
    if (this.openHandlers.size === 0) {
      this.pendingOpenRequests.push(...paths);
      return;
    }
    for (const handler of [...this.openHandlers]) handler(paths);
  }

  /** Simulates the user closing the window; resolves true if the app allows it. */
  async requestClose(): Promise<boolean> {
    return this.closeHandler ? this.closeHandler() : true;
  }

  // Platform ----------------------------------------------------------------------------

  async readFile(path: string): Promise<FileData> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return { text: file.text, format: { ...file.format }, modifiedMs: file.modifiedMs };
  }

  async writeFile(path: string, text: string, format: FileFormat): Promise<{ modifiedMs: number }> {
    const modifiedMs = this.tick();
    this.files.set(path, { text, format: { ...format }, modifiedMs });
    return { modifiedMs };
  }

  async showOpenDialog(options: { filters: FileFilter[]; multiple: boolean }): Promise<string[]> {
    const paths = this.openDialogResults.shift() ?? [];
    return options.multiple ? paths : paths.slice(0, 1);
  }

  async showSaveDialog(): Promise<string | null> {
    return this.saveDialogResults.shift() ?? null;
  }

  async watchFile(path: string, onChange: (change: FileChange) => void): Promise<() => void> {
    let set = this.watchers.get(path);
    if (!set) this.watchers.set(path, (set = new Set()));
    set.add(onChange);
    return () => {
      this.watchers.get(path)?.delete(onChange);
    };
  }

  async writeRecovery(snapshot: RecoverySnapshot): Promise<void> {
    this.recovery.set(snapshot.id, { ...snapshot });
  }

  async clearRecovery(id: string): Promise<void> {
    this.recovery.delete(id);
  }

  async listRecovery(): Promise<RecoverySnapshot[]> {
    return [...this.recovery.values()].map((s) => ({ ...s }));
  }

  async onOpenRequest(handler: (paths: string[]) => void): Promise<() => void> {
    this.openHandlers.add(handler);
    if (this.pendingOpenRequests.length > 0) {
      const queued = this.pendingOpenRequests;
      this.pendingOpenRequests = [];
      handler(queued);
    }
    return () => {
      this.openHandlers.delete(handler);
    };
  }

  async onCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
    this.closeHandler = handler;
    return () => {
      if (this.closeHandler === handler) this.closeHandler = null;
    };
  }

  async setWindowTitle(title: string): Promise<void> {
    this.windowTitle = title;
  }

  async readSettings(): Promise<string | null> {
    return this.settingsJson;
  }

  async writeSettings(json: string): Promise<void> {
    this.settingsJson = json;
  }

  async openExternal(url: string): Promise<void> {
    if (!isExternalUrl(url)) throw new Error(`Cannot open ${url}`);
    this.openedUrls.push(url);
  }

  assetUrl(absolutePath: string): string {
    return `memory-asset://files/${encodeURIComponent(absolutePath)}`;
  }

  /** Strictly increasing so tests can tell successive writes apart. */
  private tick(): number {
    this.lastModified = Math.max(Date.now(), this.lastModified + 1);
    return this.lastModified;
  }
}
