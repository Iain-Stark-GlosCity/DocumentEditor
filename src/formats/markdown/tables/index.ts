/**
 * First-class GFM table editing in the text buffer. Tables stay plain pipe tables; this adds a
 * keymap that is active only inside a table, the `markdown.table.*` commands and cell paste.
 */
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { FormatCommand } from "../../../core/format";
import * as actions from "./actions";

import { cellAt, findTable } from "./editor";
import type { Align } from "./model";

export { findTable };
export { parseTable, serialiseTable } from "./model";

/**
 * Keys that apply only when the cursor is in a table; each returns false elsewhere so other
 * handlers (list indentation, newline continuation) run as usual.
 */
export function tableKeymap(autoFormat: () => boolean): Extension {
  return Prec.high(
    keymap.of([
      { key: "Tab", run: (v) => actions.nextCell(v, autoFormat()) },
      { key: "Shift-Tab", run: (v) => actions.previousCell(v, autoFormat()) },
      { key: "Enter", run: (v) => actions.enterInTable(v, autoFormat()) },
      { key: "Mod-Enter", run: (v) => actions.exitTable(v, autoFormat()) },
      { key: "Alt-ArrowUp", run: (v) => actions.moveRow(v, -1) },
      { key: "Alt-ArrowDown", run: (v) => actions.moveRow(v, 1) },
      { key: "Alt-ArrowLeft", run: (v) => actions.moveColumn(v, -1) },
      { key: "Alt-ArrowRight", run: (v) => actions.moveColumn(v, 1) },
    ]),
  );
}

/** Pasting tab-separated text inside a table fills cells; elsewhere the paste is left alone. */
export function tablePaste(): Extension {
  return Prec.high(
    EditorView.domEventHandlers({
      paste(event, view) {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !actions.pasteCells(view, text)) return false;
        event.preventDefault();
        return true;
      },
    }),
  );
}

/** Editor extensions for tables. `autoFormat` is read when a key is pressed. */
export function tableExtensions(autoFormat: () => boolean): Extension[] {
  return [tableKeymap(autoFormat), tablePaste()];
}

/** Is the cursor inside a table? Table commands other than insert and paste need this. */
const cursorInTable = (state: EditorState): boolean =>
  findTable(state, state.selection.main.head) !== null;

/** Is the column under the cursor aligned this way? */
const columnAligned =
  (align: Align): FormatCommand["active"] =>
  (state) => {
    const loc = findTable(state, state.selection.main.head);
    return !!loc && loc.model.align[cellAt(state, loc, state.selection.main.head).col] === align;
  };

const command = (
  id: string,
  title: string,
  run: (view: EditorView) => boolean,
  enabled: FormatCommand["enabled"] | null = cursorInTable,
  active?: FormatCommand["active"],
): FormatCommand => ({
  id: `markdown.table.${id}`,
  title,
  ...(enabled ? { enabled } : {}),
  ...(active ? { active } : {}),
  run,
});

/**
 * Commands apply only inside a table (except insert and paste as table) and return false
 * otherwise. Keys for navigation and moving live in `tableKeymap`.
 */
export const tableCommands: readonly FormatCommand[] = [
  command("insert", "Insert table", actions.insertTable, null),
  command("format", "Format table", actions.formatTable),
  command("insertRowAbove", "Insert table row above", (v) => actions.insertRow(v, "above")),
  command("insertRowBelow", "Insert table row below", (v) => actions.insertRow(v, "below")),
  command("insertColumnLeft", "Insert table column left", (v) => actions.insertColumn(v, "left")),
  command("insertColumnRight", "Insert table column right", (v) =>
    actions.insertColumn(v, "right"),
  ),
  command("deleteRow", "Delete table row", actions.deleteRow),
  command("deleteColumn", "Delete table column", actions.deleteColumn),
  command("moveRowUp", "Move table row up", (v) => actions.moveRow(v, -1)),
  command("moveRowDown", "Move table row down", (v) => actions.moveRow(v, 1)),
  command("moveColumnLeft", "Move table column left", (v) => actions.moveColumn(v, -1)),
  command("moveColumnRight", "Move table column right", (v) => actions.moveColumn(v, 1)),
  command(
    "alignLeft",
    "Align table column left",
    (v) => actions.setAlignment(v, "left"),
    cursorInTable,
    columnAligned("left"),
  ),
  command(
    "alignCentre",
    "Centre table column",
    (v) => actions.setAlignment(v, "center"),
    cursorInTable,
    columnAligned("center"),
  ),
  command(
    "alignRight",
    "Align table column right",
    (v) => actions.setAlignment(v, "right"),
    cursorInTable,
    columnAligned("right"),
  ),
  command("alignNone", "Clear table column alignment", (v) => actions.setAlignment(v, "none")),
  command("sortAscending", "Sort table by column, ascending", (v) =>
    actions.sortByColumn(v, "asc"),
  ),
  command("sortDescending", "Sort table by column, descending", (v) =>
    actions.sortByColumn(v, "desc"),
  ),
  command(
    "pasteAsTable",
    "Paste clipboard as table",
    (view) => {
      // The Clipboard API is asynchronous; the table is inserted when the text arrives.
      void navigator.clipboard
        .readText()
        .then((text) => actions.pasteTextAsTable(view, text))
        .catch(() => undefined);
      return true;
    },
    null,
  ),
];
