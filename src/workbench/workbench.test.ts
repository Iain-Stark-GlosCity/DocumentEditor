import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import type { Feature } from "./feature";
import { makeWorkbench } from "./test-helpers";

afterEach(() => vi.useRealTimers());

describe("Workbench controller", () => {
  it("opens an untitled document on start, and not when a file is requested", async () => {
    const a = makeWorkbench({ features: [] });
    a.workbench.start();
    await a.workbench.ready;
    expect(a.workbench.activeDocument()?.title).toBe("Untitled-1");
    a.workbench.dispose();

    const platform = new MemoryPlatform();
    platform.seedFile("/x/a.md", "hello\n");
    platform.requestOpen(["/x/a.md"]);
    const b = makeWorkbench({ platform, features: [] });
    b.workbench.start();
    await b.workbench.ready;
    expect(b.workbench.documents.getState().documents.map((d) => d.title)).toEqual(["a.md"]);
    b.workbench.dispose();
  });

  it("gets and replaces text without a mounted editor, tracking dirty state", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    workbench.start();
    await workbench.ready;
    const id = workbench.activeDocument()!.id;
    expect(workbench.getText(id)).toBe("");
    expect(workbench.isDirty(id)).toBe(false);
    workbench.replaceText(id, "draft");
    expect(workbench.getText(id)).toBe("draft");
    expect(workbench.activeEditorState()?.doc.toString()).toBe("draft");
    expect(workbench.isDirty(id)).toBe(true);
    expect(workbench.ui.getState().dirty[id]).toBe(true);
    workbench.replaceText(id, "");
    expect(workbench.ui.getState().dirty[id]).toBe(false);
    workbench.dispose();
  });

  it("notifies text changes, with optional debouncing per document", async () => {
    vi.useFakeTimers();
    const { workbench } = makeWorkbench({ features: [] });
    workbench.start();
    await vi.advanceTimersByTimeAsync(0);
    const id = workbench.activeDocument()!.id;
    const now = vi.fn();
    const later = vi.fn();
    workbench.onDidChangeText(now);
    const off = workbench.onDidChangeText(later, { debounceMs: 100 });
    workbench.replaceText(id, "a");
    workbench.replaceText(id, "ab");
    workbench.replaceText(id, "abc");
    expect(now).toHaveBeenCalledTimes(3);
    expect(later).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0]?.[0].state.doc.toString()).toBe("abc");
    workbench.replaceText(id, "x");
    off();
    vi.advanceTimersByTime(500);
    expect(later).toHaveBeenCalledTimes(1);
    workbench.dispose();
  });

  it("notifies when the active document changes", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    workbench.start();
    await workbench.ready;
    const seen: (string | null)[] = [];
    workbench.onDidChangeActiveDocument((d) => seen.push(d?.title ?? null));
    workbench.newFile();
    workbench.documents.getState().setActive(workbench.documents.getState().documents[0]!.id);
    expect(seen).toEqual(["Untitled-2", "Untitled-1"]);
    workbench.dispose();
  });

  it("queues dialogs and resolves each with its own choice", async () => {
    const { workbench } = makeWorkbench({ features: [] });
    const request = (title: string) => ({
      title,
      message: "",
      actions: [{ value: "ok", label: "OK" }],
      cancelValue: "ok",
    });
    const first = workbench.ask(request("first"));
    const second = workbench.ask(request("second"));
    const [head, next] = workbench.ui.getState().dialogs;
    expect(head?.title).toBe("first");
    workbench.resolveDialog(head!.id, "a");
    await expect(first).resolves.toBe("a");
    expect(workbench.ui.getState().dialogs[0]?.id).toBe(next!.id);
    workbench.resolveDialog(next!.id, "b");
    await expect(second).resolves.toBe("b");
  });

  it("shows and dismisses notifications with actions", () => {
    const { workbench } = makeWorkbench({ features: [] });
    const run = vi.fn();
    const handle = workbench.notify({ message: "Heads up", actions: [{ label: "Fix", run }] });
    expect(workbench.ui.getState().notifications).toHaveLength(1);
    handle.dismiss();
    expect(workbench.ui.getState().notifications).toHaveLength(0);
  });

  it("reports a failing command instead of throwing", async () => {
    const feature: Feature = {
      id: "boom",
      commands: () => [
        {
          id: "boom.go",
          title: "Go",
          run: () => {
            throw new Error("exploded");
          },
        },
      ],
    };
    const { workbench } = makeWorkbench({ features: [feature] });
    workbench.start();
    await workbench.runCommand("boom.go");
    expect(workbench.ui.getState().notifications[0]?.message).toBe("exploded");
    workbench.dispose();
  });

  it("keeps going when a feature fails to start, and says so", () => {
    const bad: Feature = {
      id: "bad",
      activate() {
        throw new Error("nope");
      },
    };
    const good: Feature = {
      id: "good",
      commands: () => [{ id: "good.go", title: "Go", run() {} }],
    };
    const { workbench } = makeWorkbench({ features: [bad, good] });
    workbench.start();
    expect(workbench.commands.get("good.go")).toBeDefined();
    expect(workbench.ui.getState().notifications[0]?.message).toContain('"bad"');
    workbench.dispose();
  });

  it("rejects duplicate feature ids", () => {
    const f: Feature = { id: "same" };
    expect(() => makeWorkbench({ features: [f, f] })).toThrow(/Duplicate feature id/);
  });

  it("dispose undoes commands, activation and the key handler, and start works again", async () => {
    const activated = vi.fn();
    const deactivated = vi.fn();
    const ran = vi.fn();
    const feature: Feature = {
      id: "life",
      commands: () => [{ id: "life.go", title: "Go", defaultKey: "Mod-Alt-g", run: ran }],
      activate() {
        activated();
        return deactivated;
      },
    };
    const { workbench } = makeWorkbench({ features: [feature] });
    const key = () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true, altKey: true }));
    workbench.start();
    key();
    expect(ran).toHaveBeenCalledTimes(1);
    workbench.dispose();
    expect(deactivated).toHaveBeenCalledTimes(1);
    expect(workbench.commands.get("life.go")).toBeUndefined();
    key();
    expect(ran).toHaveBeenCalledTimes(1);
    workbench.start();
    expect(activated).toHaveBeenCalledTimes(2);
    key();
    expect(ran).toHaveBeenCalledTimes(2);
    workbench.dispose();
  });

  it("lets a key fall through when its command is disabled, or to the next enabled command", () => {
    let on = false;
    const first = vi.fn();
    const second = vi.fn();
    const feature: Feature = {
      id: "keys",
      commands: () => [
        { id: "keys.a", title: "A", defaultKey: "Mod-Alt-j", enabled: () => on, run: first },
        { id: "keys.b", title: "B", defaultKey: "Mod-Alt-j", run: second },
      ],
    };
    const { workbench } = makeWorkbench({ features: [feature] });
    workbench.start();
    const press = () => {
      const event = new KeyboardEvent("keydown", {
        key: "j",
        ctrlKey: true,
        altKey: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    on = true;
    press();
    expect(first).toHaveBeenCalledTimes(1);
    workbench.dispose();
  });

  it("does not swallow the key of a disabled command", () => {
    const feature: Feature = {
      id: "keys",
      commands: () => [
        {
          id: "keys.off",
          title: "Off",
          defaultKey: "Mod-Alt-k",
          enabled: () => false,
          run: vi.fn(),
        },
      ],
    };
    const { workbench } = makeWorkbench({ features: [feature] });
    workbench.start();
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    workbench.dispose();
  });

  it("rebuilds a feature's editor extensions when a listed setting changes", async () => {
    const { workbench } = makeWorkbench();
    workbench.start();
    await workbench.ready;
    const id = workbench.activeDocument()!.id;
    const wrapping = () =>
      workbench
        .getEditorState(id)!
        .facet(EditorView.contentAttributes)
        .some((a) => typeof a !== "function" && a.class === "cm-lineWrapping");
    expect(wrapping()).toBe(true);
    workbench.settings.set("editor.wordWrap", false);
    expect(wrapping()).toBe(false);
    workbench.dispose();
  });

  it("loads settings from the platform and saves changes after a quiet period", async () => {
    const platform = new MemoryPlatform();
    platform.settingsJson = JSON.stringify({ "editor.fontSize": 20, "unknown.key": true });
    const { workbench } = makeWorkbench({ platform, features: [] });
    workbench.start();
    await workbench.ready;
    expect(workbench.settings.get("editor.fontSize")).toBe(20);
    // Loading must not write the file straight back.
    await new Promise((r) => setTimeout(r, 30));
    expect(platform.settingsJson).toContain("unknown.key");

    workbench.settings.set("appearance.theme", "dark");
    workbench.settings.set("editor.lineNumbers", true);
    await vi.waitFor(() => {
      expect(JSON.parse(platform.settingsJson ?? "{}")).toEqual({
        "editor.fontSize": 20,
        "appearance.theme": "dark",
        "editor.lineNumbers": true,
      });
    });
    workbench.dispose();
  });

  it("writes pending settings when disposed", async () => {
    const platform = new MemoryPlatform();
    const { workbench } = makeWorkbench({ platform, features: [] });
    workbench.start();
    await workbench.ready;
    workbench.settings.set("editor.wordWrap", false);
    workbench.dispose();
    await vi.waitFor(() =>
      expect(JSON.parse(platform.settingsJson ?? "{}")).toEqual({ "editor.wordWrap": false }),
    );
  });

  it("asks before closing a dirty document and quitting", async () => {
    const { platform, workbench } = makeWorkbench({ features: [] });
    workbench.start();
    await workbench.ready;
    const id = workbench.activeDocument()!.id;
    workbench.replaceText(id, "x");

    const quit = platform.requestClose();
    await vi.waitFor(() => expect(workbench.ui.getState().dialogs).toHaveLength(1));
    workbench.resolveDialog(workbench.ui.getState().dialogs[0]!.id, "cancel");
    await expect(quit).resolves.toBe(false);

    const closing = workbench.closeDocument(id);
    await vi.waitFor(() => expect(workbench.ui.getState().dialogs).toHaveLength(1));
    workbench.resolveDialog(workbench.ui.getState().dialogs[0]!.id, "discard");
    await expect(closing).resolves.toBe(true);
    expect(workbench.documents.getState().documents).toHaveLength(0);
    await expect(platform.requestClose()).resolves.toBe(true);
    workbench.dispose();
  });
});
