import { EditorState } from "@codemirror/state";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import type { Command } from "../../core/commands";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

/** The panel's labels in sentence-case British English (CodeMirror's own are lowercase). */
const PHRASES: Record<string, string> = {
  next: "Next",
  previous: "Previous",
  all: "Select all",
  "match case": "Match case",
  regexp: "Regular expression",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
  close: "Close",
  go: "Go",
};

/**
 * Find, replace, go to line and multiple selections. The search itself is `@codemirror/search`;
 * keys are dispatched by the workbench commands below, not by its keymap.
 */
export const find: Feature = {
  id: "find",
  editorExtensions: () => [
    search({ top: true }),
    EditorState.phrases.of(PHRASES),
    highlightSelectionMatches(),
    // Select next and select all occurrences add ranges, which CodeMirror drops unless this is on.
    EditorState.allowMultipleSelections.of(true),
  ],
  commands: (wb: Workbench) => {
    const hasEditor = () => wb.activeDocument() !== null && wb.activeView() !== null;
    // Run against the editor, which must hold focus for the panel and caret to be right.
    const onView =
      (fn: (view: EditorView) => void): (() => void) =>
      () => {
        const view = wb.activeView();
        if (!view || !wb.activeDocument()) return;
        view.focus();
        fn(view);
      };

    const command = (
      id: string,
      title: string,
      run: (view: EditorView) => void,
      defaultKey?: string,
    ): Command => ({
      id,
      title,
      ...(defaultKey ? { defaultKey } : {}),
      enabled: hasEditor,
      run: onView(run),
    });

    return [
      command("edit.find", "Find", (v) => void openSearchPanel(v), "Mod-f"),
      command("edit.replace", "Replace", (v) => void openSearchPanel(v), "Mod-h"),
      command("edit.findNext", "Find next", (v) => void findNext(v), "F3"),
      command("edit.findPrevious", "Find previous", (v) => void findPrevious(v), "Shift-F3"),
      command(
        "edit.selectNextOccurrence",
        "Select next occurrence",
        (v) => void selectNextOccurrence(v),
        "Mod-d",
      ),
      command(
        "edit.selectAllOccurrences",
        "Select all occurrences",
        (v) => void selectSelectionMatches(v),
        "Mod-Shift-l",
      ),
      command("edit.goToLine", "Go to line", (v) => void gotoLine(v), "Mod-g"),
      command("edit.closeFind", "Close find", (v) => void closeSearchPanel(v)),
    ];
  },
  menuItems: [
    { menu: "edit", group: "4_find", command: "edit.find", order: 1 },
    { menu: "edit", group: "4_find", command: "edit.replace", order: 2 },
    { menu: "edit", group: "4_find", command: "edit.findNext", order: 3 },
    { menu: "edit", group: "4_find", command: "edit.findPrevious", order: 4 },
    { menu: "edit", group: "5_multi", command: "edit.selectNextOccurrence", order: 1 },
    { menu: "edit", group: "5_multi", command: "edit.selectAllOccurrences", order: 2 },
    { menu: "edit", group: "6_goto", command: "edit.goToLine" },
  ],
};
