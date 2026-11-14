/**
 * Builds the preview table as an HTML string.
 *
 * Why this HTML needs no sanitiser: it is safe by construction. The only tags written are the
 * fixed ones below, every attribute value is a number or one of a few fixed class names, and all
 * text that comes from the file goes through `escapeHtml` before it is added. A cell can therefore
 * never introduce an element, an attribute or a URL, whatever it contains. (The Markdown
 * sanitiser is for HTML that someone else wrote; none is read here, so its allow-list is left
 * alone.) `table.test.ts` also parses the output and checks that nothing but the fixed tags and
 * attributes appear.
 */
import { fieldValue, parseCsv, type CsvRow, type Delimiter } from "./parse";

export interface TableOptions {
  delimiter: Delimiter;
  /** Treat the first row as column headings. */
  headerRow: boolean;
  /** Show at most this many data rows. */
  previewRows: number;
}

/** A cell longer than this is cut in the preview (the file is untouched). */
const MAX_CELL_CHARS = 2000;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "\u0000": "�",
};

export function escapeHtml(text: string): string {
  // NUL is replaced too: it is not valid in HTML text.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[&<>"'\u0000]/g, (c) => ESCAPES[c] ?? c);
}

/**
 * A number as people write it in a spreadsheet: optional sign and currency symbol, digits with
 * optional thousands separators, a decimal part, an exponent, a trailing percent sign.
 */
const NUMERIC = /^[+-]?[£$€]?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?%?$/;

export function isNumeric(value: string): boolean {
  const v = value.trim();
  return /\d/.test(v) && NUMERIC.test(v);
}

/** A column is numeric when at least 90 per cent of its non-empty cells are. */
const NUMERIC_SHARE = 0.9;

function number(n: number): string {
  return n.toLocaleString("en-GB");
}

/** The most common field count, preferring the larger on a tie. */
function usualWidth(rows: readonly CsvRow[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.fields.length, (counts.get(row.fields.length) ?? 0) + 1);
  let width = 0;
  let best = 0;
  for (const [w, c] of counts) {
    if (c > best || (c === best && w > width)) {
      width = w;
      best = c;
    }
  }
  return width;
}

export function renderCsvTable(text: string, options: TableOptions): string {
  const header = options.headerRow;
  const parsed = parseCsv(text, options.delimiter, {
    maxRows: options.previewRows + (header ? 1 : 0),
  });
  if (parsed.rows.length === 0) return '<p class="csv-note">This file has no rows.</p>';

  const headRow = header ? parsed.rows[0] : undefined;
  const body = header ? parsed.rows.slice(1) : parsed.rows;
  const totalRows = parsed.rowCount - (header ? 1 : 0);
  const columns = parsed.rows.reduce((max, row) => Math.max(max, row.fields.length), 0);
  const expected = usualWidth(parsed.rows);

  const values = (row: CsvRow): string[] =>
    row.fields.map((f) => {
      const v = fieldValue(text, f.from, f.to);
      return v.length > MAX_CELL_CHARS ? v.slice(0, MAX_CELL_CHARS) + "…" : v;
    });
  const bodyValues = body.map(values);

  const numeric: boolean[] = [];
  for (let c = 0; c < columns; c++) {
    let filled = 0;
    let numbers = 0;
    for (const row of bodyValues) {
      const v = row[c];
      if (v === undefined || v.trim() === "") continue;
      filled++;
      if (isNumeric(v)) numbers++;
    }
    numeric.push(filled > 0 && numbers / filled >= NUMERIC_SHARE);
  }

  let html = "";
  if (totalRows > body.length) {
    html += `<p class="csv-note">Showing the first ${number(body.length)} of ${number(totalRows)} rows</p>`;
  }
  html += '<table class="csv-table">';
  html += `<caption class="csv-sr">${number(totalRows)} rows by ${number(columns)} columns</caption>`;

  if (headRow) {
    const cells = values(headRow);
    html += `<thead><tr data-line="${headRow.line}"><th scope="col" class="csv-rownum">#</th>`;
    for (let c = 0; c < columns; c++) {
      const name = cells[c];
      const cls = numeric[c] ? "csv-num" : "";
      if (name === undefined || name.trim() === "") {
        html += `<th scope="col" class="${cls} csv-unnamed">Column ${c + 1}</th>`;
      } else {
        html += `<th scope="col"${cls ? ` class="${cls}"` : ""}>${escapeHtml(name)}</th>`;
      }
    }
    html += "</tr></thead>";
  }

  html += "<tbody>";
  body.forEach((row, r) => {
    const cells = bodyValues[r] ?? [];
    const ragged = cells.length !== expected;
    html += `<tr data-line="${row.line}"${ragged ? ' class="csv-ragged"' : ""}>`;
    html += `<th scope="row" class="csv-rownum">${number(r + 1)}`;
    if (ragged) {
      html += `<span class="csv-flag" aria-hidden="true">!</span><span class="csv-sr"> (${cells.length} fields, expected ${expected})</span>`;
    }
    html += "</th>";
    for (let c = 0; c < columns; c++) {
      const value = cells[c];
      if (value === undefined) {
        html += '<td class="csv-missing"></td>';
      } else {
        const extra = c >= expected && expected > 0 ? " csv-extra" : "";
        const cls = (numeric[c] ? "csv-num" : "") + extra;
        html += `<td${cls ? ` class="${cls.trim()}"` : ""}>${escapeHtml(value)}</td>`;
      }
    }
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}
