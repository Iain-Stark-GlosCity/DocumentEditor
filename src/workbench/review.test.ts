/** Regression tests for defects found in a review of the workbench controller. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import type { FileFormat } from "../platform/platform";
import { autosave } from "./features/autosave";
import { recovery } from "./features/recovery";
import { answerDialog, boot, disposeAll, messages, settle } from "./features/safety-test-helpers";
import { makeWorkbench } from "./test-helpers";

afterEach(() => {
  disposeAll();
  vi.useRealTimers();
});

/** A platform whose writes finish only when the test says so, and which records their order. */
class SlowPlatform extends MemoryPlatform {
  readonly order: string[] = [];
  private readonly releases: (() => void)[] = [];
  hold = true;

  override async writeFile(path: string, text: string, format: FileFormat) {
    this.order.push(`start:${text}`);
    if (this.hold) await new Promise<void>((resolve) => this.releases.push(resolve));
    const result = await super.writeFile(path, text, format);
    this.order.push(`end:${text}`);
    return result;
  }

  releaseNext(): void {
    this.releases.shift()?.();
  }
}

describe("commands and keys", () => {
  it("reports a command whose enabled check throws instead of rejecting", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    workbench.commands.register({
      id: "test.bad",
      title: "Bad",
      enabled: () => {
        throw new Error("boom");
      },
      run: () => {},
    });
    await expect(workbench.runCommand("test.bad")).resolves.toBeUndefined();
    expect(workbench.ui.getState().notifications.map((n) => n.message)).toEqual(["boom"]);
  });

  it("lets other shortcuts work when one command's enabled check throws", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    const run = vi.fn();
    workbench.commands.register({
      id: "test.bad",
      title: "Bad",
      defaultKey: "Mod-j",
      enabled: () => {
        throw new Error("boom");
      },
      run: () => {},
    });
    workbench.commands.register({ id: "test.good", title: "Good", defaultKey: "Mod-j", run });
    workbench.start();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", ctrlKey: true, cancelable: true }),
    );
    await settle(0).catch(() => {});
    expect(run).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    workbench.dispose();
  });

  it("does not run shortcuts behind an open quick pick", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    const run = vi.fn();
    workbench.commands.register({ id: "test.key", title: "Key", defaultKey: "Mod-j", run });
    workbench.start();
    void workbench.pick([{ value: 1, label: "One" }], { title: "Pick" });
    const event = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    workbench.dispose();
  });
});

describe("dispose", () => {
  it("answers pending dialogs and picks so nothing waits for ever, and clears them", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    workbench.start();
    const dialog = workbench.ask({
      title: "t",
      message: "m",
      actions: [{ value: "a", label: "A" }],
      cancelValue: "dismissed",
    });
    const pick = workbench.pick([{ value: 1, label: "One" }], { title: "Pick" });
    workbench.dispose();
    await expect(dialog).resolves.toBe("dismissed");
    await expect(pick).resolves.toBeNull();
    expect(workbench.ui.getState().dialogs).toEqual([]);
    expect(workbench.ui.getState().pick).toBeNull();
  });
});

describe("closing a tab", () => {
  it("joins a second request for a document that is already being closed", async () => {
    vi.useFakeTimers();
    const { workbench, id } = await boot({ features: [] });
    workbench.replaceText(id, "changed");
    const first = workbench.closeDocument(id);
    const second = workbench.closeDocument(id);
    await settle(0);
    expect(workbench.ui.getState().dialogs).toHaveLength(1);
    await answerDialog(workbench, "discard");
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(workbench.documents.getState().documents.some((d) => d.id === id)).toBe(false);
  });

  it("keeps the tab and its text when Cancel is chosen", async () => {
    vi.useFakeTimers();
    const { workbench, id } = await boot({ features: [] });
    workbench.replaceText(id, "keep me");
    const closing = workbench.closeDocument(id);
    await answerDialog(workbench, "cancel");
    await expect(closing).resolves.toBe(false);
    expect(workbench.getText(id)).toBe("keep me");
  });

  it("keeps the tab when Save fails", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    platform.seedFile("/a.md", "one");
    const { workbench, id } = await boot({ features: [], files: {}, open: ["/a.md"], platform });
    workbench.replaceText(id, "two");
    platform.writeFile = () => Promise.reject(new Error("disk full"));
    const closing = workbench.closeDocument(id);
    await answerDialog(workbench, "save");
    await expect(closing).resolves.toBe(false);
    expect(workbench.getText(id)).toBe("two");
    expect(messages(workbench).some((m) => m.includes("disk full"))).toBe(true);
  });

  it("waits for an automatic save in flight, then has nothing to ask", async () => {
    vi.useFakeTimers();
    const platform = new SlowPlatform();
    platform.seedFile("/a.md", "one");
    const { workbench, id } = await boot({
      features: [autosave],
      open: ["/a.md"],
      platform,
    });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 100);
    workbench.replaceText(id, "two");
    await settle(100);
    expect(platform.order).toEqual(["start:two"]);
    const closing = workbench.closeDocument(id);
    await settle(0);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    platform.releaseNext();
    await settle(0);
    await expect(closing).resolves.toBe(true);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    expect(platform.files.get("/a.md")?.text).toBe("two");
  });
});

describe("saving", () => {
  it("never lets a manual save and an automatic save of one document overlap", async () => {
    vi.useFakeTimers();
    const platform = new SlowPlatform();
    platform.seedFile("/a.md", "one");
    const { workbench, id } = await boot({ features: [autosave], open: ["/a.md"], platform });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 100);
    workbench.replaceText(id, "two");
    await settle(100); // the automatic save of "two" starts and waits
    workbench.replaceText(id, "three");
    const manual = workbench.save(id);
    await settle(0);
    // The manual write has not started: it queues behind the one in flight.
    expect(platform.order).toEqual(["start:two"]);
    platform.releaseNext();
    await settle(0);
    platform.releaseNext();
    await settle(0);
    await expect(manual).resolves.toBe(true);
    expect(platform.order).toEqual(["start:two", "end:two", "start:three", "end:three"]);
    // The file and the saved state agree.
    expect(platform.files.get("/a.md")?.text).toBe("three");
    expect(workbench.documents.getState().documents[0]?.savedText).toBe("three");
    expect(workbench.isDirty(id)).toBe(false);
  });

  it("asks before Save as replaces a file that is open in another tab, then closes that tab", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    platform.seedFile("/b.md", "other");
    const { workbench } = await boot({ features: [], open: ["/b.md"], platform });
    const mine = workbench.newFile()!;
    workbench.replaceText(mine, "mine");
    platform.queueSaveDialog("/B.md"); // another case, as Windows allows
    const saving = workbench.saveAs(mine);
    await answerDialog(workbench, "replace");
    await expect(saving).resolves.toBe(true);
    const docs = workbench.documents.getState().documents;
    expect(docs.map((d) => d.id)).toEqual([mine]);
    expect(docs[0]?.path).toBe("/B.md");
    expect(workbench.documents.getState().activeId).toBe(mine);
  });

  it("changes nothing when that question is answered Cancel", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    platform.seedFile("/b.md", "other");
    const { workbench } = await boot({ features: [], open: ["/b.md"], platform });
    const mine = workbench.newFile()!;
    workbench.replaceText(mine, "mine");
    platform.queueSaveDialog("/b.md");
    const saving = workbench.saveAs(mine);
    await answerDialog(workbench, "cancel");
    await expect(saving).resolves.toBe(false);
    expect(platform.files.get("/b.md")?.text).toBe("other");
    expect(workbench.documents.getState().documents).toHaveLength(2);
  });
});

describe("opening", () => {
  it("opens one tab for one file named with different case or slashes", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    platform.seedFile("C:\\docs\\a.md", "x");
    platform.seedFile("c:/DOCS/A.md", "x");
    const { workbench } = await boot({ features: [], platform });
    await workbench.openPaths(["C:\\docs\\a.md"]);
    await workbench.openPaths(["c:/DOCS/A.md"]);
    expect(workbench.documents.getState().documents.filter((d) => d.path !== null)).toHaveLength(1);
  });

  it("says so, and opens nothing, when the file has gone before it can be read", async () => {
    vi.useFakeTimers();
    const { workbench } = await boot({ features: [] });
    await workbench.openPaths(["/gone.md"]);
    expect(messages(workbench).some((m) => m.startsWith("Could not open /gone.md"))).toBe(true);
    expect(workbench.documents.getState().documents).toHaveLength(1);
    expect(workbench.activeDocument()?.path).toBeNull();
  });
});

describe("recovery on quit", () => {
  it("does not write a snapshot of what the user chose to discard", async () => {
    vi.useFakeTimers();
    const platform = new MemoryPlatform();
    const { workbench, id } = await boot({ features: [recovery], platform });
    workbench.replaceText(id, "typed a moment ago"); // snapshot timer pending
    const quitting = platform.requestClose();
    await answerDialog(workbench, "close");
    await expect(quitting).resolves.toBe(true);
    await settle(10_000); // the window would be gone, but the timer must not fire a write
    expect(platform.recovery.size).toBe(0);
  });
});
