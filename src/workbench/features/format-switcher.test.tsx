import { redo, undo } from "@codemirror/commands";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../../create-registry";
import { MemoryPlatform } from "../../platform/memory";
import { App } from "../App";
import { editorView } from "../test-helpers";
import { Workbench } from "../workbench";
import { defaultFeatures } from "./index";

const NOTE = "C:\\docs\\note.md";
const TEXT = "# Title\n\nSome **bold** words.\n";

async function setup(options: { open?: boolean } = {}) {
  const platform = new MemoryPlatform();
  platform.seedFile(NOTE, TEXT);
  const workbench = new Workbench({
    platform,
    registry: createRegistry(),
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await act(async () => {
    await workbench.ready;
    if (options.open !== false) await workbench.openPaths([NOTE]);
  });
  return { platform, workbench };
}

const providerOf = (wb: Workbench) => wb.activeDocument()?.providerId;
const ribbon = () => screen.queryByRole("toolbar", { name: "Formatting" });
const formatButton = () => screen.getByRole("button", { name: /^Format:/ });
const dialog = () => screen.getByRole("dialog", { name: "Change format" });
const optionNames = () =>
  within(dialog())
    .getAllByRole("option")
    .map((o) => o.textContent);

async function switchTo(wb: Workbench, id: string) {
  await act(async () => {
    wb.documents.getState().setProvider(wb.activeDocument()?.id ?? "", id);
  });
}

describe("the format button", () => {
  it("names the active document's format and is absent with no document", async () => {
    const { workbench } = await setup({ open: false });
    // The start-up untitled document is Markdown.
    expect(formatButton().textContent).toBe("Markdown");
    expect(formatButton().getAttribute("aria-label")).toBe("Format: Markdown. Change format");
    await act(async () => {
      await workbench.closeDocument();
    });
    expect(screen.queryByRole("button", { name: /^Format:/ })).toBeNull();
  });

  it("opens the picker with the current format ticked, and focus returns to the editor", async () => {
    const { workbench } = await setup();
    fireEvent.click(formatButton());
    expect(optionNames()).toEqual(["\u2713Markdown (current).md", "Plain text.txt"]);
    expect(document.activeElement).toBe(within(dialog()).getByRole("combobox"));

    const input = within(dialog()).getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(providerOf(workbench)).toBe("text"));
    expect(screen.queryByRole("dialog", { name: "Change format" })).toBeNull();
    expect(formatButton().textContent).toBe("Plain text");
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("is in the Edit menu as 'Change format…' and in the palette", async () => {
    const { workbench } = await setup();
    expect(workbench.commands.get("file.changeFormat")?.title).toBe("Change format…");
    await act(async () => {
      await workbench.runCommand("file.changeFormat");
    });
    expect(dialog()).toBeTruthy();
  });
});

describe("the quick pick", () => {
  async function open() {
    const { workbench } = await setup();
    fireEvent.click(formatButton());
    return { workbench, input: within(dialog()).getByRole("combobox") };
  }

  it("follows the ARIA combobox and listbox pattern", async () => {
    const { input } = await open();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const list = within(dialog()).getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    const options = within(list).getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
  });

  it("moves with the arrows (wrapping) and chooses with Enter", async () => {
    const { workbench, input } = await open();
    const selected = () =>
      within(dialog())
        .getAllByRole("option")
        .findIndex((o) => o.getAttribute("aria-selected") === "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(1);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(0);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selected()).toBe(1);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(providerOf(workbench)).toBe("text"));
  });

  it("filters as you type", async () => {
    const { workbench, input } = await open();
    fireEvent.change(input, { target: { value: "plain" } });
    expect(optionNames()).toEqual(["Plain text.txt"]);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(providerOf(workbench)).toBe("text"));
    fireEvent.click(formatButton());
    fireEvent.change(within(dialog()).getByRole("combobox"), { target: { value: "zzz" } });
    expect(within(dialog()).queryAllByRole("option")).toHaveLength(0);
    expect(within(dialog()).getByRole("status").textContent).toBe("No matches");
  });

  it("closes on Escape without changing anything, and focus returns to the editor", async () => {
    const { workbench, input } = await open();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Change format" })).toBeNull();
    expect(providerOf(workbench)).toBe("markdown");
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("resolves workbench.pick with the value, or null when dismissed", async () => {
    const { workbench } = await setup();
    const items = [
      { value: 1, label: "One" },
      { value: 2, label: "Two" },
    ];
    let chosen: Promise<number | null> = Promise.resolve(null);
    act(() => {
      chosen = workbench.pick(items, { title: "Pick a number" });
    });
    fireEvent.click(screen.getByRole("option", { name: "Two" }));
    await expect(chosen).resolves.toBe(2);

    act(() => {
      chosen = workbench.pick(items, { title: "Pick a number" });
    });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await expect(chosen).resolves.toBeNull();
  });
});

describe("changing format", () => {
  it("hides and restores the ribbon and the split preview pane", async () => {
    const { workbench } = await setup();
    act(() => workbench.settings.set("editor.viewMode", "split"));
    await waitFor(() => expect(screen.getByRole("region", { name: "Preview" })).toBeTruthy());
    expect(ribbon()).not.toBeNull();

    await switchTo(workbench, "text");
    expect(ribbon()).toBeNull();
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();

    await switchTo(workbench, "markdown");
    expect(ribbon()).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("region", { name: "Preview" })).toBeTruthy());
  });

  it("clamps the view mode to what the format supports", async () => {
    const { workbench } = await setup();
    act(() => workbench.settings.set("editor.viewMode", "live"));
    await waitFor(() => expect(editorView().dom.classList.contains("cm-live")).toBe(true));
    expect(screen.getByRole("button", { name: /^View mode:/ }).textContent).toBe("Live preview");

    await switchTo(workbench, "text");
    expect(screen.getByRole("button", { name: /^View mode:/ }).textContent).toBe("Source");
    expect(editorView().dom.classList.contains("cm-live")).toBe(false);
    // The setting itself is kept, so going back to Markdown restores live preview.
    expect(workbench.settings.get("editor.viewMode")).toBe("live");

    await switchTo(workbench, "markdown");
    expect(screen.getByRole("button", { name: /^View mode:/ }).textContent).toBe("Live preview");
    expect(editorView().dom.classList.contains("cm-live")).toBe(true);
  });

  it("keeps text, cursor and undo history, and does not change the dirty state", async () => {
    const { workbench } = await setup();
    act(() =>
      editorView().dispatch({ changes: { from: 0, insert: "A" }, selection: { anchor: 3 } }),
    );
    const id = workbench.activeDocument()?.id ?? "";
    expect(workbench.isDirty(id)).toBe(true);
    const saved = workbench.activeDocument()?.savedText;

    await switchTo(workbench, "text");
    expect(workbench.isDirty(id)).toBe(true);
    expect(workbench.activeDocument()?.savedText).toBe(saved);
    expect(editorView().state.doc.toString()).toBe(`A${TEXT}`);
    expect(editorView().state.selection.main.head).toBe(3);

    // The edit made as Markdown can be undone as plain text, and redone after switching back.
    expect(undo(editorView())).toBe(true);
    expect(editorView().state.doc.toString()).toBe(TEXT);
    expect(workbench.isDirty(id)).toBe(false);
    await switchTo(workbench, "markdown");
    expect(workbench.isDirty(id)).toBe(false);
    expect(redo(editorView())).toBe(true);
    expect(editorView().state.doc.toString()).toBe(`A${TEXT}`);
    expect(workbench.isDirty(id)).toBe(true);
  });

  it("keeps a background document's state when it is switched while not shown", async () => {
    const { workbench, platform } = await setup();
    platform.seedFile("C:\\docs\\two.md", "two\n");
    await act(async () => {
      await workbench.openPaths(["C:\\docs\\two.md"]);
    });
    const first = workbench.documents.getState().documents[0];
    act(() => workbench.replaceText(first?.id ?? "", "changed\n"));
    await act(async () => {
      workbench.documents.getState().setProvider(first?.id ?? "", "text");
    });
    act(() => workbench.documents.getState().setActive(first?.id ?? ""));
    expect(ribbon()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("changed\n");
    expect(workbench.isDirty(first?.id ?? "")).toBe(true);
  });

  it("updates the outline and disables the format's commands", async () => {
    const { workbench } = await setup();
    const outline = await import("../outline-model");
    expect(outline.headingsOf(workbench)?.map((h) => h.text)).toEqual(["Title"]);
    expect(workbench.commands.get("markdown.toggleBold")?.enabled?.()).toBe(true);

    await switchTo(workbench, "text");
    expect(outline.headingsOf(workbench)).toBeNull();
    expect(workbench.commands.get("markdown.toggleBold")?.enabled?.()).toBe(false);

    await switchTo(workbench, "markdown");
    expect(workbench.commands.get("markdown.toggleBold")?.enabled?.()).toBe(true);
  });

  it("updates the outline panel", async () => {
    const { workbench } = await setup();
    act(() => workbench.settings.set("outline.visible", true));
    await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());
    expect(within(screen.getByRole("tree")).getByText("Title")).toBeTruthy();
    await switchTo(workbench, "text");
    await waitFor(() =>
      expect(screen.queryByText("Title", { selector: "[role=treeitem] *" })).toBeNull(),
    );
    expect(screen.queryByRole("treeitem")).toBeNull();
  });

  it("follows the format's spellcheck setting and leaves word count alone", async () => {
    const platform = new MemoryPlatform();
    platform.seedFile(NOTE, TEXT);
    const registry = createRegistry();
    // Plain text keeps spellcheck on; a data-style format turns it off. Register a stand-in.
    const { FormatRegistry } = await import("../../core/registry");
    const custom = new FormatRegistry();
    const [markdown, text] = registry.all();
    if (!markdown || !text) throw new Error("expected two formats");
    custom.register(markdown, { default: true });
    custom.register({
      ...text,
      id: "data",
      name: "Data",
      fileExtensions: ["dat"],
      spellcheck: false,
    });
    const workbench = new Workbench({
      platform,
      registry: custom,
      features: defaultFeatures,
      settingsSaveDelayMs: 5,
    });
    render(<App workbench={workbench} />);
    await act(async () => {
      await workbench.ready;
      await workbench.openPaths([NOTE]);
    });
    act(() => workbench.settings.set("editor.spellcheck", true));
    expect(editorView().contentDOM.getAttribute("spellcheck")).toBe("true");
    const words = () => screen.getByText(/words?$/).textContent;
    const before = words();

    await switchTo(workbench, "data");
    expect(editorView().contentDOM.getAttribute("spellcheck")).toBe("false");
    expect(words()).toBe(before);

    await switchTo(workbench, "markdown");
    expect(editorView().contentDOM.getAttribute("spellcheck")).toBe("true");
  });
});

describe("Save As re-resolution", () => {
  async function saveAs(workbench: Workbench, platform: MemoryPlatform, path: string) {
    platform.queueSaveDialog(path);
    await act(async () => {
      await workbench.saveAs();
    });
  }

  it("switches to the format that claims the new extension, and says so", async () => {
    const { workbench, platform } = await setup();
    await saveAs(workbench, platform, "C:\\docs\\x.txt");
    expect(providerOf(workbench)).toBe("text");
    expect(workbench.ui.getState().notifications.map((n) => n.message)).toContain(
      "Now treating this file as Plain text",
    );
    expect(ribbon()).toBeNull();
  });

  it("keeps the current format when no format claims the extension", async () => {
    const { workbench, platform } = await setup();
    await saveAs(workbench, platform, "C:\\docs\\x.xyz");
    expect(providerOf(workbench)).toBe("markdown");
    expect(workbench.ui.getState().notifications).toHaveLength(0);
  });

  it("keeps a switched format when saved as an unclaimed extension", async () => {
    const { workbench, platform } = await setup();
    await switchTo(workbench, "text");
    await saveAs(workbench, platform, "C:\\docs\\x.xyz");
    expect(providerOf(workbench)).toBe("text");
  });

  it("does not change the format on a plain Save to the existing path", async () => {
    const { workbench } = await setup();
    await switchTo(workbench, "text");
    act(() => workbench.replaceText(workbench.activeDocument()?.id ?? "", "edited\n"));
    await act(async () => {
      await workbench.save();
    });
    expect(workbench.activeDocument()?.path).toBe(NOTE);
    expect(providerOf(workbench)).toBe("text");
    expect(workbench.ui.getState().notifications).toHaveLength(0);
  });

  it("does not notify when the new extension belongs to the current format", async () => {
    const { workbench, platform } = await setup();
    await saveAs(workbench, platform, "C:\\docs\\renamed.md");
    expect(providerOf(workbench)).toBe("markdown");
    expect(workbench.ui.getState().notifications).toHaveLength(0);
  });

  it("counts the first save of an untitled document as a Save As", async () => {
    const { workbench, platform } = await setup({ open: false });
    expect(workbench.activeDocument()?.path).toBeNull();
    act(() => workbench.replaceText(workbench.activeDocument()?.id ?? "", "hello\n"));
    platform.queueSaveDialog("C:\\docs\\fresh.txt");
    await act(async () => {
      await workbench.save();
    });
    expect(providerOf(workbench)).toBe("text");
  });

  it("does not switch when the Save As dialog is cancelled", async () => {
    const { workbench, platform } = await setup();
    platform.queueSaveDialog(null);
    await act(async () => {
      await workbench.saveAs();
    });
    expect(providerOf(workbench)).toBe("markdown");
  });
});
