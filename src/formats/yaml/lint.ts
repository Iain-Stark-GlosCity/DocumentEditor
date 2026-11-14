/**
 * YAML problems from the `yaml` package, which is loaded when the first check runs. Errors and
 * warnings carry character offsets into the text, which map straight onto editor positions.
 */
import type { Diagnostic } from "@codemirror/lint";
import type { YAMLError } from "yaml";
import { widen } from "../../core/problems";

type Parse = typeof import("yaml").parseAllDocuments;

/** `yaml` often points at one character (the first of a key); underline the whole word. */
function wordEnd(text: string, start: number, end: number): number {
  if (end - start > 1) return end;
  const word = /^[^\s:,[\]{}#]+/.exec(text.slice(start, start + 200));
  return word ? start + word[0].length : end;
}

function toDiagnostic(error: YAMLError, severity: Diagnostic["severity"], text: string) {
  const [start, end] = error.pos;
  const { from, to } = widen(start, wordEnd(text, start, end), text.length);
  return { from, to, severity, message: error.message } satisfies Diagnostic;
}

/** Syntax errors and warnings (duplicate keys, bad indentation and so on) of every document. */
export function yamlDiagnostics(text: string, parseAllDocuments: Parse): Diagnostic[] {
  if (text.trim() === "") return [];
  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  // `prettyErrors: false` keeps each message short; the position is shown by the editor.
  for (const doc of parseAllDocuments(text, { prettyErrors: false })) {
    const all = [
      ...doc.errors.map((e) => toDiagnostic(e, "error", text)),
      ...doc.warnings.map((e) => toDiagnostic(e, "warning", text)),
    ];
    for (const d of all) {
      const key = `${d.from}:${d.to}:${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(d);
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

export async function yamlDiagnosticsFor(text: string): Promise<Diagnostic[]> {
  const { parseAllDocuments } = await import("yaml");
  return yamlDiagnostics(text, parseAllDocuments);
}
