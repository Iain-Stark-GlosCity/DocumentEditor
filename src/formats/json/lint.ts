/**
 * JSON problems. `.json` is checked strictly (`JSON.parse`, through `jsonParseLinter`). `.jsonc`
 * allows comments and trailing commas, so it reports only the syntax errors of the Lezer JSON
 * grammar, with the comments and trailing commas blanked out first. The lang-json package is loaded when the first check runs.
 */
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type { Parser } from "@lezer/common";
import { widen } from "../../core/problems";

/**
 * Replaces every comment with spaces (keeping line breaks), so the text parses as plain JSON and
 * every offset in it is still an offset in the original. Returns where an unterminated block
 * comment starts, if there is one.
 */
export function maskComments(text: string): { masked: string; unterminated: number | null } {
  const out: string[] = [];
  let unterminated: number | null = null;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text.charAt(end) !== '"' && text.charAt(end) !== "\n") {
        end += text.charAt(end) === "\\" ? 2 : 1;
      }
      end = Math.min(text.length, end + 1);
      out.push(text.slice(i, end));
      i = end;
    } else if (ch === "/" && text.charAt(i + 1) === "/") {
      let end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      out.push(blank(text.slice(i, end)));
      i = end;
    } else if (ch === "/" && text.charAt(i + 1) === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close < 0 ? text.length : close + 2;
      if (close < 0) unterminated = i;
      out.push(blank(text.slice(i, end)));
      i = end;
    } else {
      out.push(ch);
      i++;
    }
  }
  return { masked: out.join(""), unterminated };
}

/**
 * Syntax errors of a JSON-with-comments document: the error nodes of the Lezer JSON tree, taken
 * over the text with its comments blanked out (the grammar itself has no comments).
 */
export function jsoncDiagnostics(text: string, parser: Parser): Diagnostic[] {
  if (text.trim() === "") return [];
  const { masked: commentless, unterminated } = maskComments(text);
  // Trailing commas are valid JSON with comments (tsconfig.json, VS Code settings), so they are
  // blanked out like the comments. The offsets are the same: only characters are replaced.
  let masked = commentless;
  const lenient = unterminated === null ? leniencies(text) : null;
  if (lenient && lenient.commas.length > 0) {
    const chars = masked.split("");
    for (const at of lenient.commas) chars[at] = " ";
    masked = chars.join("");
  }
  const found: Diagnostic[] = [];
  if (unterminated !== null) {
    const { from, to } = widen(unterminated, unterminated + 2, text.length);
    found.push({ from, to, severity: "error", message: "Unterminated comment" });
  }
  if (masked.trim() === "") return found;
  // The tree can hold several error nodes for one mistake (`{"a":` at the end of the text gives
  // two, at the same place); one underline and one count are enough.
  const seen = new Set<string>();
  parser.parse(masked).iterate({
    enter(node) {
      if (!node.type.isError) return;
      const { from, to } = widen(node.from, node.to, text.length);
      const key = `${from}:${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ from, to, severity: "error", message: "Syntax error" });
    },
  });
  return found;
}

/** Start of the first error node of the Lezer tree, or null if the text parses cleanly. */
function firstErrorOffset(text: string, parser: Parser): number | null {
  let at: number | null = null;
  parser.parse(text).iterate({
    enter(node) {
      if (at !== null) return false;
      if (node.type.isError) at = node.from;
      return undefined;
    },
  });
  return at;
}

export const COMMENT_WARNING =
  "Comments are not valid in strict JSON, but many tools accept them (tsconfig.json, VS Code settings). Use .jsonc to silence this.";
export const TRAILING_COMMA_WARNING =
  "Trailing commas are not valid in strict JSON, but many tools accept them (tsconfig.json, VS Code settings). Use .jsonc to silence this.";

/**
 * Where the comments and the trailing commas of a text are. A trailing comma is one whose next
 * token (past whitespace and comments) is `}` or `]`.
 */
function leniencies(text: string): { comments: [number, number][]; commas: number[] } | null {
  if (maskComments(text).unterminated !== null) return null;
  const comments: [number, number][] = [];
  const commas: number[] = [];
  let pendingComma = -1;
  // The last character that is not whitespace or inside a comment: a trailing comma follows a value.
  let last = "";
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text.charAt(end) !== '"' && text.charAt(end) !== "\n") {
        end += text.charAt(end) === "\\" ? 2 : 1;
      }
      i = Math.min(text.length, end + 1);
      pendingComma = -1;
      last = '"';
    } else if (ch === "/" && (text.charAt(i + 1) === "/" || text.charAt(i + 1) === "*")) {
      let end: number;
      if (text.charAt(i + 1) === "/") {
        end = text.indexOf("\n", i);
        if (end < 0) end = text.length;
      } else {
        end = text.indexOf("*/", i + 2) + 2;
      }
      comments.push([i, end]);
      i = end;
    } else {
      // A second comma in a row is a mistake, not a trailing comma: do not record either.
      if (ch === ",") pendingComma = pendingComma >= 0 || !/["\]}\w.+-]/.test(last) ? -2 : i;
      else if ((ch === "}" || ch === "]") && pendingComma >= 0) commas.push(pendingComma);
      if (ch !== "," && !/\s/.test(ch)) pendingComma = -1;
      if (!/\s/.test(ch)) last = ch;
      i++;
    }
  }
  return { comments, commas };
}

/**
 * Strict JSON: one diagnostic, with the message of `JSON.parse` (through `jsonParseLinter`). Some
 * engines word the message without a position ("Unexpected token ',' ... is not valid JSON"),
 * and the linter then falls back to offset 0; the Lezer tree places the error instead.
 */
export async function strictDiagnostics(state: EditorState): Promise<Diagnostic[]> {
  const text = state.doc.toString();
  if (text.trim() === "") return [];
  const { jsonParseLinter, jsonLanguage } = await import("@codemirror/lang-json");
  const errors = strictErrors(state, text, jsonParseLinter, jsonLanguage.parser);
  if (errors.length === 0) return [];
  // Comments and trailing commas are what tsconfig.json and VS Code settings legitimately
  // contain. When they are the ONLY problem, they are warnings. Any other problem keeps the
  // strict errors, unchanged.
  const found = leniencies(text);
  if (found === null || found.comments.length + found.commas.length === 0) return errors;
  const cleaned = text.split("");
  for (const [from, to] of found.comments) {
    for (let k = from; k < to; k++) if (cleaned[k] !== "\n") cleaned[k] = " ";
  }
  for (const at of found.commas) cleaned[at] = " ";
  const rest = jsoncDiagnostics(cleaned.join(""), jsonLanguage.parser);
  if (rest.length > 0) return errors;
  return [
    ...found.comments.map(([from, to]) => ({
      ...widen(from, to, text.length),
      severity: "warning" as const,
      message: COMMENT_WARNING,
    })),
    ...found.commas.map((at) => ({
      ...widen(at, at + 1, text.length),
      severity: "warning" as const,
      message: TRAILING_COMMA_WARNING,
    })),
  ].sort((a, b) => a.from - b.from);
}

function strictErrors(
  state: EditorState,
  text: string,
  jsonParseLinter: typeof import("@codemirror/lang-json").jsonParseLinter,
  parser: Parser,
): Diagnostic[] {
  // The linter reads only `state.doc` of the view it is given.
  const found = jsonParseLinter()({ state } as Parameters<ReturnType<typeof jsonParseLinter>>[0]);
  return found.map((d) => {
    const positioned = /at position \d+|at line \d+ column \d+/.test(d.message);
    const at = positioned ? null : firstErrorOffset(text, parser);
    return { ...d, ...widen(at ?? d.from, at === null ? d.to : at, text.length) };
  });
}

export async function jsoncDiagnosticsFor(state: EditorState): Promise<Diagnostic[]> {
  const { jsonLanguage } = await import("@codemirror/lang-json");
  return jsoncDiagnostics(state.doc.toString(), jsonLanguage.parser);
}
