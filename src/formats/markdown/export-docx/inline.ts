/**
 * Markdown inline content (mdast phrasing nodes) to Word runs. The tree is first flattened into
 * pieces that carry their formatting (without recursion, so deep nesting cannot overflow the stack),
 * then consecutive pieces of the same link are wrapped in one hyperlink.
 */
import {
  ExternalHyperlink,
  FootnoteReferenceRun,
  ImageRun,
  InternalHyperlink,
  Tab,
  TextRun,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type { Nodes, PhrasingContent } from "mdast";
import type { Env } from "./env";
import { fitToPage } from "./images";
import { htmlToInline } from "./html-text";
import { classifyLink, type LinkTarget } from "./links";
import { plainText } from "./parse";
import { CODE_FONT, STYLE } from "./styles";
import { runSafe, xmlSafe } from "./xml-text";

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** The link this text is part of. Pieces of one link share the same object. */
  link?: LinkTarget & { kind: "external" | "internal" };
}

type Piece =
  | { kind: "text"; text: string; marks: Marks; font?: string }
  | { kind: "break"; marks: Marks }
  | { kind: "image"; url: string; alt: string; title: string | null; marks: Marks }
  | { kind: "footnote"; id: number; marks: Marks };

type Work = { node: Nodes; marks: Marks } | { text: string; marks: Marks };

export interface InlineOptions {
  /** Formatting every run gets (a table header row is bold). */
  marks?: Marks;
  /** Footnote references become text: Word has no footnotes inside footnotes. */
  inFootnote?: boolean;
  /** Text to put first, such as a task list's check box. */
  prefix?: { text: string; font?: string };
}

/** Task list check boxes. */
export const CHECKBOX = { unchecked: "☐ ", checked: "☑ ", font: "Segoe UI Symbol" } as const;

function imageAddress(node: Nodes, env: Env): { url: string; title: string | null } | null {
  if (node.type === "image") return { url: node.url, title: node.title ?? null };
  if (node.type === "imageReference") {
    const definition = env.definitions.get(node.identifier);
    return definition ? { url: definition.url, title: definition.title ?? null } : null;
  }
  return null;
}

function flatten(children: readonly PhrasingContent[], env: Env, options: InlineOptions): Piece[] {
  const pieces: Piece[] = [];
  const base = options.marks ?? {};
  if (options.prefix) {
    const prefix: Piece = { kind: "text", text: options.prefix.text, marks: {} };
    if (options.prefix.font !== undefined) prefix.font = options.prefix.font;
    pieces.push(prefix);
  }
  const stack: Work[] = [];
  const pushChildren = (nodes: readonly Nodes[], marks: Marks) => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) stack.push({ node: nodes[i]!, marks });
  };
  pushChildren(children, base);

  while (stack.length > 0) {
    const work = stack.pop()!;
    if ("text" in work) {
      pieces.push({ kind: "text", text: work.text, marks: work.marks });
      continue;
    }
    const { node, marks } = work;
    switch (node.type) {
      case "text":
        // A soft line break inside a paragraph reads as a space.
        pieces.push({ kind: "text", text: node.value.replace(/[ \t]*\n[ \t]*/g, " "), marks });
        break;
      case "strong":
        pushChildren(node.children, { ...marks, bold: true });
        break;
      case "emphasis":
        pushChildren(node.children, { ...marks, italic: true });
        break;
      case "delete":
        pushChildren(node.children, { ...marks, strike: true });
        break;
      case "inlineCode":
        pieces.push({ kind: "text", text: node.value, marks: { ...marks, code: true } });
        break;
      case "break":
        pieces.push({ kind: "break", marks });
        break;
      case "inlineMath": {
        // Known limitation: maths is not converted to Word equations; the source stays, in italic.
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const literal =
          start !== undefined && end !== undefined
            ? env.source.slice(start, end)
            : `$${node.value}$`;
        pieces.push({
          kind: "text",
          text: literal.replace(/\n/g, " "),
          marks: { ...marks, italic: true },
        });
        break;
      }
      case "link":
      case "linkReference": {
        const url =
          node.type === "link" ? node.url : (env.definitions.get(node.identifier)?.url ?? null);
        if (url === null) {
          pushChildren(node.children, marks);
          break;
        }
        const target = classifyLink(url, plainText(node, { imageAlt: true }), env.anchors);
        if (target.kind === "none" || marks.link !== undefined) {
          // A link inside a link (only from raw HTML) keeps the outer one.
          if (target.kind === "none" && target.address !== undefined) {
            stack.push({ text: ` (${target.address})`, marks });
          }
          pushChildren(node.children, marks);
        } else {
          pushChildren(node.children, { ...marks, link: target });
        }
        break;
      }
      case "image":
      case "imageReference": {
        const address = imageAddress(node, env);
        pieces.push({
          kind: "image",
          url: address?.url ?? "",
          alt: node.alt ?? "",
          title: address?.title ?? null,
          marks,
        });
        break;
      }
      case "footnoteReference": {
        const definition = env.footnoteDefinitions.get(node.identifier);
        if (options.inFootnote || definition === undefined) {
          pieces.push({ kind: "text", text: `[${node.label ?? node.identifier}]`, marks });
        } else {
          const id = env.notes.length + 1;
          env.notes.push({ id, definition });
          pieces.push({ kind: "footnote", id, marks });
        }
        break;
      }
      case "html":
        for (const piece of htmlToInline(node.value)) {
          pieces.push(
            piece.kind === "break"
              ? { kind: "break", marks }
              : { kind: "text", text: piece.text, marks },
          );
        }
        break;
      default:
        // Anything else (a construct from a future plugin) gives its text.
        if ("children" in node) pushChildren(node.children as Nodes[], marks);
        else if ("value" in node && typeof node.value === "string") {
          pieces.push({ kind: "text", text: node.value, marks });
        }
    }
  }
  return pieces;
}

/** Text with tabs as Word tab characters. */
function textChildren(text: string): (string | Tab)[] {
  const out: (string | Tab)[] = [];
  const parts = text.split("\t");
  parts.forEach((part, i) => {
    if (i > 0) out.push(new Tab());
    if (part !== "") out.push(part);
  });
  return out;
}

function runOptions(marks: Marks): IRunOptions {
  const options: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {};
  if (marks.bold) options.bold = true;
  if (marks.italic) options.italics = true;
  if (marks.strike) options.strike = true;
  if (marks.link) {
    options.style = STYLE.hyperlink;
    if (marks.code) {
      options.font = CODE_FONT;
      options.noProof = true;
    }
  } else if (marks.code) {
    options.style = STYLE.code;
  }
  return options;
}

function imageRun(
  piece: Piece & { kind: "image" },
  env: Env,
  counter: { n: number },
): ParagraphChild {
  const result = env.images.get(piece.url);
  const alt = xmlSafe(piece.alt).trim();
  if (result === undefined || !result.ok) {
    return new TextRun({
      ...runOptions(piece.marks),
      italics: true,
      text: runSafe(`[${alt || "Image"}]`),
    });
  }
  counter.n += 1;
  const size = fitToPage(result.size);
  const altText: { name: string; description?: string; title?: string } = {
    name: `Picture ${counter.n}`,
  };
  if (alt !== "") altText.description = alt;
  const title = piece.title === null ? "" : xmlSafe(piece.title).trim();
  if (title !== "") altText.title = title;
  return new ImageRun({ type: result.kind, data: result.data, transformation: size, altText });
}

/** Shared across a whole document, so pictures are numbered in order. */
export interface InlineState {
  pictures: { n: number };
}

/** Converts inline content to Word paragraph children. */
export function inlineRuns(
  children: readonly PhrasingContent[],
  env: Env,
  state: InlineState,
  options: InlineOptions = {},
): ParagraphChild[] {
  const pieces = flatten(children, env, options);
  const out: ParagraphChild[] = [];
  let group: ParagraphChild[] = [];
  let groupLink: Marks["link"];

  const flush = () => {
    if (groupLink === undefined || group.length === 0) return;
    out.push(
      groupLink.kind === "external"
        ? new ExternalHyperlink({ link: groupLink.url, children: group })
        : new InternalHyperlink({ anchor: groupLink.anchor, children: group }),
    );
    group = [];
    groupLink = undefined;
  };

  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]!;
    if (piece.marks.link !== groupLink) flush();
    groupLink = piece.marks.link;
    const target = groupLink === undefined ? out : group;
    switch (piece.kind) {
      case "text": {
        // Merge neighbouring text with the same formatting into one run.
        let text = piece.text;
        while (i + 1 < pieces.length) {
          const next = pieces[i + 1]!;
          if (
            next.kind !== "text" ||
            next.font !== piece.font ||
            !sameMarks(next.marks, piece.marks)
          )
            break;
          text += next.text;
          i += 1;
        }
        const clean = runSafe(text);
        if (clean === "") break;
        const options = runOptions(piece.marks);
        target.push(
          new TextRun(
            piece.font !== undefined
              ? { ...options, font: piece.font, children: textChildren(clean) }
              : { ...options, children: textChildren(clean) },
          ),
        );
        break;
      }
      case "break":
        target.push(new TextRun({ ...runOptions(piece.marks), break: 1 }));
        break;
      case "image":
        target.push(imageRun(piece, env, state.pictures));
        break;
      case "footnote":
        target.push(new FootnoteReferenceRun(piece.id));
        break;
    }
  }
  flush();
  return out;
}

function sameMarks(a: Marks, b: Marks): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    a.link === b.link
  );
}
