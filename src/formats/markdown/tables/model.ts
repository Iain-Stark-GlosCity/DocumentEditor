/**
 * Pure model of a GFM pipe table. No CodeMirror imports.
 *
 * Cell text is kept raw (trimmed of surrounding spaces only), so parsing and serialising never
 * alter what the user typed inside a cell. Serialising aligns the columns.
 *
 * Choices worth knowing about:
 * - A row with more cells than the header widens the table rather than losing data; shorter
 *   rows are padded with empty cells. After `parseTable` every row has the same width.
 * - A pipe inside an inline code span does not split a cell (a friendlier reading than the
 *   strict GFM one; raw text is preserved either way).
 */
import { displayWidth } from "./width";

export type Align = "left" | "center" | "right" | "none";

export interface TableModel {
  /** Text before the table on every line: indentation and blockquote markers. */
  prefix: string;
  header: string[];
  align: Align[];
  rows: string[][];
}

/** Where one cell sits inside a line's content (the text after the prefix). */
export interface CellSpan {
  /** Boundaries between pipes: `start` is after the preceding pipe, `end` at the next pipe. */
  start: number;
  end: number;
  /** The trimmed text. For an empty cell, one space in if there is room, else `start`. */
  from: number;
  to: number;
  raw: string;
}

export const PREFIX_RE = /^[ \t]*(?:>[ \t]*)*/;

export function linePrefix(line: string): string {
  return PREFIX_RE.exec(line)?.[0] ?? "";
}

/** Offsets of pipes that separate cells: not escaped and not inside a code span. */
function findPipes(s: string): number[] {
  const pipes: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
    } else if (ch === "`") {
      let run = 1;
      while (s[i + run] === "`") run++;
      // Find a closing run of exactly the same length.
      let j = i + run;
      let close = -1;
      while (j < s.length) {
        if (s[j] === "`") {
          let r = 1;
          while (s[j + r] === "`") r++;
          if (r === run) {
            close = j;
            break;
          }
          j += r;
        } else j++;
      }
      i = close === -1 ? i + run : close + run;
    } else {
      if (ch === "|") pipes.push(i);
      i++;
    }
  }
  return pipes;
}

export function hasPipe(content: string): boolean {
  return findPipes(content).length > 0;
}

function trimSpaces(raw: string): { lead: number; text: string } {
  const text = raw.replace(/^[ \t]+/, "");
  const lead = raw.length - text.length;
  return { lead, text: text.replace(/[ \t]+$/, "") };
}

/** Splits the content of one table line (prefix already removed) into cells. */
export function splitRow(content: string): CellSpan[] {
  const pipes = findPipes(content);
  const spans: CellSpan[] = [];
  const push = (start: number, end: number): void => {
    const raw = content.slice(start, end);
    const { lead, text } = trimSpaces(raw);
    if (text === "") {
      const at = start + Math.min(1, raw.length);
      spans.push({ start, end, from: at, to: at, raw: "" });
    } else {
      spans.push({ start, end, from: start + lead, to: start + lead + text.length, raw: text });
    }
  };
  let start = 0;
  let k = 0;
  const firstNonSpace = content.search(/[^ \t]/);
  if (pipes.length > 0 && pipes[0] === firstNonSpace) {
    start = pipes[0] + 1;
    k = 1;
  }
  for (; k < pipes.length; k++) {
    const pipe = pipes[k] ?? 0;
    push(start, pipe);
    start = pipe + 1;
  }
  if (content.slice(start).trim() !== "") push(start, content.length);
  else if (spans.length === 0) push(start, start);
  return spans;
}

const DELIM_CELL = /^:?-+:?$/;

/** A delimiter row: every cell is dashes with optional colons. Needs at least one cell. */
export function isDelimiterContent(content: string): boolean {
  if (content.trim() === "") return false;
  return splitRow(content).every((c) => DELIM_CELL.test(c.raw));
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : left ? "left" : right ? "right" : "none";
}

/** Parses the lines of a table (header, delimiter, then rows). Null if it is not a table. */
export function parseTable(lines: readonly string[]): TableModel | null {
  if (lines.length < 2) return null;
  const prefix = linePrefix(lines[0] ?? "");
  const contentOf = (line: string): string => line.slice(linePrefix(line).length);
  const header = splitRow(contentOf(lines[0] ?? "")).map((c) => c.raw);
  const delimContent = contentOf(lines[1] ?? "");
  if (!isDelimiterContent(delimContent)) return null;
  const align = splitRow(delimContent).map((c) => alignOf(c.raw));
  const rows = lines.slice(2).map((l) => splitRow(contentOf(l)).map((c) => c.raw));
  const columns = Math.max(1, header.length, align.length, ...rows.map((r) => r.length));
  const pad = <T>(a: T[], fill: T): T[] => {
    while (a.length < columns) a.push(fill);
    return a;
  };
  return {
    prefix,
    header: pad(header, ""),
    align: pad(align, "none"),
    rows: rows.map((r) => pad(r, "")),
  };
}

export interface TableLayout {
  lines: string[];
  /** `[line][column]`: offsets within that line of the cell text (line 1 is the delimiter row). */
  spans: { from: number; to: number }[][];
}

function dashes(n: number): string {
  return "-".repeat(Math.max(0, n));
}

function delimiterCell(align: Align, width: number): string {
  switch (align) {
    case "left":
      return ":" + dashes(width - 1);
    case "right":
      return dashes(width - 1) + ":";
    case "center":
      return ":" + dashes(width - 2) + ":";
    default:
      return dashes(width);
  }
}

/** Serialises with aligned columns and reports where each cell's text lands. */
export function layoutTable(model: TableModel): TableLayout {
  const columns = model.header.length;
  const widths: number[] = [];
  const bodyWidths = model.rows.map((r) => r.map(displayWidth));
  const headWidths = model.header.map(displayWidth);
  for (let c = 0; c < columns; c++) {
    const colons = model.align[c] === "center" ? 2 : model.align[c] === "none" ? 0 : 1;
    let w = 3 + colons; // at least three dashes in the delimiter
    w = Math.max(w, headWidths[c] ?? 0);
    for (const r of bodyWidths) w = Math.max(w, r[c] ?? 0);
    widths.push(w);
  }
  const lines: string[] = [];
  const spans: { from: number; to: number }[][] = [];

  const emit = (cells: string[], cellWidths: number[]): void => {
    let line = model.prefix + "|";
    const lineSpans: { from: number; to: number }[] = [];
    for (let c = 0; c < columns; c++) {
      const extra = (widths[c] ?? 0) - (cellWidths[c] ?? 0);
      const a = model.align[c];
      const left = a === "right" ? extra : a === "center" ? Math.floor(extra / 2) : 0;
      const right = extra - left;
      line += " ";
      const from = line.length + left;
      const cell = cells[c] ?? "";
      line += " ".repeat(left) + cell + " ".repeat(right) + " |";
      lineSpans.push({ from, to: from + cell.length });
    }
    lines.push(line);
    spans.push(lineSpans);
  };

  emit(model.header, headWidths);
  let delim = model.prefix + "|";
  const delimSpans: { from: number; to: number }[] = [];
  for (let c = 0; c < columns; c++) {
    delim += " ";
    const from = delim.length;
    const width = widths[c] ?? 3;
    delim += delimiterCell(model.align[c] ?? "none", width) + " |";
    delimSpans.push({ from, to: from + width });
  }
  lines.push(delim);
  spans.push(delimSpans);
  model.rows.forEach((r, i) => emit(r, bodyWidths[i] ?? []));
  return { lines, spans };
}

export function serialiseTable(model: TableModel): string[] {
  return layoutTable(model).lines;
}
