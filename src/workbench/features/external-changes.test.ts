import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileFormat } from "../../platform/platform";
import { externalChanges } from "./external-changes";
import {
  answerDialog,
  boot,
  disposeAll,
  messages,
  pressAction,
  settle,
} from "./safety-test-helpers";

afterEach(() => {
  disposeAll();
  vi.useRealTimers();
});

const SETTLE = 200;
const feature = [externalChanges];

describe("own saves", () => {
  it("are not treated as external changes, whichever way round the watcher fires", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    const write = platform.writeFile.bind(platform);
    let when: "before" | "after" = "before";
    platform.writeFile = async (...args) => {
      if (when === "before") platform.triggerFileChange("/a.md");
      const result = await write(...args);
      if (when === "after") platform.triggerFileChange("/a.md");
      return result;
    };

    workbench.replaceText(id, "two");
    await workbench.save(id);
    await settle(SETTLE);
    expect(messages(workbench)).toEqual([]);

    when = "after";
    workbench.replaceText(id, "three");
    await workbench.save(id);
    await settle(SETTLE);
    expect(messages(workbench)).toEqual([]);
    expect(workbench.getText(id)).toBe("three");
    expect(workbench.isDirty(id)).toBe(false);
  });

  it("are not mistaken for external changes when the user keeps typing during the save", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    const saving = workbench.save(id);
    workbench.replaceText(id, "two and more");
    platform.triggerFileChange("/a.md");
    await saving;
    await settle(SETTLE);
    expect(messages(workbench)).toEqual([]);
    expect(workbench.getText(id)).toBe("two and more");
    expect(workbench.isDirty(id)).toBe(true);
  });
});

describe("a clean document", () => {
  it("is reloaded silently apart from a brief notice, keeping the cursor", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "line one\nline two\nline three" },
      open: ["/a.md"],
    });
    const view = new EditorView({ state: workbench.getEditorState(id)!, parent: document.body });
    workbench.attachView(view);
    view.dispatch({ selection: { anchor: 3 } });
    const before = workbench.activeDocument()!.modifiedMs;

    platform.seedFile("/a.md", "line one\nline 2\nline three\nline four");
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);

    expect(view.state.doc.toString()).toBe("line one\nline 2\nline three\nline four");
    expect(view.state.selection.main.head).toBe(3);
    expect(workbench.isDirty(id)).toBe(false);
    const doc = workbench.activeDocument()!;
    expect(doc.savedText).toBe("line one\nline 2\nline three\nline four");
    expect(doc.modifiedMs).toBeGreaterThan(before);
    expect(messages(workbench)).toEqual(["a.md changed on disk and was reloaded."]);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    view.destroy();
  });

  it("keeps the cursor on the same text when lines are added above it", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "alpha\nbeta" },
      open: ["/a.md"],
    });
    const view = new EditorView({ state: workbench.getEditorState(id)!, parent: document.body });
    workbench.attachView(view);
    view.dispatch({ selection: { anchor: 8 } }); // inside "beta"
    platform.seedFile("/a.md", "intro\nalpha\nbeta");
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    expect(view.state.sliceDoc(0, view.state.selection.main.head)).toBe("intro\nalpha\nbe");
    view.destroy();
  });

  it("does nothing if the new content is identical to the buffer", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "same" },
      open: ["/a.md"],
    });
    platform.seedFile("/a.md", "same"); // touched: new modified time, same text
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    expect(messages(workbench)).toEqual([]);
    expect(workbench.isDirty(id)).toBe(false);
  });

  it("is reloaded in a background tab too", async () => {
    vi.useFakeTimers();
    const { platform, workbench } = await boot({
      features: feature,
      files: { "/a.md": "a", "/b.md": "b" },
      open: ["/a.md", "/b.md"],
    });
    platform.seedFile("/a.md", "a changed");
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    const a = workbench.documents.getState().documents.find((d) => d.path === "/a.md")!;
    expect(workbench.getText(a.id)).toBe("a changed");
  });
});

describe("a dirty document", () => {
  async function conflict() {
    vi.useFakeTimers();
    const ctx = await boot({
      features: feature,
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    ctx.workbench.replaceText(ctx.id, "mine");
    ctx.platform.seedFile("/a.md", "theirs");
    ctx.platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    return ctx;
  }

  it("raises a non-modal notice with both choices and suspends autosave", async () => {
    const { workbench, id } = await conflict();
    const [note] = workbench.ui.getState().notifications;
    expect(note?.kind).toBe("warning");
    expect(note?.actions?.map((a) => a.label)).toEqual(["Reload from disk", "Keep my changes"]);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    expect(workbench.getText(id)).toBe("mine");
    expect(workbench.isAutosaveHeld(id)).toBe(true);
  });

  it("does not stack notices for repeated events about the same change", async () => {
    const { platform, workbench } = await conflict();
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    expect(workbench.ui.getState().notifications).toHaveLength(1);
  });

  it("Reload from disk discards the user's changes and resumes autosave", async () => {
    const { workbench, id } = await conflict();
    pressAction(workbench, "Reload from disk");
    await settle(0);
    expect(workbench.getText(id)).toBe("theirs");
    expect(workbench.isDirty(id)).toBe(false);
    expect(workbench.isAutosaveHeld(id)).toBe(false);
  });

  it("Keep my changes leaves autosave off and asks before the next manual save overwrites", async () => {
    const { platform, workbench, id } = await conflict();
    pressAction(workbench, "Keep my changes");
    expect(workbench.getText(id)).toBe("mine");
    expect(workbench.isAutosaveHeld(id)).toBe(true);

    const cancelled = workbench.save(id);
    await answerDialog(workbench, "cancel");
    expect(await cancelled).toBe(false);
    expect(platform.files.get("/a.md")?.text).toBe("theirs");

    const saving = workbench.save(id);
    await settle(0);
    const dialog = workbench.ui.getState().dialogs[0]!;
    expect(dialog.message).toContain("The file has changed on disk since you opened it");
    await answerDialog(workbench, "overwrite");
    expect(await saving).toBe(true);
    expect(platform.files.get("/a.md")?.text).toBe("mine");
    expect(workbench.isAutosaveHeld(id)).toBe(false);
    expect(workbench.isDirty(id)).toBe(false);
  });

  it("a later change on disk replaces the earlier notice", async () => {
    const { platform, workbench } = await conflict();
    platform.seedFile("/a.md", "theirs again");
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    expect(workbench.ui.getState().notifications).toHaveLength(1);
  });
});

describe("a removed file", () => {
  it("stays open and unsaved, and Save recreates it", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "keep me" },
      open: ["/a.md"],
    });
    platform.files.delete("/a.md");
    platform.triggerFileChange("/a.md", "removed");
    await settle(SETTLE);

    expect(messages(workbench)[0]).toContain("deleted or moved");
    expect(workbench.documents.getState().documents).toHaveLength(1);
    expect(workbench.getText(id)).toBe("keep me");
    expect(workbench.isDirty(id)).toBe(true);
    expect(workbench.isAutosaveHeld(id)).toBe(false); // autosave itself skips missing files

    // Closing prompts, because the only copy is in the editor.
    const closing = workbench.closeDocument(id);
    await settle(0);
    expect(workbench.ui.getState().dialogs[0]?.title).toContain("Save changes");
    await answerDialog(workbench, "cancel");
    expect(await closing).toBe(false);

    expect(await workbench.save(id)).toBe(true);
    expect(platform.files.get("/a.md")?.text).toBe("keep me");
    expect(workbench.isDirty(id)).toBe(false);
  });

  it("is not reported when a save-by-rename briefly removes it", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    platform.files.delete("/a.md");
    platform.triggerFileChange("/a.md", "removed");
    await settle(50);
    platform.seedFile("/a.md", "two");
    platform.triggerFileChange("/a.md", "modified");
    await settle(SETTLE);
    expect(workbench.getText(id)).toBe("two");
    expect(messages(workbench)).toEqual(["a.md changed on disk and was reloaded."]);
    expect(workbench.isDirty(id)).toBe(false);
  });
});

describe("saving over a changed file", () => {
  it("asks first even if no watcher event arrived", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    platform.seedFile("/a.md", "other");
    workbench.replaceText(id, "mine");
    const saving = workbench.save(id);
    await answerDialog(workbench, "cancel");
    expect(await saving).toBe(false);
    expect(platform.files.get("/a.md")?.text).toBe("other");

    const again = workbench.save(id);
    await answerDialog(workbench, "overwrite");
    expect(await again).toBe(true);
    expect(platform.files.get("/a.md")?.text).toBe("mine");
  });

  it("does not ask on an ordinary save", async () => {
    vi.useFakeTimers();
    const { workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    expect(await workbench.save(id)).toBe(true);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    workbench.replaceText(id, "three");
    expect(await workbench.save(id)).toBe(true);
  });
});

describe("watching", () => {
  it("stops when the document is closed and moves with Save as", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: feature,
      files: { "/a.md": "one", "/b.md": "b" },
      open: ["/a.md"],
    });
    const read = vi.spyOn(platform, "readFile");

    // Save as moves the watch to the new path.
    platform.queueSaveDialog("/new.md");
    expect(await workbench.saveAs(id)).toBe(true);
    read.mockClear();
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    expect(read).not.toHaveBeenCalled();
    platform.seedFile("/new.md", "changed elsewhere");
    platform.triggerFileChange("/new.md");
    await settle(SETTLE);
    expect(workbench.getText(id)).toBe("changed elsewhere");

    // Closing stops it.
    await workbench.closeDocument(id);
    read.mockClear();
    platform.triggerFileChange("/new.md");
    await settle(SETTLE);
    expect(read).not.toHaveBeenCalled();
  });

  it("starts for documents opened later", async () => {
    vi.useFakeTimers();
    const { platform, workbench } = await boot({ features: feature, files: { "/a.md": "one" } });
    await workbench.openPaths(["/a.md"]);
    platform.seedFile("/a.md", "two");
    platform.triggerFileChange("/a.md");
    await settle(SETTLE);
    const doc = workbench.documents.getState().documents.find((d) => d.path === "/a.md")!;
    expect(workbench.getText(doc.id)).toBe("two");
  });
});

describe("mixed line endings", () => {
  const mixed: FileFormat = { encoding: "utf-8", bom: false, eol: "crlf", mixedEol: true };

  it("is announced once on open, naming the style that saving will use", async () => {
    vi.useFakeTimers();
    const { workbench } = await boot({
      features: feature,
      files: { "/m.md": { text: "a\nb\nc", format: mixed } },
      open: ["/m.md"],
    });
    expect(messages(workbench)).toHaveLength(1);
    expect(messages(workbench)[0]).toContain("Windows (CRLF)");

    const lf = await boot({
      features: feature,
      files: { "/m.md": { text: "a", format: { ...mixed, eol: "lf" } } },
      open: ["/m.md"],
    });
    expect(messages(lf.workbench)[0]).toContain("Unix (LF)");
  });

  it("is not announced for a file with consistent endings", async () => {
    vi.useFakeTimers();
    const { workbench } = await boot({
      features: feature,
      files: { "/a.md": "plain" },
      open: ["/a.md"],
    });
    expect(messages(workbench)).toEqual([]);
  });

  it("is cleared by a save", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [],
      files: { "/m.md": { text: "a\nb", format: mixed } },
      open: ["/m.md"],
    });
    expect(workbench.activeDocument()?.format.mixedEol).toBe(true);
    workbench.replaceText(id, "a\nb\nc");
    await workbench.save(id);
    expect(workbench.activeDocument()?.format).toEqual({ ...mixed, mixedEol: false });
    expect(platform.files.get("/m.md")?.format.eol).toBe("crlf");
  });
});
