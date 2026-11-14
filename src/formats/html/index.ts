import { indentLess, indentMore } from "@codemirror/commands";
import { codeFolding, foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { TextFormatProvider } from "../../core/format";
import { HTML_TOO_LARGE, isTooLargeForPreview } from "../../render/html-limits";
import { lazyLanguage } from "../shared/lazy-language";
import { outlineFromState } from "./outline";

/**
 * The HTML grammar (with its embedded CSS and JavaScript grammars) loads when the first HTML
 * document opens, so none of it is in the startup bundle or the render worker (CLAUDE.md rule 6).
 */
const language = lazyLanguage(() =>
  import("@codemirror/lang-html").then((m) =>
    m.html({ autoCloseTags: true, matchClosingTags: true }),
  ),
);

/**
 * The sanitising pipeline is loaded when a preview is first requested, and only in the render
 * worker. The size check comes first, so a huge file never reaches the parser.
 */
type RenderModule = typeof import("../../render/html");
let pipeline: Promise<RenderModule> | undefined;

function loadPipeline(): Promise<RenderModule> {
  pipeline ??= import("../../render/html");
  return pipeline;
}

/** Views whose last key was Escape: the next Tab leaves the editor instead of indenting. */
const escaped = new WeakSet<EditorView>();

/**
 * Tab indents and Shift-Tab outdents, which makes Tab a keyboard trap. The way out is the usual
 * one for code editors: press Escape, then Tab, and focus moves on.
 */
const indentKeys: Extension = [
  indentUnit.of("  "),
  Prec.high(
    keymap.of([
      {
        key: "Escape",
        run(view) {
          escaped.add(view);
          return false;
        },
      },
      {
        key: "Tab",
        run(view) {
          if (escaped.delete(view)) return false;
          return indentMore(view);
        },
        shift(view) {
          if (escaped.delete(view)) return false;
          return indentLess(view);
        },
      },
    ]),
  ),
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key !== "Escape" && event.key !== "Tab") escaped.delete(view);
      return false;
    },
  }),
];

const foldStyle = EditorView.baseTheme({
  ".cm-foldGutter .cm-gutterElement": { cursor: "pointer", padding: "0 4px" },
  ".cm-foldPlaceholder": {
    background: "var(--bg-hover)",
    color: "var(--fg-muted)",
    border: "1px solid var(--border)",
    padding: "0 0.4em",
    borderRadius: "var(--radius-sm)",
  },
});

/** HTML source with a simplified, sanitised preview. Author styles and scripts are never applied. */
export const htmlProvider: TextFormatProvider = {
  kind: "text",
  id: "html",
  name: "HTML",
  fileExtensions: ["html", "htm"],
  viewModes: ["source", "split"],
  spellcheck: false,
  editorExtensions: () => [
    language(),
    indentKeys,
    codeFolding(),
    foldGutter(),
    keymap.of(foldKeymap),
    foldStyle,
  ],
  async render(text, context) {
    if (isTooLargeForPreview(text)) return { html: HTML_TOO_LARGE };
    return (await loadPipeline()).renderHtml(text, context);
  },
  outline: outlineFromState,
};
