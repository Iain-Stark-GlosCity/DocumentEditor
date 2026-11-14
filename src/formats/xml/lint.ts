/**
 * XML well-formedness problems, from the browser's own parser (`DOMParser` with
 * `application/xml`). The parser reports one error, with a line and column in its message; this
 * file reads that message, cleans it and turns it into a diagnostic.
 *
 * Chromium (and so WebView2) writes "error on line 3 at column 4: Unexpected closing tag: a != b"
 * into a `parsererror` element. The column is 1-based and counts code points. Firefox words it
 * differently ("Line Number 3, Column 4:"), so both are read. With no position the diagnostic
 * falls back on the start of the text.
 */
import type { Diagnostic } from "@codemirror/lint";
import { widen } from "../../core/problems";

/** Entity expansion above this many characters is not attempted (see `expansionTooLarge`). */
const EXPANSION_LIMIT = 4_000_000;

export interface ParsedError {
  /** 1-based, or null when the message carries no position. */
  line: number | null;
  column: number | null;
  message: string;
}

const XHTML = "http://www.w3.org/1999/xhtml";

/** Asks the browser to parse `text`; returns the error text, or null when it is well-formed. */
export function browserParse(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error =
    doc.getElementsByTagNameNS(XHTML, "parsererror")[0] ??
    doc.getElementsByTagName("parsererror")[0];
  if (!error) return null;
  const parts = Array.from(error.querySelectorAll("div, pre, h3"))
    .map((e) => e.textContent ?? "")
    .filter((s) => s.trim() !== "");
  return parts.length > 0 ? parts.join("\n") : (error.textContent ?? "");
}

/** True when `text` is well-formed XML. */
export function isWellFormed(text: string): boolean {
  return !expansionTooLarge(text) && browserParse(text) === null;
}

const NOISE = [
  /^This page contains the following errors:?$/i,
  /^Below is a rendering of the page up to the first error\.?$/i,
];

/** Friendlier wording for the parser's terse or alarming messages. */
function friendly(message: string): string {
  if (/^Entity too big/i.test(message)) {
    return "An entity expands to too much text (the limit guards against entity expansion attacks)";
  }
  if (/^Excessive node nesting/i.test(message)) return "Elements are nested too deeply";
  if (/larger\/more complex than allowed/i.test(message)) {
    return "The document is larger or more complex than the parser allows";
  }
  return message;
}

/** Cleans a message: no position prefix, no trailing full stop, one line, first letter capital. */
function clean(message: string): string {
  const one = message.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const nice = friendly(one);
  return nice.charAt(0).toUpperCase() + nice.slice(1);
}

/** The errors in a parser's error text. Never throws; unreadable text gives one position-less error. */
export function parseErrors(raw: string): ParsedError[] {
  const found: ParsedError[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !NOISE.some((n) => n.test(l)));
  // Chromium: "error on line 3 at column 4: message" (also "warning on ...").
  for (const line of lines) {
    const m = /^(?:error|warning) on line (\d+) at column (\d+):\s*(.*)$/i.exec(line);
    if (m) found.push({ line: Number(m[1]), column: Number(m[2]), message: clean(m[3] ?? "") });
  }
  if (found.length > 0) return found;
  // Firefox: "XML Parsing Error: mismatched tag. ..." then "Location: ..." and "Line Number 3, Column 4:".
  const position = /Line Number (\d+), Column (\d+)/i.exec(raw);
  const first = lines[0]?.replace(/^XML Parsing Error:\s*/i, "") ?? "";
  const message = clean(first === "" ? "The document is not well-formed" : first);
  return [
    {
      line: position ? Number(position[1]) : null,
      column: position ? Number(position[2]) : null,
      message,
    },
  ];
}

/** Offset of a 1-based line and column (counted in code points), clamped to the line. */
export function offsetOf(text: string, line: number, column: number): number {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return text.length;
    start = next + 1;
  }
  let end = text.indexOf("\n", start);
  if (end < 0) end = text.length;
  let at = start;
  for (let c = 1; c < column && at < end; c++) {
    const code = text.charCodeAt(at);
    at += code >= 0xd800 && code <= 0xdbff && at + 1 < end ? 2 : 1;
  }
  return at;
}

/**
 * The span worth underlining for an error whose position is `offset`. The parser reports the last
 * character of what it choked on, so a named token ("Unexpected token: c") is widened back over
 * that token, and an unexpected closing tag over the whole tag.
 */
function spanOf(text: string, offset: number, message: string): { from: number; to: number } {
  if (/^Unexpected closing tag/i.test(message)) {
    const open = text.lastIndexOf("</", offset);
    if (open >= 0 && !text.slice(open, offset).includes("\n"))
      return { from: open, to: offset + 1 };
  }
  const named = /^Unexpected (?:token|entity|characters outside the root element): (.+)$/i.exec(
    message,
  );
  const token = named?.[1];
  if (token) {
    for (const end of [offset + 1, offset]) {
      if (end - token.length >= 0 && text.slice(end - token.length, end) === token) {
        return { from: end - token.length, to: end };
      }
    }
  }
  return { from: offset, to: offset + 1 };
}

/**
 * True when the DOCTYPE declares entities that could expand to millions of characters. The
 * browser stops nested expansion ("billion laughs") itself, but a large entity referenced many
 * times is not stopped: 40 KB of text can expand to 100 MB and freeze the page for seconds. This
 * bound is the longest entity value times the number of `&`, and is cheap to compute.
 */
export function expansionTooLarge(text: string): boolean {
  if (!text.includes("<!ENTITY")) return false;
  let longest = 0;
  const declaration = /<!ENTITY\s+(?!%)\S+\s+(?:"([^"]*)"|'([^']*)')/g;
  for (let m = declaration.exec(text); m; m = declaration.exec(text)) {
    longest = Math.max(longest, (m[1] ?? m[2] ?? "").length);
  }
  let ampersands = 0;
  for (let i = text.indexOf("&"); i >= 0; i = text.indexOf("&", i + 1)) ampersands++;
  return longest * ampersands > EXPANSION_LIMIT;
}

/** The diagnostics of `text`: none when it is well-formed (or empty). */
export function xmlDiagnostics(
  text: string,
  parse: (text: string) => string | null = browserParse,
): Diagnostic[] {
  if (text.trim() === "") return [];
  if (expansionTooLarge(text)) {
    const { from, to } = widen(text.indexOf("<!ENTITY"), text.indexOf("<!ENTITY") + 8, text.length);
    return [
      {
        from,
        to,
        severity: "warning",
        message: "Entities in this document expand to too much text to check it safely",
      },
    ];
  }
  let raw: string | null;
  try {
    raw = parse(text);
  } catch (e) {
    raw = e instanceof Error ? e.message : "The document could not be read";
  }
  if (raw === null) return [];
  return parseErrors(raw)
    .slice(0, 1)
    .map((error) => {
      if (error.line === null || error.column === null) {
        const first = Math.max(0, text.search(/\S/));
        return {
          ...widen(first, first + 1, text.length),
          severity: "error" as const,
          message: error.message,
        };
      }
      const offset = Math.min(offsetOf(text, error.line, error.column), text.length);
      const span = spanOf(text, offset, error.message);
      return {
        ...widen(span.from, span.to, text.length),
        severity: "error" as const,
        message: error.message,
      };
    });
}
