/**
 * The HTML outline: `h1` to `h6` elements, read from the editor's Lezer syntax tree.
 *
 * The tree already tells a heading from a comment or a script, so there is no second parse. A
 * small time budget lets a nearly finished tree complete; otherwise the partial tree is used and
 * the caller asks again as parsing progresses.
 *
 * The HTML grammar is loaded lazily (CLAUDE.md rule 6), so for a moment after a document opens
 * the editor has no tree at all. Then `scanHeadings` reads the text directly, so the outline is
 * not empty until the first keystroke.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { OutlineItem } from "../../core/format";

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = Tree["topNode"];

/** Milliseconds a single outline request may spend waiting for the parser. */
const PARSE_BUDGET_MS = 25;
/** A heading longer than this is cut. A missing end tag would otherwise swallow the page. */
const MAX_TEXT = 200;

const HEADING = /^h([1-6])$/i;

/** Elements that end a heading's text when one is met inside it (a missing `</h2>`). */
const BLOCKS = new Set(
  "address article aside blockquote details dd div dl dt fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table ul"
    .split(" ")
    .map((name) => name.toLowerCase()),
);

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
};

/** Decodes the common character references; unknown ones are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g,
    (all, dec, hex, name) => {
      if (name !== undefined) return NAMED[name as string] ?? all;
      const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
      try {
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      } catch {
        return all;
      }
    },
  );
}

function tidy(text: string): string {
  const flat = decodeEntities(text).replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

function tagNameOf(element: SyntaxNode, doc: Text): string {
  const open = element.firstChild;
  const name = open?.getChild("TagName");
  return name ? doc.sliceString(name.from, name.to).toLowerCase() : "";
}

/** Plain text of a heading: tags dropped, text and entities kept, comments and scripts skipped. */
function headingText(doc: Text, heading: SyntaxNode): string {
  let out = "";
  let done = false;
  const walk = (parent: SyntaxNode) => {
    for (let node = parent.firstChild; node && !done; node = node.nextSibling) {
      switch (node.name) {
        case "Text":
          out += doc.sliceString(node.from, node.to);
          break;
        case "EntityReference":
        case "CharacterReference":
          out += doc.sliceString(node.from, node.to);
          break;
        case "Element": {
          const name = tagNameOf(node, doc);
          if (BLOCKS.has(name)) done = true;
          else if (name !== "script" && name !== "style") walk(node);
          break;
        }
        default:
          // Tags, attributes, comments and embedded script or style are not text.
          break;
      }
    }
  };
  walk(heading);
  return tidy(out);
}

function collect(doc: Text, tree: Tree): OutlineItem[] {
  const items: OutlineItem[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Element") return;
      const match = HEADING.exec(tagNameOf(node.node, doc));
      if (!match) return;
      items.push({
        level: Number(match[1]),
        text: headingText(doc, node.node),
        line: doc.lineAt(node.from).number,
        from: node.from,
      });
      // Keep going: a heading left open can contain the next one.
    },
  });
  return items;
}

/** Text that cannot hold a heading: comments, and the bodies of script, style and the like. */
const OPAQUE =
  /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/**
 * Headings found by reading the text, for when there is no syntax tree yet. Less exact than the
 * tree (it does not understand a heading left open) but right for ordinary documents.
 */
export function scanHeadings(doc: Text): OutlineItem[] {
  const text = doc.toString();
  // Blank out what cannot contain a heading, keeping every offset.
  const masked = text.replace(OPAQUE, (all) => all.replace(/[^\n]/g, " "));
  const items: OutlineItem[] = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]{0,2000}?)<\/h\1\s*>/gi;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const inner = (match[2] ?? "").replace(/<[^>]*>/g, "");
    items.push({
      level: Number(match[1]),
      text: tidy(inner),
      line: doc.lineAt(match.index).number,
      from: match.index,
    });
  }
  return items;
}

/**
 * Headings in document order. Never blocks for long: an unfinished tree yields the headings
 * parsed so far, and no tree at all falls back to `scanHeadings`.
 */
export function outlineFromState(state: EditorState): OutlineItem[] {
  if (state.doc.length === 0) return [];
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  if (tree.length === 0) return scanHeadings(state.doc);
  return collect(state.doc, tree);
}
