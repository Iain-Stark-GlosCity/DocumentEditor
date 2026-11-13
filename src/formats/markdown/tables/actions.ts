/**
 * Table actions as functions of an editor view. Each returns true if it applied, and false
 * (touching nothing) when the cursor is not in a table, so key handlers can fall through.
 */
import type { EditorView } from "@codemirror/view";
import {
  cellAt,
  commit,
  findTable,
  selectCell,
  selectLineEnd,
  type CellRef,
  type Select,
  type TableLoc,
} from "./editor";
import { layoutTable, linePrefix, type Align, type TableModel } from "./model";
import * as ops from "./ops";

/** Table line index of body row `i`. */
const bodyLine = (i: number): number => i + 2;

interface Context {
  loc: TableLoc;
  cell: CellRef;
}

function context(view: EditorView): Context | null {
  const { state } = view;
  const loc = findTable(state, state.selection.main.head);
  if (!loc) return null;
  return { loc, cell: cellAt(state, loc, state.selection.main.head) };
}

export function inTable(view: EditorView): boolean {
  return context(view) !== null;
}

/** Rewrites the table from a model and selects a cell. */
function apply(view: EditorView, loc: TableLoc, model: TableModel, select: Select): true {
  commit(view, loc, layoutTable(model).lines, select);
  return true;
}

export function formatTable(view: EditorView): boolean {
  const c = context(view);
  if (!c) return false;
  return apply(view, c.loc, c.loc.model, selectCell(c.cell.line, c.cell.col, c.cell.offset));
}

// ---------------------------------------------------------------------------------------
// Structure commands

export function insertRow(view: EditorView, where: "above" | "below"): boolean {
  const c = context(view);
  if (!c) return false;
  const { model } = c.loc;
  const { line, col } = c.cell;
  let index: number;
  if (line <= 1) {
    if (where === "above") return false; // nothing sits above the header
    index = 0;
  } else index = where === "above" ? line - 2 : line - 1;
  return apply(view, c.loc, ops.insertRow(model, index), selectCell(bodyLine(index), col));
}

export function deleteRow(view: EditorView): boolean {
  const c = context(view);
  if (!c || c.cell.line < 2) return false;
  const index = c.cell.line - 2;
  const model = ops.deleteRow(c.loc.model, index);
  const target = model.rows.length === 0 ? 0 : bodyLine(Math.min(index, model.rows.length - 1));
  return apply(view, c.loc, model, selectCell(target, c.cell.col));
}

export function insertColumn(view: EditorView, where: "left" | "right"): boolean {
  const c = context(view);
  if (!c) return false;
  const index = where === "left" ? c.cell.col : c.cell.col + 1;
  return apply(view, c.loc, ops.insertColumn(c.loc.model, index), selectCell(c.cell.line, index));
}

export function deleteColumn(view: EditorView): boolean {
  const c = context(view);
  if (!c || ops.columnCount(c.loc.model) < 2) return false;
  const model = ops.deleteColumn(c.loc.model, c.cell.col);
  const col = Math.min(c.cell.col, ops.columnCount(model) - 1);
  return apply(view, c.loc, model, selectCell(c.cell.line, col));
}

/** Moves the current body row. In the header or at an edge it does nothing but still returns true. */
export function moveRow(view: EditorView, delta: -1 | 1): boolean {
  const c = context(view);
  if (!c) return false;
  const index = c.cell.line - 2;
  const target = index + delta;
  if (index < 0 || target < 0 || target >= c.loc.model.rows.length) return true;
  return apply(
    view,
    c.loc,
    ops.moveRow(c.loc.model, index, delta),
    selectCell(bodyLine(target), c.cell.col, c.cell.offset),
  );
}

export function moveColumn(view: EditorView, delta: -1 | 1): boolean {
  const c = context(view);
  if (!c) return false;
  const target = c.cell.col + delta;
  if (target < 0 || target >= ops.columnCount(c.loc.model)) return true;
  return apply(
    view,
    c.loc,
    ops.moveColumn(c.loc.model, c.cell.col, delta),
    selectCell(c.cell.line, target, c.cell.offset),
  );
}

export function setAlignment(view: EditorView, align: Align): boolean {
  const c = context(view);
  if (!c) return false;
  return apply(
    view,
    c.loc,
    ops.setAlign(c.loc.model, c.cell.col, align),
    selectCell(c.cell.line, c.cell.col, c.cell.offset),
  );
}

export function sortByColumn(view: EditorView, direction: "asc" | "desc"): boolean {
  const c = context(view);
  if (!c) return false;
  return apply(
    view,
    c.loc,
    ops.sortRows(c.loc.model, c.cell.col, direction),
    selectCell(c.cell.line === 1 ? 0 : c.cell.line, c.cell.col, c.cell.offset),
  );
}

// ---------------------------------------------------------------------------------------
// Navigation

/** Appends an empty row to the raw lines without re-aligning (auto format off). */
function rawEmptyRow(model: TableModel): string {
  return model.prefix + "|" + "   |".repeat(ops.columnCount(model));
}

function navigate(
  view: EditorView,
  c: Context,
  line: number,
  col: number,
  autoFormat: boolean,
): true {
  const { loc } = c;
  const columns = ops.columnCount(loc.model);
  const appended = line >= loc.lines.length;
  const model = appended ? ops.insertRow(loc.model, loc.model.rows.length) : loc.model;
  const target = selectCell(line, Math.min(col, columns - 1));
  if (autoFormat) {
    commit(view, loc, layoutTable(model).lines, target);
  } else {
    commit(view, loc, appended ? [...loc.lines, rawEmptyRow(loc.model)] : loc.lines, target);
  }
  return true;
}

export function nextCell(view: EditorView, autoFormat: boolean): boolean {
  const c = context(view);
  if (!c) return false;
  const columns = ops.columnCount(c.loc.model);
  const { line, col } = c.cell;
  if (line === 1) return navigate(view, c, 2, 0, autoFormat);
  if (col + 1 < columns) return navigate(view, c, line, col + 1, autoFormat);
  return navigate(view, c, line === 0 ? 2 : line + 1, 0, autoFormat);
}

export function previousCell(view: EditorView, autoFormat: boolean): boolean {
  const c = context(view);
  if (!c) return false;
  const columns = ops.columnCount(c.loc.model);
  const { line, col } = c.cell;
  if (line === 1) return navigate(view, c, 0, col, autoFormat);
  if (col > 0) return navigate(view, c, line, col - 1, autoFormat);
  if (line === 0) return navigate(view, c, 0, 0, autoFormat);
  return navigate(view, c, line === 2 ? 0 : line - 1, columns - 1, autoFormat);
}

/** Leaves the table for a line below it, reusing a blank line that is already there. */
function exitBelow(view: EditorView, c: Context, lines: string[], autoFormat: boolean): true {
  const { loc } = c;
  const { state } = view;
  const prefix = loc.model.prefix;
  const base = autoFormat ? layoutTable(loc.model).lines : lines;
  const next = loc.startLine + loc.lines.length;
  if (next <= state.doc.lines) {
    const text = state.doc.line(next).text;
    if (text.trim() === "" || text.trim() === prefix.trim()) {
      // Move onto the blank line below; format the table only if it changed.
      commit(view, loc, base, () => {
        const at = base.join("\n").length + 1 + text.length;
        return [at, at];
      });
      return true;
    }
  }
  const out = [...base, prefix];
  commit(view, loc, out, selectLineEnd(out.length - 1));
  return true;
}

export function exitTable(view: EditorView, autoFormat: boolean): boolean {
  const c = context(view);
  if (!c) return false;
  return exitBelow(view, c, c.loc.lines, autoFormat);
}

export function enterInTable(view: EditorView, autoFormat: boolean): boolean {
  const c = context(view);
  if (!c) return false;
  const { loc, cell } = c;
  const lineCount = loc.lines.length;
  const next = cell.line <= 1 ? 2 : cell.line + 1;
  const lastIsEmpty =
    cell.line >= 2 &&
    cell.line === lineCount - 1 &&
    ops.isEmptyRow(loc.model.rows[loc.model.rows.length - 1] ?? []);
  if (lastIsEmpty) {
    // Remove the empty row and leave: the row's line becomes the blank line below the table.
    const model = ops.deleteRow(loc.model, loc.model.rows.length - 1);
    const lines = autoFormat ? layoutTable(model).lines : loc.lines.slice(0, -1);
    const out = [...lines, loc.model.prefix];
    commit(view, loc, out, selectLineEnd(out.length - 1));
    return true;
  }
  return navigate(view, c, next, cell.col, autoFormat);
}

// ---------------------------------------------------------------------------------------
// Insert, convert and paste

function isBlank(text: string): boolean {
  return text.trim() === "" || text.trim() === linePrefix(text).trim();
}

/**
 * Replaces `[from, to)` (whole lines, or the end of a line to add after it) with table lines,
 * keeping a blank line before and after. Puts the cursor in the first header cell.
 */
function placeTable(
  view: EditorView,
  from: number,
  to: number,
  lines: string[],
  afterLine: boolean,
): void {
  const { doc } = view.state;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  const lead = afterLine
    ? "\n\n"
    : first.number > 1 && !isBlank(doc.line(first.number - 1).text)
      ? "\n"
      : "";
  const trail = last.number < doc.lines && !isBlank(doc.line(last.number + 1).text) ? "\n" : "";
  const insert = lead + lines.join("\n") + trail;
  const start = from + lead.length;
  const starts = [0];
  for (const l of lines) starts.push((starts[starts.length - 1] ?? 0) + l.length + 1);
  const prefix = linePrefix(lines[0] ?? "").length;
  const cursor = start + prefix + 2;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: "input.table",
  });
}

/** Inserts an empty 3 column, 2 row table, or converts selected CSV/TSV text. */
export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) {
    const found = ops.detectDelimited(state.sliceDoc(sel.from, sel.to));
    if (found) {
      const model = ops.modelFromRows(found.rows);
      const lines = layoutTable(model).lines;
      placeTable(view, state.doc.lineAt(sel.from).from, state.doc.lineAt(sel.to).to, lines, false);
      return true;
    }
  }
  const model: TableModel = {
    prefix: "",
    header: ["", "", ""],
    align: ["none", "none", "none"],
    rows: [ops.emptyRow(3), ops.emptyRow(3)],
  };
  const line = state.doc.lineAt(sel.head);
  const lines = layoutTable({
    ...model,
    prefix: linePrefix(line.text).includes(">") ? linePrefix(line.text) : "",
  }).lines;
  if (isBlank(line.text)) placeTable(view, line.from, line.to, lines, false);
  else placeTable(view, line.to, line.to, lines, true);
  return true;
}

/** Replaces the selection (or inserts at the cursor) with a table made from CSV/TSV text. */
export function pasteTextAsTable(view: EditorView, text: string): boolean {
  const found = ops.detectDelimited(text);
  if (!found) return false;
  const { state } = view;
  const sel = state.selection.main;
  const lines = layoutTable(ops.modelFromRows(found.rows)).lines;
  if (!sel.empty) {
    placeTable(view, state.doc.lineAt(sel.from).from, state.doc.lineAt(sel.to).to, lines, false);
    return true;
  }
  const line = state.doc.lineAt(sel.head);
  if (isBlank(line.text)) placeTable(view, line.from, line.to, lines, false);
  else placeTable(view, line.to, line.to, lines, true);
  return true;
}

/**
 * Pastes tab-separated text into the cells from the cursor, growing the table as needed.
 * Returns false (leaving the paste to the editor) outside a table or for text without tabs.
 */
export function pasteCells(view: EditorView, text: string): boolean {
  if (!text.includes("\t")) return false;
  const c = context(view);
  if (!c) return false;
  const rows = ops.parseDelimited(text.replace(/\r?\n$/, ""), "\t");
  if (rows.length === 0) return false;
  const { cell, loc } = c;
  const startRow = cell.line === 1 ? 1 : cell.line === 0 ? 0 : cell.line - 1;
  const model = ops.fillCells(loc.model, startRow, cell.col, rows);
  const endRow = startRow + rows.length - 1;
  const lastLen = rows[rows.length - 1]?.length ?? 1;
  const col = cell.col + lastLen - 1;
  const line = endRow === 0 ? 0 : endRow + 1;
  // Cursor at the end of the last pasted cell.
  const text2 = layoutTable(model).lines;
  commit(view, loc, text2, (starts, lines) => {
    const [, to] = selectCell(line, col)(starts, lines);
    return [to, to];
  });
  return true;
}
