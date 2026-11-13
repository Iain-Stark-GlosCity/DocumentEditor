/**
 * The Markdown outline, read from the editor's Lezer syntax tree.
 *
 * The tree already tells headings from code, so there is no second parse. A small time budget
 * lets a nearly finished tree complete; otherwise the partial tree is used and the caller asks
 * again as parsing progresses.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { OutlineItem } from "../../core/format";

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = Tree["topNode"];

/** Milliseconds a single outline request may spend waiting for the parser. */
const PARSE_BUDGET_MS = 25;

const HEADING = /^(?:ATXHeading|SetextHeading)([1-6])$/;

/** Block nodes that cannot contain a heading, so the walk does not descend into them. */
const OPAQUE = new Set([
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "Paragraph",
  "Table",
  "LinkReference",
]);

/** Syntax that is part of the markup, not of the heading's text. */
const MARKUP = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "LinkLabel",
  "LinkTitle",
  "HTMLTag",
  "Comment",
  "ProcessingInstruction",
  "StrikethroughMark",
]);

/**
 * End offset of a YAML front matter block at the start of the document, or 0. The Markdown
 * parser has no front matter node: it sees the fences as a rule and a setext heading.
 */
export function frontMatterEnd(doc: Text): number {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return 0;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text.trimEnd();
    if (text === "---" || text === "...") return line.to;
  }
  return 0;
}

/** Plain text of a heading: markers dropped, link text, alt text and code text kept. */
function headingText(doc: Text, heading: SyntaxNode): string {
  let out = "";
  let pos = heading.from;
  const skip = (from: number, to: number) => {
    if (from > pos) out += doc.sliceString(pos, from);
    pos = Math.max(pos, to);
  };
  const walk = (parent: SyntaxNode) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (MARKUP.has(node.name)) skip(node.from, node.to);
      else if (node.name === "URL" && parent.name !== "Autolink") skip(node.from, node.to);
      else if (node.name === "Escape") skip(node.from, node.from + 1);
      else walk(node);
    }
  };
  walk(heading);
  if (heading.to > pos) out += doc.sliceString(pos, heading.to);
  return out.replace(/\s+/g, " ").trim();
}

/** Headings from a syntax tree, skipping front matter. */
function collect(doc: Text, tree: Tree): OutlineItem[] {
  const items: OutlineItem[] = [];
  const skipBefore = frontMatterEnd(doc);
  tree.iterate({
    enter(node) {
      if (OPAQUE.has(node.name)) return false;
      const match = HEADING.exec(node.name);
      if (!match) return;
      if (node.from >= skipBefore) {
        items.push({
          level: Number(match[1]),
          text: headingText(doc, node.node),
          line: doc.lineAt(node.from).number,
          from: node.from,
        });
      }
      return false;
    },
  });
  return items;
}

/**
 * Headings (ATX and setext) in document order. Code blocks and front matter are not headings.
 * Never blocks for long: an unfinished tree yields the headings parsed so far.
 */
export function outlineFromState(state: EditorState): OutlineItem[] {
  if (state.doc.length === 0) return [];
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  return collect(state.doc, tree);
}
