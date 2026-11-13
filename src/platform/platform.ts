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

export interface Platform {
  readFile(path: string): Promise<FileData>;
  /** Atomic: writes a temporary file beside the target, then renames over it. */
  writeFile(path: string, text: string, format: FileFormat): Promise<{ modifiedMs: number }>;

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
}
