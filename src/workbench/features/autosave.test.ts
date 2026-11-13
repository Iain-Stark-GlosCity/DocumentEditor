import { afterEach, describe, expect, it, vi } from "vitest";
import { autosave, autosaveStateLabel, shouldAutosave } from "./autosave";
import { externalChanges } from "./external-changes";
import { boot, disposeAll, messages, settle } from "./safety-test-helpers";

afterEach(() => {
  disposeAll();
  vi.useRealTimers();
});

describe("shouldAutosave", () => {
  const base = {
    mode: "afterDelay",
    trigger: "delay",
    path: "/a.md",
    dirty: true,
    held: false,
    saving: false,
  } as const;
  it("needs a path, unsaved changes, no hold and the matching mode", () => {
    expect(shouldAutosave(base)).toBe(true);
    expect(shouldAutosave({ ...base, path: null })).toBe(false);
    expect(shouldAutosave({ ...base, dirty: false })).toBe(false);
    expect(shouldAutosave({ ...base, held: true })).toBe(false);
    expect(shouldAutosave({ ...base, saving: true })).toBe(false);
    expect(shouldAutosave({ ...base, mode: "off" })).toBe(false);
    expect(shouldAutosave({ ...base, mode: "onFocusChange" })).toBe(false);
    expect(shouldAutosave({ ...base, mode: "onFocusChange", trigger: "focus" })).toBe(true);
    expect(shouldAutosave({ ...base, trigger: "focus" })).toBe(false);
  });
  it("labels the modes", () => {
    expect(autosaveStateLabel("off")).toBe("off");
    expect(autosaveStateLabel("afterDelay")).toBe("after delay");
    expect(autosaveStateLabel("onFocusChange")).toBe("on focus change");
  });
});

describe("autosave feature", () => {
  it("saves a dirty document after the delay, and not before", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [autosave],
      files: { "/a.md": "one\n" },
      open: ["/a.md"],
    });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 1000);
    workbench.replaceText(id, "two\n");
    await settle(999);
    expect(platform.files.get("/a.md")?.text).toBe("one\n");
    await settle(1);
    expect(platform.files.get("/a.md")?.text).toBe("two\n");
    expect(workbench.isDirty(id)).toBe(false);
  });

  it("restarts the delay on every edit", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [autosave],
      files: { "/a.md": "" },
      open: ["/a.md"],
    });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 1000);
    workbench.replaceText(id, "a");
    await settle(600);
    workbench.replaceText(id, "ab");
    await settle(600);
    expect(platform.files.get("/a.md")?.text).toBe("");
    await settle(400);
    expect(platform.files.get("/a.md")?.text).toBe("ab");
  });

  it("does nothing while off", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [autosave],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.replaceText(id, "two");
    await settle(60_000);
    expect(platform.files.get("/a.md")?.text).toBe("one");
  });

  it("never saves an untitled document or opens a Save dialog", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({ features: [autosave] });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.replaceText(id, "draft");
    await settle(10_000);
    expect(platform.files.size).toBe(0);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    expect(workbench.isDirty(id)).toBe(true);
  });

  it("is suspended while a conflict with the file on disk is unresolved", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [externalChanges, autosave],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 1000);
    workbench.replaceText(id, "mine");
    platform.seedFile("/a.md", "theirs");
    platform.triggerFileChange("/a.md");
    await settle(5000);
    expect(platform.files.get("/a.md")?.text).toBe("theirs");
    expect(workbench.isDirty(id)).toBe(true);
    expect(messages(workbench).some((m) => m.includes("changed on disk"))).toBe(true);
    // Further edits do not start autosaving either.
    workbench.replaceText(id, "mine, more");
    await settle(5000);
    expect(platform.files.get("/a.md")?.text).toBe("theirs");
  });

  it("does not overwrite a file that changed before the watcher noticed", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [externalChanges, autosave],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 1000);
    workbench.replaceText(id, "mine");
    platform.seedFile("/a.md", "theirs"); // no watcher event
    await settle(1000);
    expect(platform.files.get("/a.md")?.text).toBe("theirs");
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    // The conflict flow took over.
    expect(messages(workbench).some((m) => m.includes("changed on disk"))).toBe(true);
  });

  it("reports a failure once per document until a save succeeds", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [autosave],
      files: { "/a.md": "one" },
      open: ["/a.md"],
    });
    workbench.settings.set("files.autoSave", "afterDelay");
    workbench.settings.set("files.autoSaveDelayMs", 1000);
    const write = platform.writeFile.bind(platform);
    let failing = true;
    platform.writeFile = async (...args) => {
      if (failing) throw new Error("disk full");
      return write(...args);
    };
    const failures = () => messages(workbench).filter((m) => m.includes("disk full")).length;

    workbench.replaceText(id, "a");
    await settle(1000);
    expect(failures()).toBe(1);
    workbench.replaceText(id, "ab");
    await settle(1000);
    workbench.replaceText(id, "abc");
    await settle(1000);
    expect(failures()).toBe(1);

    failing = false;
    workbench.replaceText(id, "abcd");
    await settle(1000);
    expect(platform.files.get("/a.md")?.text).toBe("abcd");

    failing = true;
    workbench.replaceText(id, "abcde");
    await settle(1000);
    expect(failures()).toBe(2);
  });

  it("saves on window blur and when the active tab changes in focus-change mode", async () => {
    vi.useFakeTimers();
    const { platform, workbench, id } = await boot({
      features: [autosave],
      files: { "/a.md": "a", "/b.md": "b" },
      open: ["/a.md", "/b.md"],
    });
    workbench.settings.set("files.autoSave", "onFocusChange");
    const [a, b] = workbench.documents.getState().documents;
    expect(a && b).toBeTruthy();
    expect(id).toBe(b?.id);

    // Editing alone does not save.
    workbench.replaceText(b!.id, "b2");
    await settle(10_000);
    expect(platform.files.get("/b.md")?.text).toBe("b");

    // Switching tabs saves the one left.
    workbench.documents.getState().setActive(a!.id);
    await settle(0);
    expect(platform.files.get("/b.md")?.text).toBe("b2");

    // Losing window focus saves everything.
    workbench.replaceText(a!.id, "a2");
    window.dispatchEvent(new Event("blur"));
    await settle(0);
    expect(platform.files.get("/a.md")?.text).toBe("a2");
  });

  it("toggles with a command whose title shows the state", async () => {
    vi.useFakeTimers();
    const { workbench } = await boot({ features: [autosave] });
    expect(workbench.commands.get("files.toggleAutoSave")?.title).toBe("Autosave: off");
    await workbench.runCommand("files.toggleAutoSave");
    expect(workbench.settings.get("files.autoSave")).toBe("afterDelay");
    expect(workbench.commands.get("files.toggleAutoSave")?.title).toBe("Autosave: after delay");
    await workbench.runCommand("files.toggleAutoSave");
    expect(workbench.settings.get("files.autoSave")).toBe("off");
    expect(workbench.commands.get("files.toggleAutoSave")?.title).toBe("Autosave: off");
  });
});
