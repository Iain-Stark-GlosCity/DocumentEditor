/**
 * Markdown to a Word document (File > Export…). The Markdown is read exactly as the preview reads
 * it and written as a plain, conventional .docx that uses Word's own styles (Heading 1 to 6, Quote,
 * List Paragraph, Table Grid, Hyperlink, footnotes...), so it restyles cleanly and opens without
 * repair prompts in Word, LibreOffice and Google Docs.
 *
 * Loaded with `import()` when the first export runs (rule 6); runs in the browser engine and in
 * tests alike (`Packer.toArrayBuffer`, never the Node-only `toBuffer`). It never throws on odd
 * Markdown: what it cannot express becomes text, and pictures it cannot embed become their
 * alternative text. Nothing that identifies the user is written: the author and "last modified by"
 * properties are empty unless the front matter names an author.
 */
import { Document, Packer, PageOrientation, Paragraph, TextRun } from "docx";
import type { Nodes, Root } from "mdast";
import type { ExportContext } from "../../../core/format";
import { assignHeadingAnchors } from "./anchors";
import { BlockConverter, type Block } from "./blocks";
import { createEnv, type Env } from "./env";
import { readFrontMatter, type FrontMatter } from "./front-matter";
import { classifyImage, type DegradeReason } from "./images";
import { parseMarkdown } from "./parse";
import { PAGE, STYLES_XML } from "./styles";
import { runSafe, xmlSafe } from "./xml-text";

/** Every node of a tree, footnote definitions included, without recursion. */
function* allNodes(tree: Root): Generator<Nodes> {
  const stack: Nodes[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
  }
}

function collectDefinitions(tree: Root, env: Env): void {
  for (const node of allNodes(tree)) {
    if (node.type === "definition" && !env.definitions.has(node.identifier)) {
      env.definitions.set(node.identifier, node);
    } else if (
      node.type === "footnoteDefinition" &&
      !env.footnoteDefinitions.has(node.identifier)
    ) {
      env.footnoteDefinitions.set(node.identifier, node);
    }
  }
}

/** The pictures a document shows, by address, with their alternative text, in document order. */
function imageReferences(tree: Root, env: Env): { url: string; alt: string }[] {
  const out: { url: string; alt: string }[] = [];
  for (const node of allNodes(tree)) {
    if (node.type === "image") out.push({ url: node.url, alt: node.alt ?? "" });
    else if (node.type === "imageReference") {
      const definition = env.definitions.get(node.identifier);
      if (definition) out.push({ url: definition.url, alt: node.alt ?? "" });
    }
  }
  return out;
}

const REMOTE = /^(?:https?:|\/\/)/i;

async function loadImages(
  tree: Root,
  env: Env,
  readAsset: ExportContext["readAsset"],
): Promise<void> {
  const urls = [...new Set(imageReferences(tree, env).map((r) => r.url))];
  for (const url of urls) {
    let bytes: Uint8Array | null = null;
    // Remote pictures are never fetched; `readAsset` would refuse them anyway.
    if (url.trim() !== "" && !REMOTE.test(url.trim())) {
      try {
        bytes = await readAsset(url);
      } catch {
        bytes = null;
      }
    }
    env.images.set(url, classifyImage(bytes));
  }
}

function prepare(text: string): { tree: Root; env: Env } {
  const tree = parseMarkdown(text);
  const env = createEnv(text);
  collectDefinitions(tree, env);
  assignHeadingAnchors(tree, env);
  return { tree, env };
}

export interface DegradedImage {
  url: string;
  alt: string;
  reason: DegradeReason;
}

/**
 * The pictures an export would write as their alternative text instead of embedding, and why.
 * The exporter itself returns only bytes, so this is how a caller (or a test) can find out.
 */
export async function degradedImages(
  text: string,
  readAsset: ExportContext["readAsset"],
): Promise<DegradedImage[]> {
  const { tree, env } = prepare(text);
  await loadImages(tree, env, readAsset);
  const out: DegradedImage[] = [];
  for (const { url, alt } of imageReferences(tree, env)) {
    const result = env.images.get(url);
    if (result && !result.ok) out.push({ url, alt, reason: result.reason });
  }
  return out;
}

/**
 * `docx` 9 puts a note mark run into the two separator "notes" it writes for Word, in footnotes and
 * endnotes alike; Word's own separators hold only the separator line. Takes the mark out again.
 * The library's internal shape is checked at every step: if it ever changes, this does nothing
 * (and the tests say so).
 */
function cleanNoteSeparators(doc: Document): void {
  type Component = { root?: unknown };
  const parts = doc as unknown as {
    FootNotes?: { View?: Component };
    Endnotes?: { View?: Component };
  };
  for (const view of [parts.FootNotes?.View, parts.Endnotes?.View]) {
    if (!Array.isArray(view?.root)) continue;
    for (const note of view.root as Component[]) {
      if (!Array.isArray(note?.root)) continue;
      const [attributes, first] = note.root as [Component | undefined, Component | undefined];
      const type = (attributes?.root as { type?: unknown } | undefined)?.type;
      if (type !== "separator" && type !== "continuationSeparator") continue;
      const paragraph = (first as { paragraph?: unknown } | undefined)?.paragraph;
      if (paragraph instanceof Paragraph) (note.root as unknown[])[1] = paragraph;
    }
  }
}

interface Parts {
  body: Block[];
  lists: Env["lists"];
  footnotes: Record<string, { children: Paragraph[] }>;
  meta: FrontMatter;
}

function buildDocument(context: ExportContext, { body, lists, footnotes, meta }: Parts): Document {
  const doc = new Document({
    title: xmlSafe(meta.title ?? context.title).trim(),
    // Privacy: no user, machine or application name. An author named in the front matter is
    // the document's own statement and is kept.
    creator: meta.author === undefined ? "" : xmlSafe(meta.author).trim(),
    lastModifiedBy: "",
    description: "",
    revision: 1,
    externalStyles: STYLES_XML,
    numbering: { config: lists },
    footnotes,
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height, orientation: PageOrientation.PORTRAIT },
            margin: {
              top: PAGE.margin,
              right: PAGE.margin,
              bottom: PAGE.margin,
              left: PAGE.margin,
              header: PAGE.headerFooter,
              footer: PAGE.headerFooter,
              gutter: 0,
            },
          },
        },
        children: body.length > 0 ? body : [new Paragraph({})],
      },
    ],
  });
  cleanNoteSeparators(doc);
  return doc;
}

/** The document as plain paragraphs, one per line: the last resort if conversion itself fails. */
function plainDocument(text: string, context: ExportContext): Document {
  const body = text
    .split("\n")
    .map((line) => new Paragraph({ children: [new TextRun(runSafe(line))] }));
  return buildDocument(context, { body, lists: [], footnotes: {}, meta: {} });
}

function convert(context: ExportContext, tree: Root, env: Env): Document {
  const meta = readFrontMatter(tree);
  const converter = new BlockConverter(env);
  const body = converter.body(tree.children);
  // Footnote content cannot refer to further footnotes, so the list is complete after the body.
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  for (const note of env.notes) {
    footnotes[String(note.id)] = { children: converter.footnote(note.definition.children) };
  }
  return buildDocument(context, { body, lists: env.lists, footnotes, meta });
}

export async function markdownToDocx(text: string, context: ExportContext): Promise<Uint8Array> {
  let doc: Document;
  try {
    const { tree, env } = prepare(text);
    await loadImages(tree, env, context.readAsset);
    doc = convert(context, tree, env);
  } catch {
    // Never expected: every construct has a fallback. If something still fails, the reader gets
    // the text rather than an error.
    doc = plainDocument(text, context);
  }
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
