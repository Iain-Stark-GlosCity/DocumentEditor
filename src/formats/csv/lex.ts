/**
 * The one state machine that reads delimited text. The parser (`parse.ts`) and the editor's column
 * colouring (`colour.ts`) both run on it, so they cannot disagree about where a field ends.
 *
 * Rules (RFC 4180 plus common reality):
 * - A field that starts with `"` is quoted. It runs to the next `"` that is not doubled (`""` is
 *   one quote character). It may contain delimiters and line breaks.
 * - After the closing quote, anything up to the next delimiter or line break is kept as part of the
 *   field (`"a"b` reads as `ab`). A stray quote inside an unquoted field is just a character.
 * - An unterminated quote runs to the end of the text.
 * - A completely empty line is not a row. A final line break does not start another row.
 * - `\r` before `\n` is not part of the field. (The editor buffer never has `\r`, because CRLF is
 *   converted at the platform boundary, but pasted text may still carry it.)
 */

export type Delimiter = "," | ";" | "\t" | "|";

/**
 * Where the machine is at the start of a physical line. Outside a quoted field it is always the
 * start of a row (`col` 0). Inside one it is a continuation, and `col` is the column of the field
 * that is still open. That is all that is needed to resume reading in the middle of a document.
 */
export interface LexState {
  readonly inQuote: boolean;
  readonly col: number;
}

export const ROW_START: LexState = { inQuote: false, col: 0 };

export interface LexHandler {
  /**
   * One field. `from` and `to` are offsets in the text read plus `base`; the span includes the
   * quotes. `delimiterAfter` is true when the character at `to` is a delimiter. A field that is a
   * continuation (reading resumed inside a quote) starts at the start of the text given.
   */
  field(from: number, to: number, col: number, quoted: boolean, delimiterAfter: boolean): void;
  /** The row that the last field belonged to is complete. `at` is the offset after its text. */
  rowEnd(at: number): void;
}

const QUOTE = 34;
const NEWLINE = 10;
const RETURN = 13;

/**
 * Reads `text`, which must start at the start of a physical line, from `state`. Returns the state
 * at the end of the text, which is the state at the start of the next line when `text` ends just
 * after a line break. `base` is added to every offset given to the handler.
 */
export function lex(
  text: string,
  delimiter: Delimiter,
  state: LexState,
  handler: LexHandler,
  base = 0,
): LexState {
  const n = text.length;
  const dc = delimiter.charCodeAt(0);
  let i = 0;
  let col = state.col;
  let resume = state.inQuote;
  let open = resume; // a row has started and has not ended

  for (;;) {
    let fieldStart = i;
    let quoted = resume;

    if (!resume) {
      if (!open) {
        if (i >= n) break;
        const c = text.charCodeAt(i);
        // A blank line (or a lone CR LF) is skipped.
        if (c === NEWLINE) {
          i++;
          continue;
        }
        if (c === RETURN && text.charCodeAt(i + 1) === NEWLINE) {
          i += 2;
          continue;
        }
      }
      fieldStart = i;
      quoted = text.charCodeAt(i) === QUOTE;
      if (quoted) i++;
    }
    open = true;

    if (quoted) {
      // Find the closing quote.
      for (;;) {
        const j = text.indexOf('"', i);
        if (j < 0) {
          // Unterminated: the field is the rest of the text, and the quote is still open.
          handler.field(fieldStart + base, n + base, col, true, false);
          handler.rowEnd(n + base);
          return { inQuote: true, col };
        }
        if (text.charCodeAt(j + 1) === QUOTE) {
          i = j + 2;
          continue;
        }
        i = j + 1;
        break;
      }
      resume = false;
    }

    // To the next delimiter or line break. After a closing quote this is the tolerated tail.
    let c = 0;
    while (i < n && (c = text.charCodeAt(i)) !== dc && c !== NEWLINE) i++;
    const atEnd = i >= n;
    const delimiterNext = !atEnd && c === dc;
    let to = i;
    if (!delimiterNext && to > fieldStart && text.charCodeAt(to - 1) === RETURN) to--;

    handler.field(fieldStart + base, to + base, col, quoted, delimiterNext);
    if (delimiterNext) {
      col++;
      i++;
      continue;
    }
    handler.rowEnd(to + base);
    open = false;
    col = 0;
    if (atEnd) break;
    i++; // the line break
  }
  return ROW_START;
}

/** The value of a field: quotes removed, doubled quotes undone. */
export function fieldValue(text: string, from: number, to: number): string {
  if (text.charCodeAt(from) !== QUOTE) return text.slice(from, to);
  let out = "";
  let i = from + 1;
  for (;;) {
    const j = text.indexOf('"', i);
    if (j < 0 || j >= to) return out + text.slice(i, to);
    if (text.charCodeAt(j + 1) === QUOTE && j + 1 < to) {
      out += text.slice(i, j + 1);
      i = j + 2;
      continue;
    }
    // Closing quote; whatever follows it (a tolerated tail) is kept.
    return out + text.slice(i, j) + text.slice(j + 1, to);
  }
}
