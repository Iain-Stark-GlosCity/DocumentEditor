import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { problemChecking } from "../../core/problems";
import type { FormatCommand, TextFormatProvider } from "../../core/format";
import { extensionOf } from "../../core/registry";
import { dataEditing } from "../shared/data-editing";
import { lazyLanguage } from "../shared/lazy-language";
import { jsoncDiagnosticsFor, strictDiagnostics } from "./lint";
import { jsonToolbar } from "./toolbar";
import { formatJson, LENIENT, minifyJson, type WhitespaceOptions } from "./whitespace";

/** What the commands need to know about the document and settings, read when they run. */
interface JsonOptions extends WhitespaceOptions {
  indent(): number;
}

const jsonOptions = Facet.define<JsonOptions, JsonOptions>({
  combine: (values) => values[0] ?? { comments: false, indent: () => 2 },
});

const language = lazyLanguage(() => import("@codemirror/lang-json").then((m) => m.json()));

/** Replaces the whole text with `transform(text)` as one undoable change; false if it declines. */
function rewrite(view: EditorView, transform: (text: string, o: JsonOptions) => string | null) {
  const text = view.state.doc.toString();
  const result = transform(text, view.state.facet(jsonOptions));
  if (result === null) return false;
  if (result === text) return true;
  // Only the span that differs is replaced, so the cursor, folds and diagnostics outside it stay.
  let from = 0;
  const max = Math.min(text.length, result.length);
  while (from < max && text.charCodeAt(from) === result.charCodeAt(from)) from++;
  let tail = 0;
  while (
    tail < max - from &&
    text.charCodeAt(text.length - 1 - tail) === result.charCodeAt(result.length - 1 - tail)
  ) {
    tail++;
  }
  view.dispatch({
    changes: { from, to: text.length - tail, insert: result.slice(from, result.length - tail) },
    userEvent: "input.reformat",
    scrollIntoView: true,
  });
  return true;
}

export const jsonCommands: readonly FormatCommand[] = [
  {
    id: "json.format",
    title: "Format document",
    defaultKey: "Shift-Alt-f",
    run: (view) =>
      rewrite(
        view,
        (text, o) =>
          formatJson(text, o.indent(), o) ??
          // Strict `.json` with only comments or trailing commas (warnings) still formats.
          (o.comments ? null : formatJson(text, o.indent(), LENIENT)),
      ),
  },
  {
    id: "json.minify",
    title: "Minify",
    run: (view) =>
      rewrite(
        view,
        (text, o) => minifyJson(text, o) ?? (o.comments ? null : minifyJson(text, LENIENT)),
      ),
  },
];

export const jsonProvider: TextFormatProvider = {
  kind: "text",
  id: "json",
  name: "JSON",
  fileExtensions: ["json", "jsonc", "geojson"],
  viewModes: ["source"],
  spellcheck: false,
  settings: ["json.indent", "json.lint"],
  commands: jsonCommands,
  toolbar: jsonToolbar,
  editorExtensions(context) {
    const comments = extensionOf(context.path ?? "") === "jsonc";
    const indent = () => Math.round(context.setting("json.indent", 2));
    return [
      language(),
      jsonOptions.of({ comments, indent }),
      dataEditing({ indent: indent(), closeBrackets: true }),
      context.setting("json.lint", true)
        ? problemChecking({ source: comments ? jsoncDiagnosticsFor : strictDiagnostics })
        : [],
    ];
  },
};
