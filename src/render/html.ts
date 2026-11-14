/**
 * HTML document -> sanitised HTML for the preview pane.
 *
 * The author's markup is untrusted. It is parsed as a full document the way a browser would,
 * reduced to the body, given `data-line` marks from the parser's source positions, and then
 * sanitised with a strict allow-list schema. As in the Markdown pipeline (CLAUDE.md rule 5),
 * sanitising is the last transform before stringify.
 *
 * Author CSS and scripts are never applied: `style`, `link`, `script` and friends are removed with
 * their contents, `style` and `class` attributes are dropped, and one note at the top says so.
 *
 * SVG and MathML are removed entirely (with their contents). Both can carry script, external
 * references (`use`, `foreignObject`, `animate`) and have a long history of parser-differential
 * (mXSS) bypasses, and a simplified preview gains little from drawing them. The Markdown
 * pipeline allows a fixed subset only for KaTeX output that it generates itself.
 */
import type { Element, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import type { Schema } from "hast-util-sanitize";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified, type Processor } from "unified";
import type { RenderContext } from "../core/format";
import {
  HTML_NOTE_CLASS,
  HTML_NOTE_TEXT,
  HTML_TOO_LARGE,
  isTooLargeForPreview,
} from "./html-limits";
import {
  rehypeFragmentLinks,
  rehypeResolveAssets,
  sanitiseSchema,
  walkElements,
  type FileData,
} from "./pipeline";

/** Elements removed together with everything inside them. */
const STRIPPED = [
  // Code and styling that must never run or apply.
  "script",
  "style",
  "link",
  "meta",
  "base",
  "noscript",
  "template",
  "head",
  "title",
  // Other documents and plug-ins.
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "noembed",
  "noframes",
  "portal",
  // Form controls (the form element itself is unwrapped, so its text stays).
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "datalist",
  "textarea",
  "output",
  // Media and drawing surfaces.
  "audio",
  "video",
  "source",
  "track",
  "canvas",
  "map",
  "area",
  // Foreign content.
  "svg",
  "math",
];

/** Harmless structural and text-level elements the Markdown schema lacks. */
const EXTRA_TAGS = [
  "abbr",
  "address",
  "article",
  "aside",
  "bdi",
  "bdo",
  "caption",
  "center",
  "cite",
  "col",
  "colgroup",
  "data",
  "dfn",
  "figcaption",
  "figure",
  "footer",
  "header",
  "hgroup",
  "main",
  "mark",
  "menu",
  "nav",
  "small",
  "time",
  "u",
  "wbr",
];

// `form` and `picture` are unwrapped rather than stripped: their text and fallback image stay.
const DROPPED_TAGS = new Set([...STRIPPED, "form", "picture"]);

const baseAttributes = { ...sanitiseSchema.attributes };
// Attributes of the default list that name a URL or a form's behaviour. There is no form here,
// and `action` is not covered by the protocol checks, so it goes.
const FORM_ATTRIBUTES = new Set(["action", "encType", "method", "acceptCharset", "accept"]);
baseAttributes["*"] = (baseAttributes["*"] ?? []).filter(
  (name) => typeof name !== "string" || !FORM_ATTRIBUTES.has(name),
);
// The Markdown pipeline's extras (task-list checkboxes, highlighter and maths classes, the
// Mermaid placeholder) have no place here: author markup must not reach them.
delete baseAttributes["input"];
delete baseAttributes["source"];
delete baseAttributes["pre"];
delete baseAttributes["span"];

/**
 * The Markdown schema, narrowed. Everything it allowed that this preview does not need is
 * removed; what is added is either structural markup (`EXTRA_TAGS`) or one fixed class on the
 * preview's own note.
 */
export const htmlSanitiseSchema: Schema = {
  ...sanitiseSchema,
  tagNames: [
    ...(sanitiseSchema.tagNames ?? []).filter((tag) => !DROPPED_TAGS.has(tag)),
    ...EXTRA_TAGS,
  ],
  strip: STRIPPED,
  required: {},
  attributes: {
    ...baseAttributes,
    code: [["className", /^language-./]],
    p: [["className", HTML_NOTE_CLASS]],
  },
  protocols: {
    ...sanitiseSchema.protocols,
    // Only `img` carries `src` (checked by the tests), and `restrictDataImages` has already
    // removed every `data:` address except the four raster image types.
    src: ["http", "https", "asset", "data"],
  },
};

/** Elements that start a block of the document, and so get a `data-line` mark. */
const BLOCKS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "details",
  "dd",
  "div",
  "dl",
  "dt",
  "figure",
  "footer",
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
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

/** A parser for unified: the whole document, with source positions. */
function parseDocument(this: Processor): void {
  this.parser = (document: string) => fromHtml(document, { fragment: false });
}

/** Keep only what is inside `<body>`. Head content (title, styles, links) is not part of the preview. */
function rehypeBodyOnly() {
  return (tree: Root) => {
    for (const html of tree.children) {
      if (html.type !== "element" || html.tagName !== "html") continue;
      const body = html.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "body",
      );
      tree.children = body ? body.children : [];
      return;
    }
    tree.children = [];
  };
}

/**
 * Drop any `data-line` and `class` the author wrote on a paragraph, then mark each block with
 * the 1-based line it starts on, taken from the parser's positions (so before anything else
 * moves nodes around). The mark is ours alone; the sanitiser keeps it.
 */
function rehypeBlockLines() {
  return (tree: Root) => {
    walkElements(tree, (element) => {
      delete element.properties["dataLine"];
      if (element.tagName === "p") delete element.properties["className"];
    });
    walkElements(tree, (element) => {
      if (!BLOCKS.has(element.tagName)) return;
      const line = element.position?.start.line;
      if (line !== undefined) element.properties["dataLine"] = line;
    });
  };
}

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/i;

/**
 * `data:` addresses are allowed only on `img`, and only for the four raster types, in base64.
 * An image cannot run script, and these types are never treated as SVG. Everything else with a
 * `data:` address loses it. Runs before the sanitiser, which stays the last step.
 */
function restrictDataImages() {
  return (tree: Root) => {
    walkElements(tree, (element) => {
      for (const name of ["src", "href", "cite", "longDesc", "poster", "srcSet"]) {
        const value = element.properties[name];
        if (typeof value !== "string" || !/^\s*data:/i.test(value)) continue;
        if (!(element.tagName === "img" && name === "src" && SAFE_DATA_IMAGE.test(value))) {
          delete element.properties[name];
        }
      }
    });
  };
}

/** The note at the top of the preview. Added before the sanitiser, which keeps this one class. */
function rehypePreviewNote() {
  return (tree: Root) => {
    const note: Element = {
      type: "element",
      tagName: "p",
      properties: { className: [HTML_NOTE_CLASS] },
      children: [{ type: "text", value: HTML_NOTE_TEXT }],
    };
    tree.children.unshift(note);
  };
}

/** `rehypeResolveAssets` reads the render context from the file's data; this fits its type to unified's. */
function resolveAssets() {
  const resolve = rehypeResolveAssets();
  return (tree: Root, file: { data: unknown }) => resolve(tree, file as { data: FileData });
}

function build() {
  return unified()
    .use(parseDocument)
    .use(rehypeBodyOnly)
    .use(rehypeBlockLines)
    .use(resolveAssets)
    .use(rehypeFragmentLinks)
    .use(restrictDataImages)
    .use(rehypePreviewNote)
    .use(rehypeSanitize, htmlSanitiseSchema)
    .use(rehypeStringify)
    .freeze();
}

let processor: ReturnType<typeof build> | undefined;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The render was aborted");
    error.name = "AbortError";
    throw error;
  }
}

/**
 * An HTML document to sanitised preview HTML. Throws an `AbortError` if `context.signal` aborts.
 * Documents over `HTML_PREVIEW_LIMIT` get a fixed message instead.
 */
export async function renderHtml(text: string, context: RenderContext): Promise<{ html: string }> {
  throwIfAborted(context.signal);
  if (isTooLargeForPreview(text)) return { html: HTML_TOO_LARGE };
  processor ??= build();
  const file = await processor.process({ value: text, data: { context } satisfies FileData });
  throwIfAborted(context.signal);
  return { html: String(file) };
}
