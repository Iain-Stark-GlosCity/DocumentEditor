import { EditorState, Text } from "@codemirror/state";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupOutline } from "../outline-test-helpers";
import { editorView, pressKey } from "../test-helpers";
import { dimmedLines, paragraphLines, typewriterExtension } from "./focus-mode";

const DOC = Text.of(["one", "two", "", "three", "four", "five", "", "", "six"]);

describe("paragraph and dimmed line ranges", () => {
  it("finds the blank-line separated paragraph around a line", () => {
    expect(paragraphLines(DOC, 5)).toEqual({ first: 4, last: 6 });
    expect(paragraphLines(DOC, 1)).toEqual({ first: 1, last: 2 });
    expect(paragraphLines(DOC, 9)).toEqual({ first: 9, last: 9 });
  });

  it("treats a blank line as its own block", () => {
    expect(paragraphLines(DOC, 3)).toEqual({ first: 3, last: 3 });
    expect(paragraphLines(DOC, 8)).toEqual({ first: 8, last: 8 });
  });

  it("stops scanning at the limits it is given", () => {
    expect(paragraphLines(DOC, 5, 5, 5)).toEqual({ first: 5, last: 5 });
  });

  it("dims every viewport line outside the current paragraph", () => {
    const head = DOC.line(5).from + 1;
    expect(dimmedLines(DOC, head, 1, 9)).toEqual([1, 2, 3, 7, 8, 9]);
    expect(dimmedLines(DOC, head, 4, 7)).toEqual([7]);
    expect(dimmedLines(DOC, head, 4, 6)).toEqual([]);
  });
});

describe("typewriter mode", () => {
  const state = () =>
    EditorState.create({ doc: "a\nb\nc\nd\n", extensions: [typewriterExtension()] });

  it("asks to centre the cursor after a selection or edit", () => {
    const moved = state().update({ selection: { anchor: 4 } });
    expect(moved.effects).toHaveLength(1);
    const typed = state().update({ changes: { from: 0, insert: "x" }, selection: { anchor: 1 } });
    expect(typed.effects).toHaveLength(1);
  });

  it("leaves pointer selections alone, so dragging and clicking do not fight it", () => {
    const clicked = state().update({ selection: { anchor: 4 }, userEvent: "select.pointer" });
    expect(clicked.effects).toHaveLength(0);
  });

  it("does nothing for transactions that change neither text nor selection", () => {
    expect(state().update({}).effects).toHaveLength(0);
  });
});

describe("focus mode in the editor", () => {
  it("dims lines outside the current paragraph and follows the cursor", async () => {
    const { workbench } = await setupOutline("one\ntwo\n\nthree\nfour\n");
    act(() => workbench.settings.set("editor.focusMode", true));
    const dimmed = () =>
      Array.from(document.querySelectorAll(".cm-line")).map((l) =>
        l.classList.contains("cm-focus-dim"),
      );
    await waitFor(() => expect(dimmed()).toEqual([false, false, true, true, true, true]));

    act(() => editorView().dispatch({ selection: { anchor: 12 } }));
    await waitFor(() => expect(dimmed()).toEqual([true, true, true, false, false, true]));

    act(() => workbench.settings.set("editor.focusMode", false));
    await waitFor(() => expect(document.querySelector(".cm-focus-dim")).toBeNull());
  });
});

describe("zen mode", () => {
  const chrome = () => ({
    menu: screen.queryByRole("menubar"),
    tabs: screen.queryByRole("tablist"),
    status: screen.queryByRole("contentinfo"),
  });

  it("hides the menu, tabs, status bar and side panes, and shows them again", async () => {
    const { workbench } = await setupOutline();
    act(() => workbench.settings.set("outline.visible", true));
    await screen.findByRole("region", { name: "Outline" });
    expect(chrome().menu && chrome().tabs && chrome().status).toBeTruthy();

    pressKey("z", { ctrlKey: true, altKey: true });
    await waitFor(() => expect(chrome()).toEqual({ menu: null, tabs: null, status: null }));
    expect(document.querySelector(".app--zen")).toBeTruthy();
    expect(document.querySelector<HTMLElement>(".side-pane")?.hidden).toBe(true);
    // The editor is still there and focused.
    expect(editorView().dom.contains(document.activeElement)).toBe(true);

    pressKey("z", { ctrlKey: true, altKey: true });
    await waitFor(() => expect(chrome().menu).toBeTruthy());
    expect(chrome().tabs).toBeTruthy();
    expect(chrome().status).toBeTruthy();
    expect(document.querySelector<HTMLElement>(".side-pane")?.hidden).toBe(false);
  });

  it("exits with Escape", async () => {
    const { workbench } = await setupOutline();
    await act(async () => {
      await workbench.runCommand("view.toggleZenMode");
    });
    expect(document.querySelector(".app--zen")).toBeTruthy();
    fireEvent.keyDown(editorView().contentDOM, { key: "Escape", bubbles: true });
    await waitFor(() => expect(document.querySelector(".app--zen")).toBeNull());
  });

  it("leaves Escape to the command palette, which still opens", async () => {
    const { workbench } = await setupOutline();
    await act(async () => {
      await workbench.runCommand("view.toggleZenMode");
    });
    pressKey("p", { shiftKey: true });
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.keyDown(palette, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    expect(document.querySelector(".app--zen")).toBeTruthy();
  });

  it("centres the text column at the configured width, or 80 characters in zen", async () => {
    const { workbench } = await setupOutline();
    const width = () => editorView().dom.className;
    const before = width();

    await act(async () => {
      await workbench.runCommand("view.toggleZenMode");
    });
    const inZen = width();
    expect(inZen).not.toBe(before);

    await act(async () => {
      await workbench.runCommand("view.exitZenMode");
    });
    expect(width()).toBe(before);

    act(() => workbench.settings.set("editor.maxLineWidth", 60));
    expect(width()).not.toBe(before);
    expect(width()).not.toBe(inZen);
  });

  it("is not saved: it never appears in the settings file", async () => {
    const { workbench } = await setupOutline();
    await act(async () => {
      await workbench.runCommand("view.toggleZenMode");
    });
    expect(workbench.settings.serialise()).not.toMatch(/zen/i);
  });
});
