/**
 * The editor's own syntax highlighting, replacing CodeMirror's default style. Tokens get stable
 * `tok-*` class names; their colours, weights and sizes live in `src/styles/syntax.css` and are
 * driven by the `--syn-*` variables in `theme.css`, so both themes and high contrast work from
 * CSS alone.
 */
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tagHighlighter, tags as t } from "@lezer/highlight";

export const editorHighlighter = tagHighlighter([
  { tag: t.heading1, class: "tok-h1" },
  { tag: t.heading2, class: "tok-h2" },
  { tag: t.heading3, class: "tok-h3" },
  { tag: [t.heading4, t.heading5, t.heading6, t.heading], class: "tok-h" },
  { tag: t.strong, class: "tok-strong" },
  { tag: t.emphasis, class: "tok-em" },
  { tag: t.strikethrough, class: "tok-strike" },
  { tag: t.link, class: "tok-link" },
  { tag: t.url, class: "tok-url" },
  { tag: t.monospace, class: "tok-code" },
  { tag: t.quote, class: "tok-quote" },
  { tag: [t.processingInstruction, t.contentSeparator], class: "tok-marker" },
  { tag: [t.meta, t.labelName], class: "tok-meta" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "tok-comment" },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], class: "tok-keyword" },
  { tag: [t.string, t.regexp, t.special(t.string)], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-number" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-fn" },
  { tag: [t.typeName, t.className, t.tagName], class: "tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "tok-prop" },
  { tag: t.invalid, class: "tok-invalid" },
]);

export const editorHighlighting: Extension = syntaxHighlighting(editorHighlighter);
