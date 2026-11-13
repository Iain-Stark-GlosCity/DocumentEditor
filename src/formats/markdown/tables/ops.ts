/** Pure operations on a `TableModel`. Every function returns a new model. */
import type { Align, TableModel } from "./model";

function copy(m: TableModel): TableModel {
  return {
    prefix: m.prefix,
    header: [...m.header],
    align: [...m.align],
    rows: m.rows.map((r) => [...r]),
  };
}

export function columnCount(m: TableModel): number {
  return m.header.length;
}

export function emptyRow(columns: number): string[] {
  return Array.from({ length: columns }, () => "");
}

export function isEmptyRow(row: readonly string[]): boolean {
  return row.every((c) => c === "");
}

/** Inserts an empty body row so that it becomes `rows[index]`. */
export function insertRow(m: TableModel, index: number): TableModel {
  const out = copy(m);
  out.rows.splice(Math.max(0, Math.min(index, out.rows.length)), 0, emptyRow(columnCount(m)));
  return out;
}

export function deleteRow(m: TableModel, index: number): TableModel {
  const out = copy(m);
  out.rows.splice(index, 1);
  return out;
}

/** Moves body row `index` by `delta` places; unchanged if it would leave the body. */
export function moveRow(m: TableModel, index: number, delta: -1 | 1): TableModel {
  const to = index + delta;
  if (to < 0 || to >= m.rows.length) return m;
  const out = copy(m);
  const [row] = out.rows.splice(index, 1);
  if (row) out.rows.splice(to, 0, row);
  return out;
}

/** Inserts an empty column so that it becomes column `index`. */
export function insertColumn(m: TableModel, index: number): TableModel {
  const out = copy(m);
  const at = Math.max(0, Math.min(index, columnCount(m)));
  out.header.splice(at, 0, "");
  out.align.splice(at, 0, "none");
  for (const r of out.rows) r.splice(at, 0, "");
  return out;
}

export function deleteColumn(m: TableModel, index: number): TableModel {
  const out = copy(m);
  out.header.splice(index, 1);
  out.align.splice(index, 1);
  for (const r of out.rows) r.splice(index, 1);
  return out;
}

export function moveColumn(m: TableModel, index: number, delta: -1 | 1): TableModel {
  const to = index + delta;
  if (to < 0 || to >= columnCount(m)) return m;
  const out = copy(m);
  for (const list of [out.header, out.align, ...out.rows] as unknown[][]) {
    const [item] = list.splice(index, 1);
    list.splice(to, 0, item);
  }
  return out;
}

export function setAlign(m: TableModel, column: number, align: Align): TableModel {
  const out = copy(m);
  out.align[column] = align;
  return out;
}

function numericValue(text: string): number | null {
  const t = text.replace(/^[£$€¥]/, "").replace(/[%\s_,]/g, "");
  if (t === "" || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Sorts body rows by one column. Numbers sort numerically and before text, text sorts with a
 * natural, case-insensitive order, and empty cells always go last. The header stays put.
 */
export function sortRows(m: TableModel, column: number, direction: "asc" | "desc"): TableModel {
  const out = copy(m);
  const sign = direction === "asc" ? 1 : -1;
  out.rows.sort((a, b) => {
    const x = a[column] ?? "";
    const y = b[column] ?? "";
    if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
    const nx = numericValue(x);
    const ny = numericValue(y);
    let c: number;
    if (nx !== null && ny !== null) c = nx - ny;
    else if (nx !== null) c = -1;
    else if (ny !== null) c = 1;
    else c = collator.compare(x, y);
    return sign * c;
  });
  return out;
}

/** Splits delimited text into rows of cells. Handles double-quoted fields. */
export function parseDelimited(text: string, separator: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  const endCell = (): void => {
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
      wasQuoted = true;
    } else if (ch === separator) endCell();
    else if (ch === "\n") endRow();
    else cell += ch;
  }
  if (cell !== "" || row.length > 0 || wasQuoted) endRow();
  return rows;
}

/** Makes text safe inside a table cell: no newlines, escaped pipes. */
export function toCell(text: string): string {
  return text
    .replace(/\n/g, " ")
    .trim()
    .replace(/(\\*)\|/g, (m, slashes: string) => (slashes.length % 2 === 1 ? m : `${slashes}\\|`));
}

/** Chooses a separator if the text looks like TSV or CSV, else null. */
export function detectDelimited(text: string): { separator: "," | "\t"; rows: string[][] } | null {
  const trimmed = text.replace(/\n+$/, "").replace(/\r?\n$/, "");
  if (trimmed.trim() === "") return null;
  if (trimmed.includes("\t")) {
    const rows = parseDelimited(trimmed, "\t");
    if (rows.some((r) => r.length > 1)) return { separator: "\t", rows };
    return null;
  }
  const rows = parseDelimited(trimmed, ",");
  const width = rows[0]?.length ?? 0;
  if (rows.length >= 2 && width >= 2 && rows.every((r) => r.length === width)) {
    return { separator: ",", rows };
  }
  return null;
}

/** Builds a model from rows of text; the first row is the header. */
export function modelFromRows(rows: readonly (readonly string[])[], prefix = ""): TableModel {
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const fit = (r: readonly string[]): string[] => {
    const cells = r.map(toCell);
    while (cells.length < columns) cells.push("");
    return cells;
  };
  const [head = [], ...body] = rows;
  return {
    prefix,
    header: fit(head),
    align: Array.from({ length: columns }, () => "none" as Align),
    rows: body.map(fit),
  };
}

/** Writes pasted rows into the table from `(row, column)`, growing it as needed. Row 0 is the header. */
export function fillCells(
  m: TableModel,
  row: number,
  column: number,
  data: readonly (readonly string[])[],
): TableModel {
  let out = copy(m);
  const width = Math.max(...data.map((r) => r.length));
  while (columnCount(out) < column + width) out = insertColumn(out, columnCount(out));
  const needRows = row + data.length - 1; // body rows needed, if starting at the header
  while (out.rows.length < needRows) out.rows.push(emptyRow(columnCount(out)));
  data.forEach((cells, i) => {
    cells.forEach((value, j) => {
      const text = toCell(value);
      if (row + i === 0) out.header[column + j] = text;
      else {
        const target = out.rows[row + i - 1];
        if (target) target[column + j] = text;
      }
    });
  });
  return out;
}
