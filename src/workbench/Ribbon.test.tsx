import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextFormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { createRegistry } from "../create-registry";
import { MemoryPlatform } from "../platform/memory";
import { App } from "./App";
import { createRibbonStore, groupsThatFit, type GroupModel } from "./ribbon-model";
import { editorView, pressKey } from "./test-helpers";
import { Workbench } from "./workbench";
import { defaultFeatures } from "./features";
import { setZenMode } from "./zen";

const NOTE = "C:\\docs\\note.md";
const TEXT = "# Title\n\nSome **bold** words.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- item\n";

async function setup(options: { registry?: FormatRegistry; text?: string } = {}) {
  const platform = new MemoryPlatform();
  platform.seedFile(NOTE, options.text ?? TEXT);
  const workbench = new Workbench({
    platform,
    registry: options.registry ?? createRegistry(),
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await act(async () => {
    await workbench.ready;
    await workbench.openPaths([NOTE]);
  });
  return { workbench };
}

const toolbar = () => screen.getByRole("toolbar", { name: "Formatting" });
const button = (name: string | RegExp) => within(toolbar()).getByRole("button", { name });
const moveTo = (offset: number) =>
  act(() => editorView().dispatch({ selection: { anchor: offset } }));
const at = (needle: string, extra = 0) => TEXT.indexOf(needle) + extra;
const inEditor = () => editorView().dom.contains(document.activeElement);

// A provider that is not Markdown, to show the ribbon only follows what a provider declares.
function declaredProvider(): TextFormatProvider {
  const ran: string[] = [];
  const provider: TextFormatProvider = {
    kind: "text",
    id: "markdown",
    name: "Plain",
    fileExtensions: ["md"],
    viewModes: ["source"],
    editorExtensions: () => [],
    commands: [
      { id: "plain.shout", title: "Shout", defaultKey: "Mod-j", run: () => !!ran.push("shout") },
      {
        id: "plain.off",
        title: "Unavailable",
        enabled: () => false,
        active: () => true,
        run: () => !!ran.push("off"),
      },
      { id: "plain.later", title: "Later", run: () => true },
    ],
    toolbar: [
      {
        id: "one",
        label: "One",
        items: [
          { command: "plain.shout", icon: "M1 1h14" },
          { command: "plain.off", icon: "M2 2h12" },
          { command: "plain.missing", icon: "M3 3h10" },
        ],
      },
      {
        id: "two",
        label: "Two",
        visible: (state) => state.doc.length > 100,
        items: [{ command: "plain.later", icon: "M4 4h8" }],
      },
    ],
  };
  Object.assign(provider, { ran });
  return provider;
}

afterEach(() => vi.unstubAllGlobals());

describe("ribbon from a provider's declaration", () => {
  it("draws the declared groups, taking titles and keys from the command registry", async () => {
    const registry = new FormatRegistry();
    registry.register(declaredProvider());
    await setup({ registry });
    const groups = within(toolbar()).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["One"]);
    const shout = button("Shout");
    expect(shout.getAttribute("aria-keyshortcuts")).toBe("Control+J");
    expect(shout.querySelector("path")?.getAttribute("d")).toBe("M1 1h14");
    // A command that is not registered leaves no button.
    expect(within(toolbar()).getAllByRole("button")).toHaveLength(2);
  });

  it("reflects disabled and pressed state with ARIA, and ignores clicks when disabled", async () => {
    const registry = new FormatRegistry();
    const provider = declaredProvider();
    registry.register(provider);
    await setup({ registry });
    const off = button("Unavailable");
    expect(off.getAttribute("aria-disabled")).toBe("true");
    // A disabled command is never shown as pressed.
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(button("Shout").hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(off);
    expect((provider as unknown as { ran: string[] }).ran).toEqual([]);
    fireEvent.click(button("Shout"));
    expect((provider as unknown as { ran: string[] }).ran).toEqual(["shout"]);
  });

  it("shows a conditional group only while its visible() says so", async () => {
    const registry = new FormatRegistry();
    registry.register(declaredProvider());
    await setup({ registry });
    expect(within(toolbar()).queryByRole("group", { name: "Two" })).toBeNull();
    act(() => editorView().dispatch({ changes: { from: 0, insert: "x".repeat(200) } }));
    await waitFor(() => expect(within(toolbar()).getByRole("group", { name: "Two" })).toBeTruthy());
  });

  it("renders nothing when the format has no toolbar, or no document is open", async () => {
    const registry = new FormatRegistry();
    registry.register({ ...declaredProvider(), toolbar: undefined });
    await setup({ registry });
    expect(document.querySelector(".ribbon")).toBeNull();

    const none = new Workbench({
      platform: new MemoryPlatform(),
      registry: createRegistry(),
      features: defaultFeatures,
      settingsSaveDelayMs: 5,
    });
    const { unmount } = render(<App workbench={none} />);
    await act(async () => {
      await none.ready;
      none.documents.setState({ documents: [], activeId: null });
    });
    expect(document.querySelector(".ribbon")).toBeNull();
    unmount();
  });
});

describe("ribbon with the Markdown toolbar", () => {
  it("has the Text, Headings, Lists, Blocks and Insert groups", async () => {
    await setup();
    const groups = within(toolbar()).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Text",
      "Headings",
      "Lists",
      "Blocks",
      "Insert",
    ]);
    const names = (label: string) =>
      within(within(toolbar()).getByRole("group", { name: label }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"));
    expect(names("Text")).toEqual(["Bold", "Italic", "Strikethrough", "Inline code", "Link"]);
    expect(names("Lists")).toEqual(["Bulleted list", "Numbered list", "Task list"]);
    expect(names("Blocks")).toEqual(["Blockquote", "Code block", "Horizontal rule"]);
    expect(names("Insert")).toEqual(["Insert table", "Insert image…"]);
  });

  it("runs a command on click and leaves the selection and focus in the editor", async () => {
    await setup();
    const from = at("words");
    act(() => editorView().dispatch({ selection: { anchor: from, head: from + 5 } }));
    const bold = button("Bold");
    // Pressing must not take focus from the editor.
    expect(fireEvent.mouseDown(bold)).toBe(false);
    fireEvent.click(bold);
    expect(editorView().state.doc.toString()).toContain("**words**");
    expect(inEditor()).toBe(true);
    const { from: f, to } = editorView().state.selection.main;
    expect(editorView().state.sliceDoc(f, to)).toBe("words");
  });

  it("follows the cursor for pressed state", async () => {
    await setup();
    moveTo(at("bold", 2));
    await waitFor(() => expect(button("Bold").getAttribute("aria-pressed")).toBe("true"));
    expect(button("Italic").getAttribute("aria-pressed")).toBe("false");
    moveTo(at("words", 2));
    await waitFor(() => expect(button("Bold").getAttribute("aria-pressed")).toBe("false"));
    moveTo(at("item", 2));
    await waitFor(() => expect(button("Bulleted list").getAttribute("aria-pressed")).toBe("true"));
    expect(button("Numbered list").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the table group, last, only while the cursor is in a table", async () => {
    await setup();
    expect(within(toolbar()).queryByRole("group", { name: "Table" })).toBeNull();
    const before = within(toolbar())
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    moveTo(at("| 1"));
    const group = await within(toolbar()).findByRole("group", { name: "Table" });
    const all = within(toolbar()).getAllByRole("group");
    expect(all[all.length - 1]).toBe(group);
    expect(all.slice(0, -1).map((g) => g.getAttribute("aria-label"))).toEqual(before);
    const names = within(group)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Insert table row above",
      "Insert table row below",
      "Insert table column left",
      "Insert table column right",
      "Delete table row",
      "Delete table column",
      "Align table column left",
      "Centre table column",
      "Align table column right",
      "Sort table by column, ascending",
      "Sort table by column, descending",
      "Format table",
    ]);
    moveTo(at("Some"));
    await waitFor(() =>
      expect(within(toolbar()).queryByRole("group", { name: "Table" })).toBeNull(),
    );
  });

  it("shows the block type and sets it from the picker", async () => {
    await setup();
    const picker = () => button(/^Block type:/);
    moveTo(at("Title"));
    await waitFor(() => expect(picker().textContent).toBe("Heading 1"));
    moveTo(at("words"));
    await waitFor(() => expect(picker().textContent).toBe("Paragraph"));
    expect(picker().getAttribute("aria-haspopup")).toBe("menu");

    fireEvent.click(picker());
    const menu = screen.getByRole("menu", { name: "Block type" });
    const options = within(menu).getAllByRole("menuitemradio");
    expect(options.map((o) => o.textContent?.replace(/Ctrl.*/, ""))).toEqual([
      "Paragraph",
      ...[1, 2, 3, 4, 5, 6].map((n) => `Heading ${n}`),
    ]);
    expect(options[0]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(options[2] as HTMLElement);
    expect(editorView().state.doc.line(3).text).toBe("## Some **bold** words.");
    expect(screen.queryByRole("menu", { name: "Block type" })).toBeNull();
    expect(inEditor()).toBe(true);
  });

  it("opens the picker from the keyboard, moves with arrows, and Escape returns to the button", async () => {
    await setup();
    moveTo(at("words"));
    const picker = button(/^Block type:/);
    act(() => picker.focus());
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Block type" });
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^Paragraph/));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toMatch(/^Heading 1/);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Block type" })).toBeNull();
    expect(document.activeElement).toBe(picker);
  });
});

describe("keyboard", () => {
  it("has one tab stop and moves it with Left, Right, Home and End", async () => {
    await setup();
    const buttons = within(toolbar()).getAllByRole("button");
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[0]]);
    act(() => buttons[0]?.focus());
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[1]]);
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("activates with Enter semantics (click) and returns focus to the editor; Escape too", async () => {
    await setup();
    act(() => editorView().dispatch({ selection: { anchor: at("words"), head: at("words", 5) } }));
    const italic = button("Italic");
    act(() => italic.focus());
    fireEvent.click(italic, { detail: 0 });
    expect(editorView().state.doc.toString()).toContain("*words*");
    expect(inEditor()).toBe(true);

    act(() => button("Link").focus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(inEditor()).toBe(true);
  });

  it("is part of F6 pane cycling, ahead of the editor", async () => {
    await setup();
    expect(inEditor()).toBe(true);
    act(() => void pressKey("F6", { ctrlKey: false }));
    await waitFor(() => expect(toolbar().contains(document.activeElement)).toBe(true));
    expect((document.activeElement as HTMLElement | null)?.tabIndex).toBe(0);
    act(() => void pressKey("F6", { ctrlKey: false }));
    await waitFor(() => expect(inEditor()).toBe(true));
  });

  it("shows a tooltip with the title and shortcut on keyboard focus", async () => {
    await setup();
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => button("Bold").focus());
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe("BoldCtrl+B");
    act(() => button("Bold").blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("overflow", () => {
  type Observed = { callback: ResizeObserverCallback };
  function mockObserver(): { resize(width: number): void } {
    const seen: Observed[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          seen.push({ callback });
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    return {
      resize: (width) =>
        act(() => {
          for (const { callback } of seen) {
            callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
          }
        }),
    };
  }
  const groupNames = () =>
    within(toolbar())
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));

  it("moves groups that do not fit into a More popup, and back as the window grows", async () => {
    const observer = mockObserver();
    await setup();
    observer.resize(1264);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(groupNames()).toEqual(["Text", "Headings", "Lists", "Blocks", "Insert"]);

    observer.resize(560);
    expect(groupNames()).toEqual(["Text", "Headings", "Lists", "Blocks"]);
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    const popup = screen.getByRole("group", { name: "More formatting" });
    expect(within(popup).getByRole("group", { name: "Insert" })).toBeTruthy();
    expect(within(popup).getByRole("button", { name: "Insert table" })).toBeTruthy();

    // A button in the popup runs its command and closes it.
    fireEvent.click(within(popup).getByRole("button", { name: "Insert table" }));
    expect(screen.queryByRole("group", { name: "More formatting" })).toBeNull();
    expect(editorView().state.doc.toString()).toContain("|");

    observer.resize(1264);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("puts the contextual table group in the popup first as room runs out, and Escape closes it", async () => {
    const observer = mockObserver();
    await setup();
    moveTo(at("| 1"));
    await within(toolbar()).findByRole("group", { name: "Table" });
    observer.resize(900);
    expect(groupNames()).toEqual(["Text", "Headings", "Lists", "Blocks", "Insert"]);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    const popup = screen.getByRole("group", { name: "More formatting" });
    expect(within(popup).getByRole("button", { name: "Format table" })).toBeTruthy();
    fireEvent.keyDown(within(popup).getByRole("button", { name: "Format table" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("group", { name: "More formatting" })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("works out how many groups fit", () => {
    const group = (id: string, buttons: number): GroupModel => ({
      id,
      label: id,
      items: Array.from({ length: buttons }, (_, i) => ({
        kind: "button" as const,
        key: `${id}${i}`,
        command: `${id}${i}`,
        icon: "",
        title: "",
        keys: null,
        enabled: true,
        pressed: null,
      })),
    });
    const groups = [group("a", 5), group("b", 3), group("c", 12)];
    // 158 + 13 + 94 + 13 + 382 = 660 for everything.
    expect(groupsThatFit(groups, null)).toBe(3);
    expect(groupsThatFit(groups, 700)).toBe(3);
    expect(groupsThatFit(groups, 600)).toBe(2);
    expect(groupsThatFit(groups, 300)).toBe(1);
    expect(groupsThatFit(groups, 100)).toBe(0);
  });
});

describe("switching the ribbon off", () => {
  it("is hidden in zen mode and when ui.ribbon is off, and the View item toggles it", async () => {
    const { workbench } = await setup();
    expect(document.querySelector(".ribbon")).toBeTruthy();

    act(() => setZenMode(workbench, true));
    await waitFor(() => expect(document.querySelector(".ribbon")).toBeNull());
    act(() => setZenMode(workbench, false));
    await waitFor(() => expect(document.querySelector(".ribbon")).toBeTruthy());

    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    const item = screen.getByRole("menuitemcheckbox", { name: "Ribbon" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item);
    await waitFor(() => expect(document.querySelector(".ribbon")).toBeNull());
    expect(workbench.settings.get("ui.ribbon")).toBe(false);

    await act(() => workbench.runCommand("view.toggleRibbon"));
    await waitFor(() => expect(document.querySelector(".ribbon")).toBeTruthy());
  });
});

describe("re-rendering", () => {
  it("hands back the same groups until something visible changes", async () => {
    const { workbench } = await setup();
    const store = createRibbonStore(workbench);
    moveTo(at("words"));
    const first = store.getSnapshot();
    moveTo(at("words", 3));
    expect(store.getSnapshot()).toBe(first);
    moveTo(at("bold", 2));
    expect(store.getSnapshot()).not.toBe(first);
  });
});
