import { SearchQuery, getSearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { act, screen } from "@testing-library/react";
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

describe("find and replace feature", () => {
  it("edit.find opens the search panel, and Mod-f does too", async () => {
    const workbench = await openDocumentWithText();
    expect(document.querySelector(".cm-search")).toBeNull();

    runCommand(workbench, "edit.find");
    expect(document.querySelector(".cm-search")).not.toBeNull();
    expect(searchPanelOpen(editorView().state)).toBe(true);

    runCommand(workbench, "edit.closeFind");
    expect(document.querySelector(".cm-search")).toBeNull();

    pressKey("f");
    expect(document.querySelector(".cm-search")).not.toBeNull();
  });

  it("edit.replace opens the same panel with the replace field", async () => {
    const workbench = await openDocumentWithText();
    runCommand(workbench, "edit.replace");
    const panel = document.querySelector(".cm-search");
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('input[name="replace"]')).not.toBeNull();
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
    expect(document.querySelector(".cm-search")).not.toBeNull();

    runCommand(workbench, "edit.closeFind");
    expect(document.querySelector(".cm-search")).toBeNull();
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
