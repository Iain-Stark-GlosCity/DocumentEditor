/**
 * Parses CSV and TSV text into rows with source positions. Pure TypeScript: no CodeMirror, no DOM,
 * so it runs on the main thread, in the render worker and in tests alike. The reading rules are
 * in `lex.ts`.
 */
import { lex, ROW_START, type Delimiter } from "./lex";

export { fieldValue, type Delimiter } from "./lex";

/** A field's span in the text, including its quotes when it has them. */
export interface CsvField {
  from: number;
  to: number;
  quoted: boolean;
}

export interface CsvRow {
  /** 1-based source line the row starts on. A row with a quoted line break spans several lines. */
  line: number;
  /** Offset of the start of the row, and of the end of its text (before the line break). */
  from: number;
  to: number;
  fields: CsvField[];
}

export interface CsvParse {
  delimiter: Delimiter;
  /** The first `maxRows` rows. */
  rows: CsvRow[];
  /** Every row in the text, including those past `maxRows`. */
  rowCount: number;
}

export interface ParseOptions {
  /** Keep (and number) at most this many rows; the rest are only counted. Default: all. */
  maxRows?: number;
}

/** Reads `text` with the given delimiter. */
export function parseCsv(text: string, delimiter: Delimiter, options: ParseOptions = {}): CsvParse {
  const maxRows = options.maxRows ?? Infinity;
  const rows: CsvRow[] = [];
  let rowCount = 0;
  let fields: CsvField[] | null = rowCount < maxRows ? [] : null;
  let rowFrom = -1;
  // Line numbers are found by counting line breaks between the starts of kept rows.
  let line = 1;
  let countedTo = 0;

  lex(text, delimiter, ROW_START, {
    field(from, to, _col, quoted) {
      if (fields === null) return;
      if (fields.length === 0) rowFrom = from;
      fields.push({ from, to, quoted });
    },
    rowEnd(at) {
      rowCount++;
      if (fields !== null) {
        for (let i = text.indexOf("\n", countedTo); i >= 0 && i < rowFrom;) {
          line++;
          countedTo = i + 1;
          i = text.indexOf("\n", countedTo);
        }
        countedTo = Math.max(countedTo, Math.min(rowFrom, text.length));
        rows.push({ line, from: rowFrom, to: at, fields });
      }
      fields = rowCount < maxRows ? [] : null;
    },
  });
  return { delimiter, rows, rowCount };
}

/** Candidates in priority order: when two score the same, the earlier one wins. */
const CANDIDATES: readonly Delimiter[] = [",", "\t", ";", "|"];
const SAMPLE_LINES = 50;
const SAMPLE_CHARS = 64 * 1024;

/**
 * Picks the delimiter by consistency over the first ~50 lines. For each candidate the sample is
 * read as a table; the score is the share of rows that have the most common field count (at least
 * two), then that field count, then the priority order comma, tab, semicolon, pipe. A text where
 * no candidate yields two or more columns is single-column, and reads as comma.
 */
export function detectDelimiter(text: string): Delimiter {
  let end = 0;
  for (let lines = 0; lines < SAMPLE_LINES; lines++) {
    const next = text.indexOf("\n", end);
    if (next < 0 || next >= SAMPLE_CHARS) {
      end = Math.min(text.length, SAMPLE_CHARS);
      break;
    }
    end = next + 1;
  }
  const sample = text.slice(0, end);
  // The cut can fall inside a row; that last row is not evidence.
  const truncated = end < text.length;

  let best: Delimiter = ",";
  let bestShare = 0;
  let bestWidth = 0;
  for (const candidate of CANDIDATES) {
    const { rows } = parseCsv(sample, candidate, { maxRows: SAMPLE_LINES });
    if (truncated && rows.length > 1) rows.pop();
    if (rows.length === 0) continue;
    const widths = new Map<number, number>();
    for (const row of rows) widths.set(row.fields.length, (widths.get(row.fields.length) ?? 0) + 1);
    let width = 0;
    let count = 0;
    for (const [w, c] of widths) {
      if (c > count || (c === count && w > width)) {
        width = w;
        count = c;
      }
    }
    if (width < 2) continue;
    const share = count / rows.length;
    if (share > bestShare || (share === bestShare && width > bestWidth)) {
      best = candidate;
      bestShare = share;
      bestWidth = width;
    }
  }
  return best;
}

export const DELIMITER_SETTINGS = ["auto", "comma", "semicolon", "tab", "pipe"] as const;
export type DelimiterSetting = (typeof DELIMITER_SETTINGS)[number];

const BY_NAME: Record<Exclude<DelimiterSetting, "auto">, Delimiter> = {
  comma: ",",
  semicolon: ";",
  tab: "\t",
  pipe: "|",
};

/** The delimiter to read with: the setting if it names one, a tab for `.tsv`, else detected. */
export function resolveDelimiter(setting: string, text: string, path: string | null): Delimiter {
  if (setting in BY_NAME) return BY_NAME[setting as keyof typeof BY_NAME];
  if (path !== null && /\.tsv$/i.test(path)) return "\t";
  return detectDelimiter(text);
}

/** The next setting after `current` in the cycle auto, comma, semicolon, tab, pipe. */
export function nextDelimiterSetting(current: string): DelimiterSetting {
  const i = DELIMITER_SETTINGS.indexOf(current as DelimiterSetting);
  return DELIMITER_SETTINGS[(i + 1) % DELIMITER_SETTINGS.length] ?? "auto";
}
