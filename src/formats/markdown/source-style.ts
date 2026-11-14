import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { frontMatterEnd } from "./live/frontmatter";

const frontMatterLine = Decoration.line({ class: "cm-md-frontmatter" });
const codeLine = Decoration.line({ class: "cm-md-codeline" });

function build(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const items: Range<Decoration>[] = [];
  const end = frontMatterEnd(doc);
  if (end > 0) {
    const last = doc.lineAt(end).number;
    for (let n = 1; n <= last; n++) items.push(frontMatterLine.range(doc.line(n).from));
  }
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) {
          const at = doc.line(n).from;
          if (seen.has(at)) continue;
          seen.add(at);
          items.push(codeLine.range(at));
        }
        return false;
      },
    });
  }
  return Decoration.set(items, true);
}

/**
 * Source-mode extras for Markdown: mutes YAML front matter (the grammar reads it as a rule
 * followed by a setext heading, which would otherwise be coloured like one) and gives fenced and
 * indented code a quiet full-width background.
 */
export const sourceStyle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
