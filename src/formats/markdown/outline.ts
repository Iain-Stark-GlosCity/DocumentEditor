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
  // The `>` of the later lines of a setext heading inside a block quote.
  "QuoteMark",
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "\u00a9",
  reg: "\u00ae",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
};

/** The character an entity such as `&amp;` or `&#169;` stands for; unknown names stay as written. */
function decodeEntity(entity: string): string {
  const numeric = /^&#(?:x([0-9a-f]+)|([0-9]+));$/i.exec(entity);
  if (numeric) {
    const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : Number(numeric[2]);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  }
  return NAMED_ENTITIES[entity.slice(1, -1)] ?? entity;
}

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
  // Text between nodes. After a line break, quote marks (`> `) are the container's, not the text's.
  const raw = (from: number, to: number) =>
    doc.sliceString(from, to).replace(/\n[ \t]*(?:>[ \t]*)+/g, "\n");
  const skip = (from: number, to: number) => {
    if (from > pos) out += raw(pos, from);
    pos = Math.max(pos, to);
  };
  const walk = (parent: SyntaxNode) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (MARKUP.has(node.name)) skip(node.from, node.to);
      else if (node.name === "URL" && parent.name !== "Autolink") skip(node.from, node.to);
      else if (node.name === "Escape") skip(node.from, node.from + 1);
      else if (node.name === "Entity") {
        if (node.from > pos) out += raw(pos, node.from);
        out += decodeEntity(doc.sliceString(node.from, node.to));
        pos = Math.max(pos, node.to);
      } else walk(node);
    }
  };
  walk(heading);
  if (heading.to > pos) out += raw(pos, heading.to);
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
