/**
 * Raw HTML in Markdown becomes plain text in the Word document: tags are removed, entities decoded,
 * `<br>` is a line break, block elements separate paragraphs, and comments, scripts and styles are
 * dropped. Markup never reaches the Word file.
 */
import type { Nodes as HastNodes } from "hast";
import { fromHtml } from "hast-util-from-html";

/** A piece of text from HTML: words, or a line break. */
export type HtmlPiece = { kind: "text"; text: string } | { kind: "break" };

/** Elements whose content is never text a reader sees. */
const SKIP = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "head",
  "title",
  "iframe",
  "object",
]);

/** Elements that start a new paragraph when HTML is a block. */
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "tr",
  "ul",
  "caption",
]);

/** A marker in the walk for a paragraph boundary. */
const PARAGRAPH = Symbol("paragraph");
type Item = HastNodes | typeof PARAGRAPH;

function parse(html: string): HastNodes | null {
  try {
    return fromHtml(html, { fragment: true });
  } catch {
    return null;
  }
}

/**
 * The text of some HTML as paragraphs of pieces. Inline HTML (one tag in a sentence) gives one
 * paragraph; white space is collapsed as a browser would.
 */
export function htmlToParagraphs(html: string): HtmlPiece[][] {
  const tree = parse(html);
  if (tree === null) return [];
  const paragraphs: HtmlPiece[][] = [[]];
  const stack: Item[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const current = paragraphs[paragraphs.length - 1]!;
    if (node === PARAGRAPH) {
      if (current.length > 0) paragraphs.push([]);
      continue;
    }
    if (node.type === "text") {
      const text = node.value.replace(/[ \t\n\r\f]+/g, " ");
      if (text !== "") current.push({ kind: "text", text });
      continue;
    }
    if (node.type === "element") {
      if (SKIP.has(node.tagName)) continue;
      if (node.tagName === "br") {
        current.push({ kind: "break" });
        continue;
      }
      if (node.tagName === "td" || node.tagName === "th") current.push({ kind: "text", text: " " });
      const block = BLOCK.has(node.tagName);
      if (block) stack.push(PARAGRAPH);
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
      if (block) stack.push(PARAGRAPH);
      continue;
    }
    if (node.type === "root") {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
    // Comments and doctypes are dropped.
  }
  return paragraphs.map(trimParagraph).filter((p) => p.length > 0);
}

/** Inline HTML: its text as one run of pieces, white space kept at the edges (it sits in a sentence). */
export function htmlToInline(html: string): HtmlPiece[] {
  const tree = parse(html);
  if (tree === null) return [];
  const out: HtmlPiece[] = [];
  const stack: HastNodes[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "text") {
      const text = node.value.replace(/[ \t\n\r\f]+/g, " ");
      if (text !== "") out.push({ kind: "text", text });
    } else if (node.type === "element") {
      if (SKIP.has(node.tagName)) continue;
      if (node.tagName === "br") out.push({ kind: "break" });
      else for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    } else if (node.type === "root") {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
  }
  return out;
}

/** Drops white space at the start and end of a paragraph, and around its line breaks. */
function trimParagraph(pieces: HtmlPiece[]): HtmlPiece[] {
  const out: HtmlPiece[] = [];
  for (const piece of pieces) {
    if (piece.kind === "text") {
      let text = piece.text;
      const previous = out[out.length - 1];
      if (previous === undefined || previous.kind === "break") text = text.replace(/^ +/, "");
      if (previous?.kind === "text") {
        if (previous.text.endsWith(" ") && text.startsWith(" ")) text = text.slice(1);
        if (text !== "") previous.text += text;
        continue;
      }
      if (text !== "") out.push({ kind: "text", text });
    } else {
      const previous = out[out.length - 1];
      if (previous?.kind === "text") previous.text = previous.text.replace(/ +$/, "");
      out.push(piece);
    }
  }
  const last = out[out.length - 1];
  if (last?.kind === "text") {
    last.text = last.text.replace(/ +$/, "");
    if (last.text === "") out.pop();
  }
  return out;
}
