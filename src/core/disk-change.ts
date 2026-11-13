/** Decides what to do when the file behind an open document changes on disk. */

export type DiskVerdict =
  /** Nothing new: this is our own write, or the file is as we last saw it. */
  | "unchanged"
  /** The file now holds exactly what the buffer holds. Adopt it quietly. */
  | "identical"
  /** The buffer is clean: take the new content. */
  | "reload"
  /** The buffer has unsaved changes and the file has changed: ask the user. */
  | "conflict";

export interface DiskChangeInput {
  /** The modified time we last read or wrote. */
  knownModifiedMs: number;
  diskModifiedMs: number;
  diskText: string;
  bufferText: string;
  /** Unsaved changes, or the file had gone missing. */
  dirty: boolean;
  missing: boolean;
}

export function judgeDiskChange(input: DiskChangeInput): DiskVerdict {
  if (!input.missing && input.diskModifiedMs === input.knownModifiedMs) return "unchanged";
  if (input.diskText === input.bufferText) return "identical";
  return input.dirty || input.missing ? "conflict" : "reload";
}

/** The modified time check used before a save; same file, or one we are about to match. */
export function isStaleOnDisk(
  knownModifiedMs: number,
  diskModifiedMs: number,
  diskText: string,
  textToWrite: string,
): boolean {
  return diskModifiedMs !== knownModifiedMs && diskText !== textToWrite;
}

/** How a line ending is named to the user. */
export function eolStyleName(eol: "lf" | "crlf"): string {
  return eol === "crlf" ? "Windows (CRLF)" : "Unix (LF)";
}
