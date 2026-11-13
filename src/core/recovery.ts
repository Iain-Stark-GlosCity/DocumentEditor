/** Pure helpers for crash recovery: snapshot ids, labels and the restore dialog's wording. */
import type { RecoverySnapshot } from "../platform/platform";
import { baseName } from "./documents";

/** A token that differs between app runs, so ids never collide with snapshots from a crash. */
export function newRecoverySession(now: number = Date.now(), random: () => number = Math.random) {
  const part = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${now.toString(36)}${part}`;
}

/**
 * The snapshot id for a document: stable for its whole life (it does not change on "Save as"),
 * unique between documents in a run (document ids are unique) and between runs (the session).
 * Only letters, digits and hyphens, which is what the platform accepts.
 */
export function recoveryId(session: string, docId: string): string {
  return `rec-${session}-${docId}`.replace(/[^A-Za-z0-9-]/g, "-");
}

export function snapshotName(snapshot: RecoverySnapshot): string {
  return snapshot.path ? baseName(snapshot.path) : "Untitled";
}

export function formatSnapshotTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** True if the file on disk was changed after the snapshot was taken. */
export function diskIsNewer(snapshot: RecoverySnapshot, diskModifiedMs: number | null): boolean {
  return snapshot.path !== null && diskModifiedMs !== null && diskModifiedMs > snapshot.savedMs;
}

export function describeSnapshot(
  snapshot: RecoverySnapshot,
  diskModifiedMs: number | null,
): string {
  const parts = [snapshotName(snapshot)];
  if (snapshot.path) parts.push(snapshot.path);
  parts.push(`saved ${formatSnapshotTime(snapshot.savedMs)}`);
  const line = parts.join(" · ");
  return diskIsNewer(snapshot, diskModifiedMs)
    ? `${line}\n   The file on disk is newer than this copy.`
    : line;
}

/** Most recent first. */
export function sortSnapshots(snapshots: readonly RecoverySnapshot[]): RecoverySnapshot[] {
  return [...snapshots].sort((a, b) => b.savedMs - a.savedMs);
}

export function listMessage(lines: readonly string[], limit = 8): string {
  const shown = lines.slice(0, limit).map((line) => `• ${line}`);
  if (lines.length > limit) shown.push(`…and ${lines.length - limit} more.`);
  const noun = lines.length === 1 ? "document has" : "documents have";
  return `${lines.length} ${noun} unsaved changes from a previous session.\n\n${shown.join("\n")}`;
}
