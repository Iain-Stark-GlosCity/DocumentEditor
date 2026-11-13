/**
 * CodeMirror glue for tables: finding the table under the cursor and rewriting it as one
 * undoable transaction that touches only the lines that changed.
 */
import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  hasPipe,
  isDelimiterContent,
  linePrefix,
  parseTable,
  splitRow,
  type TableModel,
} from "./model";

export interface TableLoc {
  /** Document offset of the start of the header line. */
  from: number;
  /** Document offset of the end of the last line. */
  to: number;
  /** 1-based document line number of the header. */
  startLine: number;
  lines: string[];
  model: TableModel;
}

/** A cell by table line (0 header, 1 delimiter row, 2 and up body rows) and column. */
export interface CellRef {
  line: number;
  col: number;
  /** Cursor offset within the cell's text, clamped to it. */
  offset: number;
}

const NOT_TABLE_PARENTS = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);

function fromLines(state: EditorState, first: number, last: number): TableLoc | null {
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text);
  const model = parseTable(lines);
  if (!model) return null;
  return {
    from: state.doc.line(first).from,
    to: state.doc.line(last).to,
    startLine: first,
    lines,
    model,
  };
}

function inCode(state: EditorState, pos: number): boolean {
  for (
    let node = syntaxTree(state).resolve(pos, -1) as { name: string; parent: unknown } | null;
    node;
  ) {
    if (NOT_TABLE_PARENTS.has(node.name)) return true;
    node = node.parent as typeof node;
  }
  return false;
}

/** The table from the syntax tree, if the parser recognises one at this line. */
function fromSyntaxTree(state: EditorState, pos: number): TableLoc | null {
  const line = state.doc.lineAt(pos);
  if (line.length === 0) return null;
  const tree =
    ensureSyntaxTree(state, Math.min(state.doc.length, line.to + 2000), 50) ?? syntaxTree(state);
  for (
    let node = tree.resolve(line.to, -1) as {
      name: string;
      from: number;
      to: number;
      parent: unknown;
    } | null;
    node;
  ) {
    if (node.name === "Table") {
      const first = state.doc.lineAt(node.from).number;
      const last = state.doc.lineAt(node.to).number;
      return fromLines(state, first, last);
    }
    node = node.parent as typeof node;
  }
  return null;
}

function depth(prefix: string): number {
  return (prefix.match(/>/g) ?? []).length;
}

/**
 * Text fallback for a table being typed that the parser does not recognise yet: a header line
 * containing a pipe followed by a delimiter row (which must contain a pipe too).
 */
function fromText(state: EditorState, pos: number): TableLoc | null {
  const doc = state.doc;
  const cur = doc.lineAt(pos);
  const info = (n: number): { content: string; depth: number } => {
    const text = doc.line(n).text;
    const prefix = linePrefix(text);
    return { content: text.slice(prefix.length), depth: depth(prefix) };
  };
  const rowLike = (n: number): boolean => {
    const { content } = info(n);
    return content.trim() !== "" && hasPipe(content);
  };
  const delimLike = (n: number): boolean => {
    const { content } = info(n);
    return hasPipe(content) && isDelimiterContent(content);
  };
  const same = info(cur.number).depth;
  const ok = (n: number): boolean => info(n).depth === same && rowLike(n);
  if (!ok(cur.number)) return null;
  let top = cur.number;
  while (top > 1 && ok(top - 1)) top--;
  let bottom = cur.number;
  while (bottom < doc.lines && ok(bottom + 1)) bottom++;
  for (let d = top + 1; d <= bottom; d++) {
    if (delimLike(d)) {
      const header = d - 1;
      if (cur.number < header) return null;
      if (inCode(state, cur.to)) return null;
      return fromLines(state, header, bottom);
    }
  }
  return null;
}

/** Finds the table containing `pos`: from the syntax tree, else by reading the text. */
export function findTable(state: EditorState, pos: number): TableLoc | null {
  return fromSyntaxTree(state, pos) ?? fromText(state, pos);
}

/** Which cell `pos` is in, and where in its text. */
export function cellAt(state: EditorState, loc: TableLoc, pos: number): CellRef {
  const docLine = state.doc.lineAt(pos);
  const line = Math.max(0, Math.min(loc.lines.length - 1, docLine.number - loc.startLine));
  const text = loc.lines[line] ?? "";
  const prefix = linePrefix(text).length;
  const rel = pos - docLine.from - prefix;
  const spans = splitRow(text.slice(prefix));
  let col = spans.findIndex((s) => rel <= s.end);
  if (col === -1) col = spans.length - 1;
  col = Math.min(col, loc.model.header.length - 1);
  const span = spans[col] ?? { from: 0, to: 0 };
  const offset = Math.max(0, Math.min(span.to - span.from, rel - span.from));
  return { line, col, offset };
}

/** Chooses the selection in the new table text, as offsets from the start of the table. */
export type Select = (starts: number[], lines: string[]) => [number, number];

/** Selects the text of a cell, or with `offset` puts the cursor that far into it. */
export function selectCell(line: number, col: number, offset?: number): Select {
  return (starts, lines) => {
    const text = lines[line] ?? "";
    const prefix = linePrefix(text).length;
    const spans = splitRow(text.slice(prefix));
    const span = spans[Math.min(col, spans.length - 1)] ?? { from: 0, to: 0 };
    const base = (starts[line] ?? 0) + prefix;
    const from = base + span.from;
    const to = base + span.to;
    if (offset === undefined) return [from, to];
    const at = from + Math.min(offset, to - from);
    return [at, at];
  };
}

/** Puts the cursor at the end of line `line` of the new text. */
export function selectLineEnd(line: number): Select {
  return (starts, lines) => {
    const at = (starts[line] ?? 0) + (lines[line] ?? "").length;
    return [at, at];
  };
}

/**
 * Replaces the table's lines with `newLines` as one undoable transaction. Lines that are
 * unchanged at the top and bottom are left alone, so only what changed is touched. `newLines`
 * may extend past the table (a new line below it).
 */
export function commit(
  view: EditorView,
  loc: TableLoc,
  newLines: readonly string[],
  select: Select,
): void {
  const old = loc.lines;
  let a = 0;
  while (a < old.length && a < newLines.length && old[a] === newLines[a]) a++;
  let b = 0;
  while (
    b < old.length - a &&
    b < newLines.length - a &&
    old[old.length - 1 - b] === newLines[newLines.length - 1 - b]
  ) {
    b++;
  }
  const oldStarts: number[] = [];
  const oldEnds: number[] = [];
  let at = loc.from;
  for (const l of old) {
    oldStarts.push(at);
    oldEnds.push(at + l.length);
    at += l.length + 1;
  }
  const startOf = (i: number): number => oldStarts[i] ?? loc.to;
  const oldMid = old.length - b - a;
  const newMid = newLines.slice(a, newLines.length - b);
  const changes: { from: number; to: number; insert: string }[] = [];
  if (oldMid === 0 && newMid.length === 0) {
    // Nothing changed.
  } else if (oldMid === 0) {
    if (a === old.length)
      changes.push({ from: loc.to, to: loc.to, insert: "\n" + newMid.join("\n") });
    else changes.push({ from: startOf(a), to: startOf(a), insert: newMid.join("\n") + "\n" });
  } else {
    const lastOld = a + oldMid - 1;
    const end = oldEnds[lastOld] ?? loc.to;
    if (newMid.length === 0) {
      if (a + oldMid < old.length)
        changes.push({ from: startOf(a), to: startOf(a + oldMid), insert: "" });
      else changes.push({ from: startOf(a) - 1, to: end, insert: "" });
    } else {
      changes.push({ from: startOf(a), to: end, insert: newMid.join("\n") });
    }
  }
  const starts: number[] = [];
  let rel = 0;
  for (const l of newLines) {
    starts.push(rel);
    rel += l.length + 1;
  }
  const [anchor, head] = select(starts, [...newLines]);
  view.dispatch({
    changes,
    selection: { anchor: loc.from + anchor, head: loc.from + head },
    scrollIntoView: true,
    userEvent: "input.table",
    annotations: isolateHistory.of("full"),
  });
}
