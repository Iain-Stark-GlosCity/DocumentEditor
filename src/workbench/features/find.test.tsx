import { SearchQuery, getSearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Workbench } from "../workbench";
import { editorView, pressKey, renderApp } from "../test-helpers";

const TEXT = "foo bar foo baz foo";

async function openDocumentWithText(): Promise<Workbench> {
  const { workbench } = renderApp();
  await screen.findByRole("tab", { name: "Untitled-1" });
  act(() => {
    editorView().dispatch({ changes: { from: 0, insert: TEXT } });
  });
  return workbench;
}

function runCommand(workbench: Workbench, id: string): void {
  const command = workbench.commands.get(id);
  if (!command) throw new Error(`Command ${id} is not registered`);
  act(() => {
    void command.run();
  });
}

function selectedText(): string {
  const { state } = editorView();
  const { from, to } = state.selection.main;
  return state.sliceDoc(from, to);
}

const panel = () => document.querySelector<HTMLElement>(".cm-find")!;
const findInput = () => panel().querySelector<HTMLInputElement>("input[name=search]")!;
const replaceInput = () => panel().querySelector<HTMLInputElement>("input[name=replace]")!;
const replaceRow = () => replaceInput().closest<HTMLElement>(".cm-find-field")!;
const chevron = () => panel().querySelector<HTMLButtonElement>(".cm-find-chevron")!;
const counter = () => panel().querySelector<HTMLElement>(".cm-find-count")!.textContent;
const button = (name: string) =>
  panel().querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`)!;

function typeFind(text: string): void {
  act(() => {
    fireEvent.input(findInput(), { target: { value: text } });
  });
}

function key(el: HTMLElement, init: KeyboardEventInit): void {
  act(() => {
    fireEvent.keyDown(el, init);
  });
}

describe("find widget", () => {
  it("is a labelled search region with named controls and a polite status", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    expect(screen.getByRole("search", { name: "Find and replace" })).toBeTruthy();
    for (const name of [
      "Match case",
      "Whole word",
      "Regular expression",
      "Previous match",
      "Next match",
      "Close",
    ]) {
      expect(button(name), name).toBeTruthy();
    }
    expect(panel().querySelector(".cm-find-count")!.getAttribute("aria-live")).toBe("polite");
    expect(document.activeElement).toBe(findInput());
  });

  it("typing sets the query, selects the first match and shows the count", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    expect(counter()).toBe("");
    typeFind("foo");
    expect(getSearchQuery(editorView().state).search).toBe("foo");
    expect(selectedText()).toBe("foo");
    expect(editorView().state.selection.main.from).toBe(0);
    expect(counter()).toBe("1 of 3");
    expect(document.activeElement).toBe(findInput());
  });

  it("incremental search starts from the caret", async () => {
    const workbench = await openDocumentWithText();
    act(() => editorView().dispatch({ selection: { anchor: 5 } }));
    runCommand(workbench, "edit.find");
    typeFind("foo");
    expect(editorView().state.selection.main.from).toBe(8);
    expect(counter()).toBe("2 of 3");
  });

  it("shows No results as an error state", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    typeFind("zzz");
    expect(counter()).toBe("No results");
    expect(panel().querySelector(".cm-find-field")!.classList.contains("is-error")).toBe(true);
    typeFind("");
    expect(counter()).toBe("");
    expect(panel().querySelector(".cm-find-field")!.classList.contains("is-error")).toBe(false);
  });

  it("Enter and Shift+Enter move between matches and keep focus in the field", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    typeFind("foo");
    key(findInput(), { key: "Enter" });
    expect(counter()).toBe("2 of 3");
    key(findInput(), { key: "Enter" });
    expect(counter()).toBe("3 of 3");
    key(findInput(), { key: "Enter", shiftKey: true });
    expect(counter()).toBe("2 of 3");
    button("Next match").click();
    expect(counter()).toBe("3 of 3");
    button("Previous match").click();
    expect(counter()).toBe("2 of 3");
    expect(findInput().value).toBe("foo");
  });

  it("the toggles set the query and Alt+C, Alt+W and Alt+R work", async () => {
    const workbench = await openDocumentWithText();
    act(() => editorView().dispatch({ changes: { from: 0, insert: "Foo " } }));
    runCommand(workbench, "edit.find");
    typeFind("foo");
    expect(counter()).toMatch(/of 4$/);

    act(() => button("Match case").click());
    expect(button("Match case").getAttribute("aria-pressed")).toBe("true");
    expect(getSearchQuery(editorView().state).caseSensitive).toBe(true);
    expect(counter()).toMatch(/of 3$/);

    key(findInput(), { key: "c", code: "KeyC", altKey: true });
    expect(getSearchQuery(editorView().state).caseSensitive).toBe(false);

    key(findInput(), { key: "w", code: "KeyW", altKey: true });
    expect(getSearchQuery(editorView().state).wholeWord).toBe(true);
    expect(button("Whole word").getAttribute("aria-pressed")).toBe("true");

    key(findInput(), { key: "r", code: "KeyR", altKey: true });
    expect(getSearchQuery(editorView().state).regexp).toBe(true);
  });

  it("an invalid regular expression shows an error and never throws", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    act(() => button("Regular expression").click());
    expect(() => typeFind("(foo")).not.toThrow();
    expect(counter()).toBe("Invalid");
    expect(panel().querySelector(".cm-find-field")!.classList.contains("is-error")).toBe(true);
    expect(() => key(findInput(), { key: "Enter" })).not.toThrow();
    typeFind("fo+");
    expect(counter()).toBe("1 of 3");
  });

  it("caps the count at 999", async () => {
    const { workbench } = renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    act(() => editorView().dispatch({ changes: { from: 0, insert: "a ".repeat(1500) } }));
    runCommand(workbench, "edit.find");
    typeFind("a");
    expect(counter()).toBe("1 of 999+");
  });

  it("Replace replaces the current match and moves on; Replace all replaces the rest", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.replace");
    typeFind("foo");
    act(() => {
      fireEvent.input(replaceInput(), { target: { value: "qux" } });
    });
    key(replaceInput(), { key: "Enter" });
    expect(editorView().state.doc.toString()).toBe("qux bar foo baz foo");
    expect(selectedText()).toBe("foo");
    act(() => button("Replace (").click());
    expect(editorView().state.doc.toString()).toBe("qux bar qux baz foo");
    key(findInput(), { key: "Enter", ctrlKey: true, altKey: true });
    expect(editorView().state.doc.toString()).toBe("qux bar qux baz qux");
    expect(counter()).toBe("No results");
  });

  it("Replace all button replaces every match", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.replace");
    typeFind("foo");
    act(() => {
      fireEvent.input(replaceInput(), { target: { value: "x" } });
    });
    act(() => button("Replace all").click());
    expect(editorView().state.doc.toString()).toBe("x bar x baz x");
  });

  it("Escape closes the widget, refocuses the editor and keeps the match selected", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    typeFind("baz");
    key(findInput(), { key: "Escape" });
    expect(document.querySelector(".cm-find")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".cm-content"));
    expect(selectedText()).toBe("baz");
  });

  it("pre-fills the field from a single-line selection and selects its contents", async () => {
    const workbench = await openDocumentWithText();
    act(() => editorView().dispatch({ selection: { anchor: 4, head: 7 } }));
    runCommand(workbench, "edit.find");
    expect(findInput().value).toBe("bar");
    expect(findInput().selectionStart).toBe(0);
    expect(findInput().selectionEnd).toBe(3);
    expect(counter()).toBe("1 of 1");
  });

  it("keeps the last query when reopened", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    typeFind("baz");
    runCommand(workbench, "edit.closeFind");
    act(() => editorView().dispatch({ selection: { anchor: 0 } }));
    runCommand(workbench, "edit.find");
    expect(findInput().value).toBe("baz");
    expect(counter()).toBe("1 of 1".replace("1 of 1", "1 result"));
  });

  it("recounts when the document changes", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    typeFind("foo");
    act(() => editorView().dispatch({ changes: { from: 0, insert: "foo " } }));
    expect(counter()).toMatch(/of 4$/);
  });
});

describe("find and replace feature", () => {
  it("edit.find opens the search panel, and Mod-f does too", async () => {
    const workbench = await openDocumentWithText();
    expect(document.querySelector(".cm-find")).toBeNull();

    runCommand(workbench, "edit.find");
    expect(document.querySelector(".cm-find")).not.toBeNull();
    expect(searchPanelOpen(editorView().state)).toBe(true);

    runCommand(workbench, "edit.closeFind");
    expect(document.querySelector(".cm-find")).toBeNull();

    pressKey("f");
    expect(document.querySelector(".cm-find")).not.toBeNull();
  });

  it("edit.replace opens the widget with the replace row showing", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.replace");
    expect(replaceRow().hidden).toBe(false);
    expect(chevron().getAttribute("aria-expanded")).toBe("true");
  });

  it("edit.find keeps the replace row collapsed, and the chevron toggles it", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    expect(replaceRow().hidden).toBe(true);
    act(() => chevron().click());
    expect(replaceRow().hidden).toBe(false);
  });

  it("edit.findNext selects the next match after the caret", async () => {
    const workbench = await openDocumentWithText();
    act(() => {
      editorView().dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "foo" })),
        selection: { anchor: 1 },
      });
    });
    expect(getSearchQuery(editorView().state).search).toBe("foo");

    runCommand(workbench, "edit.findNext");
    const { from, to } = editorView().state.selection.main;
    expect([from, to]).toEqual([8, 11]);
    expect(selectedText()).toBe("foo");

    runCommand(workbench, "edit.findPrevious");
    expect(editorView().state.selection.main.from).toBe(0);
  });

  it("edit.selectNextOccurrence adds a selection range", async () => {
    const workbench = await openDocumentWithText();
    act(() => {
      editorView().dispatch({ selection: { anchor: 0, head: 3 } });
    });
    expect(editorView().state.selection.ranges.length).toBe(1);

    runCommand(workbench, "edit.selectNextOccurrence");
    expect(editorView().state.selection.ranges.length).toBe(2);
  });

  it("edit.selectAllOccurrences selects every match of the selection", async () => {
    const workbench = await openDocumentWithText();
    act(() => {
      editorView().dispatch({ selection: { anchor: 0, head: 3 } });
    });
    runCommand(workbench, "edit.selectAllOccurrences");
    expect(editorView().state.selection.ranges.length).toBe(3);
  });

  it("edit.closeFind removes the panel", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.find");
    expect(document.querySelector(".cm-find")).not.toBeNull();

    runCommand(workbench, "edit.closeFind");
    expect(document.querySelector(".cm-find")).toBeNull();
  });

  it("every command returns without throwing when no document is open", async () => {
    const { workbench } = renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    await act(() => workbench.closeDocument());
    expect(workbench.activeDocument()).toBeNull();

    const ids = [
      "edit.find",
      "edit.replace",
      "edit.findNext",
      "edit.findPrevious",
      "edit.selectNextOccurrence",
      "edit.selectAllOccurrences",
      "edit.goToLine",
      "edit.closeFind",
    ];
    for (const id of ids) {
      const command = workbench.commands.get(id);
      expect(command, id).toBeDefined();
      await expect(Promise.resolve().then(() => command!.run())).resolves.toBeUndefined();
    }
  });
});
