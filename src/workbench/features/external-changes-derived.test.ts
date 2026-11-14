import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormatRegistry } from "../../core/registry";
import { MemoryPlatform } from "../../platform/memory";
import { stubProvider } from "../test-helpers";
import { Workbench } from "../workbench";
import { externalChanges } from "./external-changes";
import { messages, settle } from "./safety-test-helpers";

const SETTLE = 200;
const started: Workbench[] = [];

afterEach(() => {
  for (const workbench of started.splice(0)) workbench.dispose();
  vi.useRealTimers();
});

/** A read-only format with a binary view, like the Word Formatting view. */
async function boot() {
  vi.useFakeTimers();
  const registry = new FormatRegistry();
  registry.register(stubProvider);
  registry.register({
    kind: "text",
    id: "derived",
    name: "Derived",
    fileExtensions: ["drv"],
    viewModes: ["source"],
    readOnly: true,
    binary: { decode: async () => "" },
    editorExtensions: () => [],
  });
  const platform = new MemoryPlatform();
  platform.seedFile("/r.drv", "line one\nline two\nline three");
  platform.requestOpen(["/r.drv"]);
  const workbench = new Workbench({
    platform,
    registry,
    features: [externalChanges],
    settingsSaveDelayMs: 5,
  });
  started.push(workbench);
  workbench.start();
  await settle(1);
  return { platform, workbench, id: workbench.activeDocument()!.id };
}

describe("a derived, read-only document", () => {
  it("refreshes silently when its regenerated text differs, keeping the cursor", async () => {
    const { platform, workbench, id } = await boot();
    const view = new EditorView({ state: workbench.getEditorState(id)!, parent: document.body });
    workbench.attachView(view);
    view.dispatch({ selection: { anchor: 3 } });
    platform.seedFile("/r.drv", "line one\nline 2\nline three\nline four");
    platform.triggerFileChange("/r.drv");
    await settle(SETTLE);
    expect(view.state.doc.toString()).toBe("line one\nline 2\nline three\nline four");
    expect(view.state.selection.main.head).toBe(3);
    expect(messages(workbench)).toEqual([]);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    view.destroy();
  });

  it("does nothing at all when the regenerated text is identical", async () => {
    const { platform, workbench, id } = await boot();
    const before = workbench.getText(id);
    platform.seedFile("/r.drv", "line one\nline two\nline three");
    platform.triggerFileChange("/r.drv");
    await settle(SETTLE);
    expect(messages(workbench)).toEqual([]);
    expect(workbench.getText(id)).toBe(before);
  });
});
