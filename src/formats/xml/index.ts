import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FormatCommand, TextFormatProvider } from "../../core/format";
import { problemChecking } from "../../core/problems";
import { dataEditing } from "../shared/data-editing";
import { lazyLanguage } from "../shared/lazy-language";
import { isWellFormed, xmlDiagnostics } from "./lint";
import { applyChanges, tidyChanges, type TextChange } from "./tidy";
import { xmlToolbar } from "./toolbar";

/** Documents above this many characters are not checked (about 5 MB). */
export const XML_CHECK_LIMIT = 5_000_000;

const xmlOptions = Facet.define<{ indent(): number }, { indent(): number }>({
  combine: (values) => values[0] ?? { indent: () => 2 },
});

// The language brings tag matching (through bracketMatching) and closing tags as you type.
const language = lazyLanguage(() => import("@codemirror/lang-xml").then((m) => m.xml()));

const shift = (changes: readonly TextChange[], by: number): TextChange[] =>
  changes.map((c) => ({ from: c.from - by, to: c.to - by, insert: c.insert }));

/**
 * Tidy: re-indents the whitespace between elements and changes nothing else (see `tidy.ts`).
 * Declines (false) text that is not well-formed; the problem checker already says why. It is
 * one undoable transaction over the span that changes, so the cursor, folds and diagnostics outside
 * that span stay where they are.
 */
function tidy(view: EditorView): boolean {
  const text = view.state.doc.toString();
  const changes = tidyChanges(text, view.state.facet(xmlOptions).indent());
  if (changes === null || !isWellFormed(text)) return false;
  if (changes.length === 0) return true;
  // One replacement over the span from the first change to the last. Dispatching the gaps one by
  // one is quadratic on a very long line (each splice copies the line): 600 KB crashed the tab.
  const first = changes[0] as TextChange;
  const last = changes[changes.length - 1] as TextChange;
  const insert = applyChanges(text.slice(first.from, last.to), shift(changes, first.from));
  view.dispatch({
    changes: { from: first.from, to: last.to, insert },
    userEvent: "input.reformat",
    scrollIntoView: true,
  });
  return true;
}

export const xmlCommands: readonly FormatCommand[] = [
  // Shares its key with JSON's "Format document". That is fine: the workbench only claims a key
  // for a command that is enabled, and a format's commands are enabled only in its own documents.
  { id: "xml.format", title: "Tidy", defaultKey: "Shift-Alt-f", run: tidy },
];

export const xmlProvider: TextFormatProvider = {
  kind: "text",
  id: "xml",
  name: "XML",
  fileExtensions: ["xml", "rels", "xsd", "xsl", "xslt"],
  viewModes: ["source"],
  spellcheck: false,
  commands: xmlCommands,
  // Word writes document.xml as one line of a megabyte or more.
  longLineCommand: "xml.format",
  toolbar: xmlToolbar,
  editorExtensions(context) {
    const indent = () => Math.round(context.setting("xml.indent", 2));
    return [
      language(),
      xmlOptions.of({ indent }),
      // Brackets and quotes are not closed: in XML they are mostly text.
      dataEditing({ indent: indent(), closeBrackets: false }),
      context.setting("xml.lint", true)
        ? problemChecking({
            source: (state) => xmlDiagnostics(state.doc.toString()),
            limit: XML_CHECK_LIMIT,
          })
        : [],
    ];
  },
};
