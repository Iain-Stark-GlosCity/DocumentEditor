/**
 * JSON problems. `.json` is checked strictly (`JSON.parse`, through `jsonParseLinter`). `.jsonc`
 * allows comments, so it reports only the syntax errors of the Lezer JSON grammar, with the
 * comments blanked out first. The lang-json package is loaded when the first check runs.
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
  const { masked, unterminated } = maskComments(text);
  const found: Diagnostic[] = [];
  if (unterminated !== null) {
    const { from, to } = widen(unterminated, unterminated + 2, text.length);
    found.push({ from, to, severity: "error", message: "Unterminated comment" });
  }
  if (masked.trim() === "") return found;
  parser.parse(masked).iterate({
    enter(node) {
      if (!node.type.isError) return;
      const { from, to } = widen(node.from, node.to, text.length);
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

/**
 * Strict JSON: one diagnostic, with the message of `JSON.parse` (through `jsonParseLinter`). Some
 * engines word the message without a position ("Unexpected token ',' ... is not valid JSON"),
 * and the linter then falls back to offset 0; the Lezer tree places the error instead.
 */
export async function strictDiagnostics(state: EditorState): Promise<Diagnostic[]> {
  const text = state.doc.toString();
  if (text.trim() === "") return [];
  const { jsonParseLinter, jsonLanguage } = await import("@codemirror/lang-json");
  // The linter reads only `state.doc` of the view it is given.
  const found = jsonParseLinter()({ state } as Parameters<ReturnType<typeof jsonParseLinter>>[0]);
  return found.map((d) => {
    const positioned = /at position \d+|at line \d+ column \d+/.test(d.message);
    const at = positioned ? null : firstErrorOffset(text, jsonLanguage.parser);
    return { ...d, ...widen(at ?? d.from, at === null ? d.to : at, text.length) };
  });
}

export async function jsoncDiagnosticsFor(state: EditorState): Promise<Diagnostic[]> {
  const { jsonLanguage } = await import("@codemirror/lang-json");
  return jsoncDiagnostics(state.doc.toString(), jsonLanguage.parser);
}
