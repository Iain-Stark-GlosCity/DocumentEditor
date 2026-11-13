/**
 * Everything the app needs from the operating system. `TauriPlatform` implements it with Rust
 * commands; `MemoryPlatform` implements it in memory for tests and browser-only development.
 *
 * Text crossing this boundary always uses `\n`. The platform converts to and from the file's
 * real encoding and line endings using `FileFormat`, so the rest of the app never sees them.
 */

export type Encoding = "utf-8" | "utf-16le" | "utf-16be";
export type Eol = "lf" | "crlf";

/** What must be preserved so a save writes the file back the way it was found. */
export interface FileFormat {
  encoding: Encoding;
  /** Whether the file starts with a byte order mark. */
  bom: boolean;
  /** The dominant line ending. */
  eol: Eol;
  /** True if the file mixed line endings. Saving normalises to `eol`; the UI warns once. */
  mixedEol: boolean;
}

export const DEFAULT_FILE_FORMAT: FileFormat = {
  encoding: "utf-8",
  bom: false,
  eol: "crlf",
  mixedEol: false,
};

export interface FileData {
  /** Decoded text with `\n` line endings. */
  text: string;
  format: FileFormat;
  /** Last modified time in milliseconds since the epoch. Used to detect external changes. */
  modifiedMs: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface FileChange {
  path: string;
  kind: "modified" | "removed";
}

export interface RecoverySnapshot {
  /** Stable id of the document the snapshot belongs to. */
  id: string;
  path: string | null;
  text: string;
  savedMs: number;
}

/** URL schemes `Platform.openExternal` will hand to the operating system. */
const EXTERNAL_SCHEMES = /^(https?|mailto):/i;

export function isExternalUrl(url: string): boolean {
  return EXTERNAL_SCHEMES.test(url.trim());
}

/** Thrown by `writeBinaryFile` and `copyFile` when the target exists and `overwrite` is false. */
export class FileExistsError extends Error {
  readonly code = "exists";
  constructor(readonly path: string) {
    super(`File already exists: ${path}`);
    this.name = "FileExistsError";
  }
}

/** Files dragged from the operating system onto the window. Coordinates are CSS pixels. */
export interface FilesDroppedEvent {
  paths: string[];
  x: number;
  y: number;
}

/** Where an Explorer drag currently is over the window (CSS pixels), or null once it has left. */
export type FileDragPosition = { x: number; y: number } | null;

export interface Platform {
  readFile(path: string): Promise<FileData>;
  /** The file's modified time without reading it, or null if it does not exist. */
  statFile(path: string): Promise<{ modifiedMs: number } | null>;
  /** Atomic: writes a temporary file beside the target, then renames over it. */
  writeFile(path: string, text: string, format: FileFormat): Promise<{ modifiedMs: number }>;

  /**
   * Atomic: writes the bytes beside the target and renames, creating parent folders. Rejects with
   * `FileExistsError` if the target exists and `options.overwrite` is false.
   */
  writeBinaryFile(path: string, bytes: Uint8Array, options: { overwrite: boolean }): Promise<void>;
  /** Same rules as `writeBinaryFile`, copying an existing file. */
  copyFile(from: string, to: string, options: { overwrite: boolean }): Promise<void>;
  /** Whether a file or folder exists at the path. */
  fileExists(path: string): Promise<boolean>;

  /**
   * Files dropped from the operating system (for example Explorer) onto the window. In the desktop
   * app the webview's own drop events carry no paths, so this is the only way to receive them.
   */
  onFilesDropped(handler: (event: FilesDroppedEvent) => void): Promise<() => void>;
  /** An Explorer drag moving over the window (for a drop indicator); null when it leaves or ends. */
  onFileDragOver(handler: (position: FileDragPosition) => void): Promise<() => void>;

  /** Returns the chosen paths, or an empty array if the dialog was cancelled. */
  showOpenDialog(options: { filters: FileFilter[]; multiple: boolean }): Promise<string[]>;
  /** Returns the chosen path, or null if the dialog was cancelled. */
  showSaveDialog(options: { filters: FileFilter[]; defaultPath?: string }): Promise<string | null>;

  /** Watches a file for changes made outside the app. Returns a function that stops watching. */
  watchFile(path: string, onChange: (change: FileChange) => void): Promise<() => void>;

  /** Crash recovery: unsaved buffers are written here on a timer and removed on save or close. */
  writeRecovery(snapshot: RecoverySnapshot): Promise<void>;
  clearRecovery(id: string): Promise<void>;
  listRecovery(): Promise<RecoverySnapshot[]>;

  /** Files passed on the command line or by "Open with", at launch and while running. */
  onOpenRequest(handler: (paths: string[]) => void): Promise<() => void>;

  /** Asked before the window closes. Resolve false to keep the window open. */
  onCloseRequested(handler: () => Promise<boolean>): Promise<() => void>;

  setWindowTitle(title: string): Promise<void>;

  /** The stored settings JSON, or null if none has been saved yet. */
  readSettings(): Promise<string | null>;
  /** Atomic: replaces the stored settings JSON. */
  writeSettings(json: string): Promise<void>;

  /**
   * Opens an http, https or mailto URL in the default application. Rejects any other scheme.
   * Never navigates the app's own webview.
   */
  openExternal(url: string): Promise<void>;

  /**
   * A URL the webview can load an image from, for an absolute path on disk. Synchronous and pure.
   * Only files under folders the app has opened or saved are readable through it.
   */
  assetUrl(absolutePath: string): string;
}
