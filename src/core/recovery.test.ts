import { describe, expect, it } from "vitest";
import {
  describeSnapshot,
  diskIsNewer,
  listMessage,
  newRecoverySession,
  recoveryId,
  snapshotName,
  sortSnapshots,
} from "./recovery";

const snap = (over: Partial<Parameters<typeof snapshotName>[0]> = {}) => ({
  id: "a",
  path: "C:\\notes\\todo.md",
  text: "x",
  savedMs: 1000,
  ...over,
});

describe("recovery helpers", () => {
  it("makes ids that are stable per document, unique per run and filename-safe", () => {
    const a = newRecoverySession(1, () => 0.1);
    const b = newRecoverySession(2, () => 0.1);
    expect(a).not.toBe(b);
    expect(recoveryId(a, "doc-1")).toBe(recoveryId(a, "doc-1"));
    expect(recoveryId(a, "doc-1")).not.toBe(recoveryId(a, "doc-2"));
    expect(recoveryId(a, "doc-1")).not.toBe(recoveryId(b, "doc-1"));
    expect(recoveryId(a, "doc 1/../x")).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it("names snapshots by file or Untitled", () => {
    expect(snapshotName(snap())).toBe("todo.md");
    expect(snapshotName(snap({ path: null }))).toBe("Untitled");
  });

  it("says when the file on disk is newer", () => {
    expect(diskIsNewer(snap(), 2000)).toBe(true);
    expect(diskIsNewer(snap(), 500)).toBe(false);
    expect(diskIsNewer(snap(), null)).toBe(false);
    expect(diskIsNewer(snap({ path: null }), 2000)).toBe(false);
    expect(describeSnapshot(snap(), 2000)).toContain("newer");
    expect(describeSnapshot(snap(), 500)).not.toContain("newer");
    expect(describeSnapshot(snap(), 500)).toContain("C:\\notes\\todo.md");
  });

  it("sorts newest first and truncates long lists", () => {
    expect(
      sortSnapshots([snap({ savedMs: 1 }), snap({ savedMs: 3 })]).map((s) => s.savedMs),
    ).toEqual([3, 1]);
    const lines = Array.from({ length: 10 }, (_, i) => `file ${i}`);
    const message = listMessage(lines);
    expect(message).toContain("10 documents have");
    expect(message).toContain("…and 2 more.");
    expect(listMessage(["one"])).toContain("1 document has");
  });
});
