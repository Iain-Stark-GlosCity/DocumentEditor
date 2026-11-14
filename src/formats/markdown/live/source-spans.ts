/**
 * Constructs live preview leaves as written for now (inline maths and footnote markers): they
 * are marked so that they read as code-like spans rather than body text. Nothing is hidden or
 * replaced, so the caret and the text are untouched.
 */
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";

/** `$…$` as in Pandoc: no space inside the delimiters, and a closing `$` is not followed by a digit. */
const MATHS = /(?<![\\$\w])\$(?!\s)([^$\n]*?[^\s$\\])\$(?!\d)/g;
const FOOTNOTE = /\[\^[^\]\s]+\]/g;
const SKIP = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "CommentBlock",
  "HTMLBlock",
  "Table",
]);

const maths = Decoration.mark({ class: "cm-live-maths" });
const footnote = Decoration.mark({ class: "cm-live-footnote" });
const mathsLine = Decoration.line({ class: "cm-live-source-block" });

function insideSkipped(view: EditorView, pos: number): boolean {
  for (let node = syntaxTree(view.state).resolveInner(pos, 1); ;) {
    if (SKIP.has(node.name)) return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

/** Lines of `$$ … $$` display maths, up to the last visible line, outside code. */
function displayMaths(view: EditorView, items: Range<Decoration>[]): void {
  const { doc } = view.state;
  const last = Math.max(...view.visibleRanges.map((r) => doc.lineAt(r.to).number), 1);
  let open = false;
  for (let n = 1; n <= last; n++) {
    const line = doc.line(n);
    const fence = line.text.trim().startsWith("$$") && !insideSkipped(view, line.from);
    if (fence || open) items.push(mathsLine.range(line.from));
    if (fence) open = !open;
  }
}

function build(view: EditorView): DecorationSet {
  const found: { from: number; to: number; deco: Decoration }[] = [];
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      const line = doc.line(n);
      if (!line.text.includes("$") && !line.text.includes("[^")) continue;
      for (const [re, deco] of [
        [MATHS, maths],
        [FOOTNOTE, footnote],
      ] as const) {
        re.lastIndex = 0;
        for (let m = re.exec(line.text); m; m = re.exec(line.text)) {
          const start = line.from + m.index;
          if (!insideSkipped(view, start)) {
            found.push({ from: start, to: start + m[0].length, deco });
          }
        }
      }
    }
  }
  const items = found.map((f) => f.deco.range(f.from, f.to));
  displayMaths(view, items);
  return Decoration.set(items, true);
}

export const liveSourceSpans = ViewPlugin.fromClass(
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
