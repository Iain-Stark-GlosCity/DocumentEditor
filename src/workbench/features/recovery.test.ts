import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileFormat } from "../../platform/platform";
import { MemoryPlatform } from "../../platform/memory";
import { externalChanges } from "./external-changes";
import { recovery } from "./recovery";
import { answerDialog, boot, disposeAll, settle } from "./safety-test-helpers";

afterEach(() => {
  disposeAll();
  vi.useRealTimers();
});

const utf16Crlf: FileFormat = { encoding: "utf-16le", bom: true, eol: "crlf", mixedEol: false };

describe("recovery snapshots", () => {
  it("writes a snapshot a few seconds after the last edit while dirty", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [recovery],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    await settle(2000);
    workbench.replaceText(id, "three");
    await settle(2999);
    expect(platform.recovery.size).toBe(0);
    await settle(1);
    expect([...platform.recovery.values()]).toMatchObject([{ path: "/a.md", text: "three" }]);
  });

  it("honours files.recoveryIntervalMs", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [recovery] });
    workbench.settings.set("files.recoveryIntervalMs", 500);
    workbench.replaceText(id, "x");
    await settle(500);
    expect(platform.recovery.size).toBe(1);
  });

  it("includes untitled documents, with distinct stable ids", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [recovery] });
    const second = workbench.newFile()!;
    workbench.replaceText(id, "first");
    workbench.replaceText(second, "second");
    await settle(3000);
    const snapshots = [...platform.recovery.values()];
    expect(snapshots.map((s) => s.text).sort()).toEqual(["first", "second"]);
    expect(snapshots.every((s) => s.path === null)).toBe(true);
    expect(new Set(snapshots.map((s) => s.id)).size).toBe(2);

    // The id does not change as the document is edited again.
    const before = snapshots.map((s) => s.id).sort();
    workbench.replaceText(id, "first, edited");
    await settle(3000);
    expect([...platform.recovery.keys()].sort()).toEqual(before);
  });

  it("uses different ids in a later run", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    const a = await boot({ features: [recovery], platform });
    a.workbench.replaceText(a.id, "run one");
    await settle(3000);
    const [first] = [...platform.recovery.keys()];
    a.workbench.dispose(); // a crash: nothing is cleaned up
    expect(platform.recovery.size).toBe(1);

    const b = await boot({ features: [recovery], platform });
    await answerDialog(b.workbench, "later");
    b.workbench.replaceText(b.id, "run two");
    await settle(3000);
    expect(platform.recovery.size).toBe(2);
    expect(first).toBeDefined();
  });

  it("clears the snapshot when the document is saved", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [recovery],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    await settle(3000);
    expect(platform.recovery.size).toBe(1);
    await workbench.save(id);
    await settle(0);
    expect(platform.recovery.size).toBe(0);
  });

  it("does not write one at all if saved before the interval", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [recovery],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    await workbench.save(id);
    await settle(10_000);
    expect(platform.recovery.size).toBe(0);
  });

  it("clears the snapshot when the document becomes clean again", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [recovery],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    await settle(3000);
    expect(platform.recovery.size).toBe(1);
    workbench.replaceText(id, "one");
    await settle(0);
    expect(platform.recovery.size).toBe(0);
    await settle(10_000);
    expect(platform.recovery.size).toBe(0);
  });

  it("clears the snapshot when the user closes the document without saving", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [recovery] });
    workbench.replaceText(id, "draft");
    await settle(3000);
    expect(platform.recovery.size).toBe(1);
    const closing = workbench.closeDocument(id);
    await answerDialog(workbench, "discard");
    await closing;
    await settle(0);
    expect(platform.recovery.size).toBe(0);
  });

  it("keeps the snapshot if the user cancels closing", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [recovery] });
    workbench.replaceText(id, "draft");
    await settle(3000);
    const closing = workbench.closeDocument(id);
    await answerDialog(workbench, "cancel");
    expect(await closing).toBe(false);
    expect(platform.recovery.size).toBe(1);
  });

  it("clears snapshots on a clean shutdown where the user chose not to save", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [recovery] });
    workbench.replaceText(id, "draft");
    await settle(3000);
    expect(platform.recovery.size).toBe(1);
    const closing = platform.requestClose();
    await answerDialog(workbench, "close");
    expect(await closing).toBe(true);
    expect(platform.recovery.size).toBe(0);
  });

  it("leaves the snapshot if the user cancels quitting", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [recovery] });
    workbench.replaceText(id, "draft");
    await settle(3000);
    const closing = platform.requestClose();
    await answerDialog(workbench, "cancel");
    expect(await closing).toBe(false);
    expect(platform.recovery.size).toBe(1);
  });
});

describe("restoring after a crash", () => {
  const snapshots = [
    { id: "old-1", path: "/a.md", text: "recovered a", savedMs: 5_000 },
    { id: "old-2", path: null, text: "recovered untitled", savedMs: 4_000 },
  ];

  async function bootWithSnapshots(extra: Parameters<typeof boot>[0]["features"] = []) {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    const platform = new MemoryPlatform();
    platform.seedFile("/a.md", "original a\r\n", utf16Crlf);
    // seedFile stamps "now"; make the snapshot newer than the file.
    const file = platform.files.get("/a.md")!;
    file.modifiedMs = 1_000;
    return boot({ features: [recovery, ...extra], platform, snapshots });
  }

  it("lists the snapshots in an accessible dialog and restores all of them", async () => {
    const { platform, workbench } = await bootWithSnapshots();
    const dialog = workbench.ui.getState().dialogs[0]!;
    expect(dialog.title).toBe("Recover unsaved work?");
    expect(dialog.message).toContain("a.md");
    expect(dialog.message).toContain("/a.md");
    expect(dialog.message).toContain("Untitled");
    expect(dialog.actions.map((a) => a.label)).toEqual([
      "Restore all",
      "Discard all",
      "Choose individually…",
      "Decide later",
    ]);
    expect(dialog.cancelValue).toBe("later");

    await answerDialog(workbench, "restore");
    const docs = workbench.documents.getState().documents;
    // The blank start-up tab is replaced.
    expect(docs.map((d) => d.title).sort()).toEqual(["Untitled-2", "a.md"]);
    const a = docs.find((d) => d.title === "a.md")!;
    expect(workbench.getText(a.id)).toBe("recovered a");
    expect(workbench.isDirty(a.id)).toBe(true);
    const untitled = docs.find((d) => d.path === null)!;
    expect(workbench.getText(untitled.id)).toBe("recovered untitled");
    expect(workbench.isDirty(untitled.id)).toBe(true);

    // The snapshots stay until the documents are saved or closed.
    expect(platform.recovery.size).toBe(2);
  });

  it("saves a restored document back to its original path with its original format", async () => {
    const { platform, workbench } = await bootWithSnapshots();
    await answerDialog(workbench, "restore");
    const a = workbench.documents.getState().documents.find((d) => d.title === "a.md")!;
    expect(a.path).toBe("/a.md");
    expect(a.format).toEqual(utf16Crlf);
    expect(await workbench.save(a.id)).toBe(true);
    expect(platform.files.get("/a.md")).toMatchObject({
      text: "recovered a",
      format: { encoding: "utf-16le", bom: true, eol: "crlf" },
    });
    await settle(0);
    expect(platform.recovery.has("old-1")).toBe(false);
    expect(platform.recovery.has("old-2")).toBe(true);
  });

  it("says when the file on disk is newer than the snapshot, and asks before overwriting it", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    platform.seedFile("/a.md", "edited elsewhere", utf16Crlf);
    platform.files.get("/a.md")!.modifiedMs = 9_000; // after the snapshot's 5_000
    const { workbench } = await boot({
      features: [recovery, externalChanges],
      platform,
      snapshots: [snapshots[0]!],
    });
    const dialog = workbench.ui.getState().dialogs[0]!;
    expect(dialog.message).toContain("The file on disk is newer than this copy.");

    await answerDialog(workbench, "restore");
    const a = workbench.documents.getState().documents.find((d) => d.title === "a.md")!;
    const saving = workbench.save(a.id);
    await answerDialog(workbench, "cancel");
    expect(await saving).toBe(false);
    expect(platform.files.get("/a.md")?.text).toBe("edited elsewhere");
  });

  it("does not claim the file is newer when it is not", async () => {
    const { workbench } = await bootWithSnapshots();
    expect(workbench.ui.getState().dialogs[0]!.message).not.toContain("newer");
  });

  it("discards everything on Discard all", async () => {
    const { platform, workbench } = await bootWithSnapshots();
    await answerDialog(workbench, "discard");
    expect(platform.recovery.size).toBe(0);
    expect(workbench.documents.getState().documents.map((d) => d.title)).toEqual(["Untitled-1"]);
  });

  it("leaves snapshots alone on Decide later or Escape", async () => {
    const { platform, workbench } = await bootWithSnapshots();
    await answerDialog(workbench, "later");
    expect(platform.recovery.size).toBe(2);
    expect(workbench.documents.getState().documents).toHaveLength(1);
  });

  it("lets the user choose for each snapshot", async () => {
    const { platform, workbench } = await bootWithSnapshots();
    await answerDialog(workbench, "choose");
    // Newest first: a.md, then the untitled one.
    expect(workbench.ui.getState().dialogs[0]!.title).toBe("Recover a.md?");
    await answerDialog(workbench, "discard");
    expect(workbench.ui.getState().dialogs[0]!.title).toBe("Recover Untitled?");
    await answerDialog(workbench, "restore");
    const docs = workbench.documents.getState().documents;
    expect(docs.map((d) => d.title)).toEqual(["Untitled-2"]);
    expect(workbench.getText(docs[0]!.id)).toBe("recovered untitled");
    expect(platform.recovery.has("old-1")).toBe(false);
    expect(platform.recovery.has("old-2")).toBe(true);
  });

  it("restores a document whose file has gone, so Save recreates it", async () => {
    vi.useFakeTimers();
    const { platform, workbench } = await boot({
      features: [recovery],
      snapshots: [{ id: "gone", path: "/gone.md", text: "still here", savedMs: 1 }],
    });
    await answerDialog(workbench, "restore");
    const doc = workbench.documents.getState().documents.find((d) => d.title === "gone.md")!;
    expect(workbench.isDirty(doc.id)).toBe(true);
    expect(await workbench.save(doc.id)).toBe(true);
    expect(platform.files.get("/gone.md")?.text).toBe("still here");
    expect(workbench.isDirty(doc.id)).toBe(false);
  });

  it("shows nothing when there are no snapshots", async () => {
    vi.useFakeTimers();
    const { workbench } = await boot({ features: [recovery] });
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
  });

  it("drops a snapshot that matches the file, since nothing is left to recover", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    platform.seedFile("/same.md", "same");
    const { workbench } = await boot({
      features: [recovery],
      platform,
      snapshots: [{ id: "same", path: "/same.md", text: "same", savedMs: 1 }],
    });
    await answerDialog(workbench, "restore");
    expect(platform.recovery.size).toBe(0);
  });
});
