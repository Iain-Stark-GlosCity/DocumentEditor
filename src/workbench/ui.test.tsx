import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { editorView, makeWorkbench, pressKey, renderApp } from "./test-helpers";

const editorHasFocus = () => document.activeElement === document.querySelector(".cm-content");

async function start() {
  const app = renderApp();
  await screen.findByRole("tab", { name: "Untitled-1" });
  await waitFor(() => expect(editorHasFocus()).toBe(true));
  return app;
}

const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });
/** Every item of one menu, whatever its kind (item, checkbox or radio). */
const itemsIn = (menu: HTMLElement) => [
  ...menu.querySelectorAll<HTMLElement>(':scope > li > [role^="menuitem"]'),
];

describe("menu bar", () => {
  it("has the four menus with the expected File items and shown keybindings", async () => {
    await start();
    const bar = screen.getByRole("menubar");
    const tops = within(bar).getAllByRole("menuitem", { name: /^(File|Edit|View|Help)$/ });
    expect(tops.map((t) => t.textContent)).toEqual(["File", "Edit", "View", "Help"]);

    fireEvent.click(menuItem("File"));
    const menu = screen.getByRole("menu", { name: "File" });
    const labels = itemsIn(menu).map((i) => i.textContent);
    expect(labels).toEqual([
      "New fileCtrl+N",
      "Open file…Ctrl+O",
      "SaveCtrl+S",
      "Save as…Ctrl+Shift+S",
      "Autosave",
      "Close tabCtrl+W",
    ]);
    expect(menuItem("File").getAttribute("aria-expanded")).toBe("true");
  });

  it("contains Edit, View and Help items", async () => {
    await start();
    const textsOf = (top: string) => {
      fireEvent.click(menuItem(top));
      return itemsIn(screen.getByRole("menu", { name: top })).map((i) => i.textContent);
    };
    expect(textsOf("Edit")).toEqual([
      "UndoCtrl+Z",
      "RedoCtrl+Y",
      "CutCtrl+X",
      "CopyCtrl+C",
      "PasteCtrl+V",
      "Select allCtrl+A",
      "FindCtrl+F",
      "ReplaceCtrl+H",
      "Find nextF3",
      "Find previousShift+F3",
      "Select next occurrenceCtrl+D",
      "Select all occurrencesCtrl+Shift+L",
      "Go to lineCtrl+G",
      "Spellcheck",
      "Insert image…",
    ]);
    expect(textsOf("View")).toEqual([
      "Word wrapAlt+Z",
      "Line numbers",
      "Zoom inCtrl+=",
      "Zoom outCtrl+-",
      "Reset zoomCtrl+0",
      "OutlineCtrl+Shift+O",
      "Go to heading…Ctrl+Alt+O",
      "Go to next headingAlt+PageDown",
      "Go to previous headingAlt+PageUp",
      "Theme›",
      "View mode›",
      "Split previewAlt+P",
      "Switch focus between editor and previewF6",
      "Typewriter mode",
      "Focus mode",
      "Zen modeCtrl+Alt+Z",
      "Command paletteCtrl+Shift+P",
      "Word count",
    ]);
    expect(textsOf("Help")).toEqual(["About DocumentEditor"]);
  });

  it("is operated entirely from the keyboard, and Escape returns focus to the editor", async () => {
    await start();
    pressKey("F10", { ctrlKey: false });
    await waitFor(() => expect(document.activeElement).toBe(menuItem("File")));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(menuItem("Edit"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "File" });
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^New file/));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toMatch(/^Open file/);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toMatch(/^Close tab/);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toMatch(/^New file/);
    fireEvent.keyDown(menu, { key: "s" });
    expect(document.activeElement?.textContent).toMatch(/^Save/);

    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "Edit" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Edit" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menuItem("Edit"));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(editorHasFocus()).toBe(true);
  });

  it("runs the focused item with Enter and puts focus back in the editor", async () => {
    await start();
    pressKey("F10", { ctrlKey: false });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^New file/));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    await screen.findByRole("tab", { name: "Untitled-2" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(editorHasFocus()).toBe(true));
  });

  it("focuses the bar when Alt is tapped on its own, but not for Alt combinations", async () => {
    await start();
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyDown(window, { key: "z", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(document.activeElement).not.toBe(menuItem("File"));
    // Alt-z toggled word wrap; put it back so the next assertion is about Alt alone.
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    await waitFor(() => expect(document.activeElement).toBe(menuItem("File")));
  });

  it("disables items that need a document, and does not run them", async () => {
    await start();
    pressKey("w");
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    fireEvent.click(menuItem("File"));
    const save = within(screen.getByRole("menu")).getByRole("menuitem", { name: /^SaveCtrl\+S$/ });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    // Still open: nothing was activated.
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("changes settings from the View menu", async () => {
    const { workbench } = await start();
    fireEvent.click(menuItem("View"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Line numbers/ }));
    expect(workbench.settings.get("editor.lineNumbers")).toBe(true);
    fireEvent.click(menuItem("View"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Zoom in/ }));
    expect(workbench.settings.get("editor.fontSize")).toBe(15);
  });

  it("shows toggles and choices as checked items, with choices in submenus", async () => {
    const { workbench } = await start();
    fireEvent.click(menuItem("View"));
    const wrap = screen.getByRole("menuitemcheckbox", { name: /^Word wrap/ });
    expect(wrap.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: /^Line numbers/ }).getAttribute("aria-checked"),
    ).toBe("false");

    const theme = menuItem("Theme");
    expect(theme.getAttribute("aria-haspopup")).toBe("menu");
    theme.focus();
    fireEvent.keyDown(theme, { key: "ArrowRight" });
    const sub = screen.getByRole("menu", { name: "Theme" });
    const radios = within(sub).getAllByRole("menuitemradio");
    expect(radios.map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([
      ["Follow system", "true"],
      ["Light", "false"],
      ["Dark", "false"],
    ]);
    await waitFor(() => expect(document.activeElement).toBe(radios[0]));
    fireEvent.keyDown(sub, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(sub, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Theme" })).toBeNull();
    expect(document.activeElement).toBe(menuItem("Theme"));
    expect(screen.getByRole("menu", { name: "View" })).toBeTruthy();

    fireEvent.click(menuItem("Theme"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(workbench.settings.get("appearance.theme")).toBe("dark");
  });

  it("shows an About dialog", async () => {
    await start();
    fireEvent.click(menuItem("Help"));
    fireEvent.click(screen.getByRole("menuitem", { name: /About/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("DocumentEditor");
    expect(dialog.textContent).toMatch(/version \d+\.\d+\.\d+/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});

describe("command palette", () => {
  it("opens with Ctrl+Shift+P and F1, filters, and runs the chosen command", async () => {
    await start();
    pressKey("P", { shiftKey: true });
    const input = await screen.findByRole("combobox", { name: "Type a command" });
    expect(screen.getByRole("dialog", { name: "Command palette" }).getAttribute("aria-modal")).toBe(
      "true",
    );
    await waitFor(() => expect(document.activeElement).toBe(input));
    const listbox = screen.getByRole("listbox", { name: "Commands" });
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(within(listbox).getAllByRole("option").length).toBeGreaterThan(10);
    // Keybindings are shown.
    expect(within(listbox).getByRole("option", { name: /Save as….*Ctrl\+Shift\+S/ })).toBeTruthy();

    fireEvent.change(input, { target: { value: "new" } });
    const options = within(listbox).getAllByRole("option");
    expect(options[0]?.textContent).toMatch(/^New file/);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("tab", { name: "Untitled-2" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    await waitFor(() => expect(editorHasFocus()).toBe(true));

    fireEvent.keyDown(window, { key: "F1" });
    expect(await screen.findByRole("combobox")).toBeTruthy();
  });

  it("moves with the arrow keys and wraps", async () => {
    await start();
    pressKey("P", { shiftKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "zoom" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[2]?.getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape and restores focus to the editor", async () => {
    await start();
    pressKey("P", { shiftKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(editorHasFocus()).toBe(true);
  });

  it("says when nothing matches and does nothing on Enter", async () => {
    await start();
    pressKey("P", { shiftKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "qqqqqq" } });
    expect(screen.getByText("No matching commands")).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("does not let shortcuts through while it is open", async () => {
    await start();
    pressKey("P", { shiftKey: true });
    await screen.findByRole("combobox");
    pressKey("n");
    expect(screen.queryByRole("tab", { name: "Untitled-2" })).toBeNull();
  });
});

describe("tabs", () => {
  it("switch with Ctrl+Tab and Ctrl+Shift+Tab", async () => {
    await start();
    pressKey("n");
    await screen.findByRole("tab", { name: "Untitled-2" });
    const selected = () => screen.getByRole("tab", { selected: true }).textContent;
    expect(selected()).toBe("Untitled-2");
    pressKey("Tab");
    expect(selected()).toBe("Untitled-1");
    pressKey("Tab", { shiftKey: true });
    expect(selected()).toBe("Untitled-2");
  });

  it("close on middle-click", async () => {
    await start();
    pressKey("n");
    const second = await screen.findByRole("tab", { name: "Untitled-2" });
    fireEvent(second, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Untitled-2" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Untitled-1" })).toBeTruthy();
  });

  it("ignore other mouse buttons for closing", async () => {
    await start();
    const tab = screen.getByRole("tab", { name: "Untitled-1" });
    fireEvent(tab, new MouseEvent("auxclick", { button: 2, bubbles: true }));
    expect(screen.getByRole("tab", { name: "Untitled-1" })).toBeTruthy();
  });
});

describe("empty state", () => {
  it("appears with buttons and shortcuts when the last tab closes", async () => {
    await start();
    expect(screen.queryByText("No document open", { selector: "h2" })).toBeNull();
    pressKey("w");
    const heading = await screen.findByRole("heading", { name: "No document open" });
    const state = heading.parentElement!;
    expect(within(state).getByText("Ctrl+N")).toBeTruthy();
    expect(within(state).getByText("Ctrl+O")).toBeTruthy();
    expect(within(state).getByText("F1")).toBeTruthy();
    fireEvent.click(within(state).getByRole("button", { name: "New file" }));
    await screen.findByRole("tab", { name: "Untitled-2" });
    expect(screen.queryByRole("heading", { name: "No document open" })).toBeNull();
  });

  it("Open file… in the empty state opens the file dialog", async () => {
    const { platform } = await start();
    platform.seedFile("/a/b.md", "hi\n");
    pressKey("w");
    await screen.findByRole("heading", { name: "No document open" });
    platform.queueOpenDialog(["/a/b.md"]);
    fireEvent.click(screen.getByRole("button", { name: "Open file…" }));
    await screen.findByRole("tab", { name: "b.md" });
  });
});

describe("settings applied live", () => {
  it("sets data-theme, resolving system to light or dark", async () => {
    const { workbench } = await start();
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => workbench.settings.set("appearance.theme", "dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => workbench.settings.set("appearance.theme", "system"));
    expect(document.documentElement.dataset.theme).toBe("light");
    await workbench.runCommand("view.cycleTheme");
    expect(workbench.settings.get("appearance.theme")).toBe("light");
  });

  it("toggles word wrap and changes font size, clamped to the allowed range", async () => {
    const { workbench } = await start();
    const content = () => document.querySelector(".cm-content")!;
    expect(content().classList.contains("cm-lineWrapping")).toBe(true);
    await workbench.runCommand("view.toggleWordWrap");
    expect(content().classList.contains("cm-lineWrapping")).toBe(false);

    for (let i = 0; i < 60; i++) await workbench.runCommand("view.zoomIn");
    expect(workbench.settings.get("editor.fontSize")).toBe(40);
    await workbench.runCommand("view.zoomReset");
    expect(workbench.settings.get("editor.fontSize")).toBe(14);
    for (let i = 0; i < 60; i++) await workbench.runCommand("view.zoomOut");
    expect(workbench.settings.get("editor.fontSize")).toBe(8);
  });

  it("applies the font size to the editor", async () => {
    const { workbench } = await start();
    act(() => workbench.settings.set("editor.fontSize", 23));
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain("font-size: 23px");
  });
});

describe("edit commands", () => {
  it("undo, redo and select all act on the editor", async () => {
    const { workbench } = await start();
    editorView().dispatch({ changes: { from: 0, insert: "hello" }, userEvent: "input.type" });
    await workbench.runCommand("edit.undo");
    expect(editorView().state.doc.toString()).toBe("");
    await workbench.runCommand("edit.redo");
    expect(editorView().state.doc.toString()).toBe("hello");
    await workbench.runCommand("edit.selectAll");
    expect(editorView().state.selection.main.to).toBe(5);
  });

  it("copy, cut and paste use the clipboard and keep the buffer on \\n", async () => {
    const { workbench } = await start();
    let clipboard = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => void (clipboard = t),
        readText: async () => "one\r\ntwo",
      },
    });
    editorView().dispatch({ changes: { from: 0, insert: "abc" } });
    editorView().dispatch({ selection: { anchor: 0, head: 2 } });
    await workbench.runCommand("edit.copy");
    expect(clipboard).toBe("ab");
    await workbench.runCommand("edit.cut");
    expect(editorView().state.doc.toString()).toBe("c");
    await workbench.runCommand("edit.paste");
    expect(editorView().state.doc.toString()).toBe("one\ntwoc");
  });
});

describe("React strict mode", () => {
  it("starts once despite the double effect, with one tab and one run per key press", async () => {
    const { platform, workbench } = makeWorkbench();
    let runs = 0;
    workbench.commands.register({
      id: "t.count",
      title: "Count",
      defaultKey: "Mod-Alt-k",
      run: () => void runs++,
    });
    render(
      <StrictMode>
        <App workbench={workbench} />
      </StrictMode>,
    );
    await screen.findByRole("tab", { name: "Untitled-1" });
    await workbench.ready;
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    pressKey("k", { altKey: true });
    expect(runs).toBe(1);
    pressKey("n");
    await screen.findByRole("tab", { name: "Untitled-2" });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(platform.windowTitle).toContain("Untitled-2");
  });
});
