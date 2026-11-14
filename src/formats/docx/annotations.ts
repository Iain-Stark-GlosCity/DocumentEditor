/**
 * Makes the Formatting view's notation read as quiet annotations around the document's text:
 * paragraph comments, section lines and tags get classes that docx.css dims, so the content reads
 * as the body. Works on the visible lines only, with regular expressions (the notation is
 * regular enough), so it costs nothing on large documents.
 */
import type { Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const pComment = Decoration.mark({ class: "cm-docx-pcomment" });
const metaLine = Decoration.line({ class: "cm-docx-meta" });
const bannerLine = Decoration.line({ class: "cm-docx-banner" });
const tagMark = Decoration.mark({ class: "cm-docx-tag" });
const tokenMark = Decoration.mark({ class: "cm-docx-token" });
const rawMark = Decoration.mark({ class: "cm-docx-raw" });

/** Tags written by the view (not every `<` in a document, which is escaped as `\<`). */
const TAG =
  /(?<!\\)<\/?(span|u|sup|sub|ins|del|move-from|move-to|format-change|field|field-code|comment|comment-ref|bookmark|bookmark-start|bookmark-end|sdt|smart-tag|custom-xml|drawing|vml|math|hyperlink|dir|bdo|ruby|move-from-range|move-to-range|permission-start|permission-end|subdocument|b|i|s|table|tr|td|p)\b[^>]*>/g;
const TOKEN =
  /(?<!\\)<(tab|br|nbsp|sp|shy|nbhy|sym|ptab|char|note-number|comment-mark|separator|continuation-separator|page-number|date-part|custom-mark|field-char)\b[^>]*\/>/g;

export function buildAnnotations(view: EditorView): DecorationSet {
  const items: Range<Decoration>[] = [];
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const text = line.text;
      if (/^<!-- ={4} .* ={4} -->$/.test(text)) items.push(bannerLine.range(line.from));
      else if (/^\s*<!--.*-->$/.test(text) && !/^\s*<!-- (raw|error) /.test(text))
        items.push(metaLine.range(line.from));
      const marks: [number, number, Decoration][] = [];
      for (const m of text.matchAll(/<!-- (raw|error) .*?-->/g))
        marks.push([m.index, m.index + m[0].length, rawMark]);
      const trailing = /\s(<!-- p( .*)? -->)$/.exec(text);
      if (trailing) marks.push([trailing.index + 1, text.length, pComment]);
      for (const m of text.matchAll(TAG)) marks.push([m.index, m.index + m[0].length, tagMark]);
      for (const m of text.matchAll(TOKEN)) marks.push([m.index, m.index + m[0].length, tokenMark]);
      // Leave out marks inside others (a tag inside a raw placeholder).
      marks.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      let end = -1;
      for (const [s, e, deco] of marks) {
        if (s < end) continue;
        items.push(deco.range(line.from + s, line.from + e));
        end = e;
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(items, true);
}

export const docxAnnotations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildAnnotations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = buildAnnotations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
