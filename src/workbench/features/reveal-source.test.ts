import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceMapEntry } from "../../core/source-map";
import { FormatRegistry } from "../../core/registry";
import { MemoryPlatform } from "../../platform/memory";
import { DEFAULT_FILE_FORMAT } from "../../platform/platform";
import { stubProvider } from "../test-helpers";
import { Workbench } from "../workbench";
import { externalChanges } from "./external-changes";
import { REVEAL_SOURCE_COMMAND, revealSourceFeature } from "./reveal-source";
import { messages, settle } from "./safety-test-helpers";

const CONTAINER = "/c/r.drv";
const PART = `${CONTAINER}!/word/document.xml`;
const XML = `<w:document><w:body><w:p>One</w:p><w:p>Two <b>bold</b></w:p><w:tbl><w:tr><w:tc><w:p>Cell</w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
const entry = (fromLine: number, locator: string): SourceMapEntry => ({
  fromLine,
  toLine: fromLine,
  part: "word/document.xml",
  locator,
});
const MAP = [
  entry(2, "/w:document/w:body/w:p[2]"),
  entry(3, "/w:document/w:body/w:tbl/w:tr/w:tc/w:p"),
  entry(4, "/w:document/w:body/w:p[9]"),
];
const VIEW = "title\nTwo bold\nCell\nGone\nnothing mapped";

const LOCATED: Record<string, string> = {
  "/w:document/w:body/w:p[1]": "<w:p>One</w:p>",
  "/w:document/w:body/w:p[2]": "<w:p>Two <b>bold</b></w:p>",
  "/w:document/w:body/w:tbl/w:tr/w:tc/w:p": "<w:p>Cell</w:p>",
};

const started: Workbench[] = [];
const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const workbench of started.splice(0)) workbench.dispose();
  vi.useRealTimers();
});

async function boot(options: { attach?: boolean; map?: SourceMapEntry[] } = {}) {
  vi.useFakeTimers();
  const registry = new FormatRegistry();
  registry.register(stubProvider);
  registry.register({
    kind: "text",
    id: "xml",
    name: "XML",
    fileExtensions: ["xml"],
    viewModes: ["source"],
    // The real reader is the XML format's (tested there); this one knows the few elements used here.
    locate: (text, locator) => {
      const snippet = LOCATED[locator];
      const from = snippet === undefined ? -1 : text.indexOf(snippet);
      return from < 0 ? null : { from, to: from + snippet!.length };
    },
    editorExtensions: () => [],
  });
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
  platform.seedFile(CONTAINER, VIEW, DEFAULT_FILE_FORMAT, options.map ?? MAP);
  platform.seedFile(PART, XML);
  platform.requestOpen([CONTAINER]);
  const workbench = new Workbench({
    platform,
    registry,
    features: [revealSourceFeature, externalChanges],
    settingsSaveDelayMs: 5,
  });
  started.push(workbench);
  workbench.start();
  await settle(1);
  const container = workbench.activeDocument()!;
  let view: EditorView | undefined;
  const attach = () => {
    view = new EditorView({
      state: workbench.getEditorState(workbench.activeDocument()!.id)!,
      parent: document.body,
    });
    views.push(view);
    workbench.attachView(view);
    return view;
  };
  if (options.attach !== false) attach();
  return { platform, workbench, container, attach, view: () => view! };
}

/** Puts the cursor at the start of a line (1-based) of the view being shown. */
function cursorOnLine(view: EditorView, line: number): void {
  view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
}

const selected = (view: EditorView) =>
  view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

describe("the Reveal in source XML command", () => {
  it("keeps the source map of the opened view", async () => {
    const { container } = await boot();
    expect(container.sourceMap).toEqual(MAP);
  });

  it("is enabled only on a line that has a source", async () => {
    const { workbench, view } = await boot();
    const command = workbench.commands.get(REVEAL_SOURCE_COMMAND)!;
    expect(command.title).toBe("Reveal in source XML");
    expect(command.defaultKey).toBe("Mod-Alt-x");
    cursorOnLine(view(), 1);
    expect(command.enabled!()).toBe(false);
    cursorOnLine(view(), 2);
    expect(command.enabled!()).toBe(true);
    cursorOnLine(view(), 5);
    expect(command.enabled!()).toBe(false);
  });

  it("is disabled for a document without a source map", async () => {
    const { workbench, platform } = await boot();
    platform.seedFile("/c/plain.md", "a\nb");
    await workbench.openPaths(["/c/plain.md"]);
    expect(workbench.commands.get(REVEAL_SOURCE_COMMAND)!.enabled!()).toBe(false);
  });

  it("opens the part and selects the element behind the cursor line", async () => {
    const { workbench, view, container } = await boot();
    cursorOnLine(view(), 2);
    await workbench.runCommand(REVEAL_SOURCE_COMMAND);
    const active = workbench.activeDocument()!;
    expect(active.path).toBe(PART);
    expect(active.title).toBe("r.drv › document.xml");
    expect(selected(view())).toBe("<w:p>Two <b>bold</b></w:p>");
    expect(workbench.documents.getState().documents).toHaveLength(2);

    // From a table cell paragraph; the tab is reused, not opened twice.
    workbench.documents.getState().setActive(container.id);
    cursorOnLine(view(), 3);
    await workbench.runCommand(REVEAL_SOURCE_COMMAND);
    expect(workbench.activeDocument()!.path).toBe(PART);
    expect(selected(view())).toBe("<w:p>Cell</w:p>");
    expect(workbench.documents.getState().documents).toHaveLength(2);
  });

  it("says so, and still opens the part, when the element is not there any more", async () => {
    const { workbench, view } = await boot();
    cursorOnLine(view(), 4);
    await workbench.runCommand(REVEAL_SOURCE_COMMAND);
    expect(workbench.activeDocument()!.path).toBe(PART);
    expect(messages(workbench).join("\n")).toMatch(
      /Could not find that element in .*document\.xml/,
    );
    expect(selected(view())).toBe("");
  });
});

describe("Workbench.revealPart", () => {
  it("waits for the editor to show the tab before selecting", async () => {
    const { workbench, attach } = await boot({ attach: false });
    workbench.nextFrame = (callback) => void setTimeout(callback, 16);
    const done = workbench.revealPart(PART, "/w:document/w:body/w:p[1]");
    await settle(60);
    const view = attach();
    await settle(60);
    await expect(done).resolves.toBe(true);
    expect(selected(view)).toBe("<w:p>One</w:p>");
  });

  it("gives up waiting after about a second and keeps the selection in the stored state", async () => {
    const { workbench } = await boot({ attach: false });
    workbench.nextFrame = (callback) => void setTimeout(callback, 16);
    const done = workbench.revealPart(PART, "/w:document/w:body/w:p[1]");
    await settle(1200);
    await expect(done).resolves.toBe(true);
    const state = workbench.activeEditorState()!;
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe(
      "<w:p>One</w:p>",
    );
  });

  it("returns false, with a notification, when the file cannot be opened", async () => {
    const { workbench } = await boot();
    await expect(workbench.revealPart("/c/missing.xml", "/a")).resolves.toBe(false);
    expect(messages(workbench).join("\n")).toContain("Could not open /c/missing.xml");
  });

  it("only opens the file when no locator is given, and reuses an open tab", async () => {
    const { workbench } = await boot();
    await expect(workbench.revealPart(PART)).resolves.toBe(true);
    await expect(workbench.revealPart(PART)).resolves.toBe(true);
    expect(workbench.documents.getState().documents).toHaveLength(2);
    expect(workbench.activeDocument()!.path).toBe(PART);
  });

  it("never throws on a malformed locator", async () => {
    const { workbench } = await boot();
    await expect(workbench.revealPart(PART, "w:p[[")).resolves.toBe(true);
    expect(messages(workbench).join("\n")).toContain("Could not find that element");
  });
});

describe("a silent refresh of the view", () => {
  it("brings the new source map along, and the command uses it", async () => {
    const { workbench, platform, view, container } = await boot();
    const fresh = [entry(1, "/w:document/w:body/w:p[1]"), entry(2, "/w:document/w:body/w:p[2]")];
    platform.seedFile(CONTAINER, "One\nTwo bold\nCell\nGone\nnothing mapped", undefined, fresh);
    platform.triggerFileChange(CONTAINER);
    await settle(300);
    const doc = workbench.documents.getState().documents.find((d) => d.id === container.id)!;
    expect(doc.sourceMap).toEqual(fresh);
    expect(workbench.getText(container.id)).toBe("One\nTwo bold\nCell\nGone\nnothing mapped");

    cursorOnLine(view(), 1);
    expect(workbench.commands.get(REVEAL_SOURCE_COMMAND)!.enabled!()).toBe(true);
    await workbench.runCommand(REVEAL_SOURCE_COMMAND);
    expect(selected(view())).toBe("<w:p>One</w:p>");
  });

  it("clears the map when the regenerated view has none", async () => {
    const { workbench, platform, container } = await boot();
    platform.seedFile(CONTAINER, "changed text");
    platform.triggerFileChange(CONTAINER);
    await settle(300);
    const doc = workbench.documents.getState().documents.find((d) => d.id === container.id)!;
    expect(doc.sourceMap).toBeUndefined();
  });
});

describe("Workbench.removePartElement", () => {
  const ONE = "/w:document/w:body/w:p[1]";

  it("deletes exactly the located element, as an undoable edit that leaves the tab unsaved", async () => {
    const { workbench } = await boot();
    await expect(workbench.removePartElement(PART, ONE)).resolves.toBe(true);
    const id = workbench.activeDocument()!.id;
    expect(workbench.getText(id)).not.toContain("<w:p>One</w:p>");
    expect(workbench.getText(id)).toContain("<w:p>Two <b>bold</b></w:p>");
    expect(workbench.isDirty(id)).toBe(true);
  });

  it("does not delete the user's own selection when the locator no longer matches", async () => {
    const { workbench, view } = await boot();
    await workbench.revealPart(PART);
    const id = workbench.activeDocument()!.id;
    const before = workbench.getText(id)!;
    // The user has a paragraph selected in the part's tab.
    const from = before.indexOf("<w:p>Cell</w:p>");
    view().dispatch({ selection: { anchor: from, head: from + 15 } });
    await expect(workbench.removePartElement(PART, "/w:document/w:body/w:p[9]")).resolves.toBe(
      false,
    );
    expect(workbench.getText(id)).toBe(before);
    expect(messages(workbench).join("\n")).toContain("Could not find that element");
  });

  it("refuses, with a message, when the part's tab has unsaved edits", async () => {
    const { workbench } = await boot();
    await workbench.revealPart(PART);
    const id = workbench.activeDocument()!.id;
    workbench.replaceText(id, `<w:p>Typed</w:p>${workbench.getText(id)}`);
    const edited = workbench.getText(id);
    await expect(workbench.removePartElement(PART, ONE)).resolves.toBe(false);
    expect(workbench.getText(id)).toBe(edited);
    expect(messages(workbench).join("\n")).toContain("has unsaved changes");
  });

  it("returns false and changes nothing when the file cannot be opened or no editor shows", async () => {
    const { workbench } = await boot({ attach: false });
    workbench.nextFrame = (callback) => void setTimeout(callback, 16);
    await expect(workbench.removePartElement("/c/missing.xml", ONE)).resolves.toBe(false);
    const done = workbench.removePartElement(PART, ONE);
    await settle(1200);
    await expect(done).resolves.toBe(false);
    expect(workbench.getText(workbench.activeDocument()!.id)).toBe(XML);
  });
});
