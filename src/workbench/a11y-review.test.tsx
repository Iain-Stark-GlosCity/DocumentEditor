/** Accessibility and keyboard regression tests found by a review of the workbench widgets. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { QuickPick } from "./QuickPick";
import { matchesKey } from "./keys";
import { TabStrip } from "./TabStrip";
import { editorView, pressKey, renderApp } from "./test-helpers";
import type { OpenDocument } from "../core/documents";
import { DEFAULT_FILE_FORMAT } from "../platform/platform";

const doc = (id: string, title: string): OpenDocument => ({
  id,
  path: `/${title}`,
  providerId: "markdown",
  format: { ...DEFAULT_FILE_FORMAT },
  savedText: "",
  modifiedMs: 0,
  title,
});

describe("confirm dialog", () => {
  const actions = [
    { value: "close", label: "Close and discard changes" },
    { value: "cancel", label: "Cancel" },
  ];

  it("starts on the safe action when one is named, not on the destructive first one", () => {
    render(
      <ConfirmDialog
        title="Close without saving?"
        message="m"
        actions={actions}
        cancelValue="cancel"
        initialFocus="cancel"
        onChoose={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("starts on the first action by default", () => {
    render(
      <ConfirmDialog
        title="t"
        message="m"
        actions={actions}
        cancelValue="cancel"
        onChoose={() => {}}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close and discard changes" }),
    );
  });

  it("brings Tab back into the dialog when focus has strayed onto its text", () => {
    render(
      <ConfirmDialog
        title="t"
        message="m"
        actions={actions}
        cancelValue="cancel"
        onChoose={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    const text = dialog.querySelector<HTMLElement>("#dialog-message")!;
    text.tabIndex = -1;
    text.focus();
    expect(document.activeElement).toBe(text);
    fireEvent.keyDown(text, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close and discard changes" }),
    );
    text.focus();
    fireEvent.keyDown(text, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("answers Escape with the cancel value", () => {
    const onChoose = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        actions={actions}
        cancelValue="cancel"
        onChoose={onChoose}
      />,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });
});

describe("menu bar after the mouse", () => {
  it("moves into a menu that was opened by clicking when ArrowDown or ArrowUp is pressed", async () => {
    renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    const file = screen.getByRole("menuitem", { name: "File" });
    fireEvent.click(file);
    expect(file.getAttribute("aria-expanded")).toBe("true");
    file.focus();
    fireEvent.keyDown(file, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toMatch(/^New file/);

    fireEvent.keyDown(screen.getByRole("menu", { name: "File" }), { key: "Escape" });
    fireEvent.click(file);
    file.focus();
    fireEvent.keyDown(file, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toMatch(/^Close tab/);
  });
});

describe("tab strip", () => {
  const docs = [doc("a", "a.md"), doc("b", "b.md"), doc("c", "c.md")];

  it("closes the focused tab with Delete, and moves from the focused tab with the arrows", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <TabStrip documents={docs} activeId="a" dirty={{}} onSelect={onSelect} onClose={onClose} />,
    );
    const second = screen.getByRole("tab", { name: "b.md" });
    second.focus();
    fireEvent.keyDown(second, { key: "Delete" });
    expect(onClose).toHaveBeenCalledWith("b");

    // Focus is on b although a is active (a click on a close button does this): go on from b.
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("scrolls the active tab into view when it changes", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const { rerender } = render(
        <TabStrip
          documents={docs}
          activeId="a"
          dirty={{}}
          onSelect={() => {}}
          onClose={() => {}}
        />,
      );
      scroll.mockClear();
      rerender(
        <TabStrip
          documents={docs}
          activeId="c"
          dirty={{}}
          onSelect={() => {}}
          onClose={() => {}}
        />,
      );
      expect(scroll).toHaveBeenCalled();
    } finally {
      // @ts-expect-error jsdom does not define it; remove what this test added
      delete Element.prototype.scrollIntoView;
    }
  });

  it("keeps one tab in the tab order and marks the rest as roving", () => {
    render(
      <TabStrip documents={docs} activeId="b" dirty={{}} onSelect={() => {}} onClose={() => {}} />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });
});

describe("palette and quick pick wording", () => {
  it("says '1 command' and '1 choice', not '1 commands'", async () => {
    const { workbench } = renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    act(() => workbench.openPalette());
    const input = await screen.findByRole("combobox", { name: "Type a command" });
    fireEvent.change(input, { target: { value: "Go to line" } });
    const status = within(screen.getByRole("dialog", { name: "Command palette" })).getByRole(
      "status",
    );
    expect(status.textContent).toBe("1 command");

    const onClose = vi.fn();
    render(<QuickPick title="Pick one" items={[{ value: 1, label: "Only" }]} onClose={onClose} />);
    const pick = screen.getByRole("dialog", { name: "Pick one" });
    expect(within(pick).getByRole("status").textContent).toBe("1 choice");
  });

  it("ignores the Enter that ends an input-method composition", async () => {
    const onClose = vi.fn();
    render(<QuickPick title="Pick one" items={[{ value: 1, label: "Only" }]} onClose={onClose} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalledWith(1);
  });
});

describe("shortcuts", () => {
  it("does not take AltGr (Ctrl+Alt) for a shortcut, as it types a character", () => {
    const altGr = new KeyboardEvent("keydown", { key: "o", ctrlKey: true, altKey: true });
    expect(matchesKey(altGr, "Mod-Alt-o")).toBe(true);
    const typed = new KeyboardEvent("keydown", {
      key: "o",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });
    expect(matchesKey(typed, "Mod-Alt-o")).toBe(false);
  });

  it("does not run a command behind the quick pick", async () => {
    const { workbench } = renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    void workbench.pick([{ value: 1, label: "One" }], { title: "Pick" });
    await screen.findByRole("dialog", { name: "Pick" });
    pressKey("n");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    await waitFor(() => expect(editorView()).toBeTruthy());
  });
});

describe("side pane sizes", () => {
  it("keeps a hand-edited size inside the range the splitter reports", async () => {
    const { workbench } = renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    act(() => {
      workbench.settings.set("ui.paneSizes", { outline: 99, preview: 1 });
      workbench.settings.set("outline.visible", true);
    });
    const splitter = await screen.findByRole("separator", { name: "Resize outline" });
    expect(Number(splitter.getAttribute("aria-valuenow"))).toBe(85);
    expect(splitter.getAttribute("aria-valuemax")).toBe("85");
    const pane = screen.getByRole("region", { name: "Outline" });
    expect(pane.style.flexBasis).toBe("85%");
  });
});
