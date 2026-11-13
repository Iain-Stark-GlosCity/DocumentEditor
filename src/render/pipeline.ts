/**
 * The Markdown -> HTML pipeline. Pure unified; no DOM or window access, so it can move into
 * a Web Worker later.
 *
 * Order matters (CLAUDE.md rule 5): sanitising is the last transform before stringify.
 */
import type { Element, Nodes, Root as HastRoot } from "hast";
import { defaultSchema, type Schema } from "hast-util-sanitize";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Processor } from "unified";
import type { RenderContext } from "../core/format";

export interface PipelineOptions {
  /** Parse YAML front matter and keep it out of the body. Default true. */
  frontmatter?: boolean;
  /** GFM extensions (tables, task lists, strikethrough, autolinks, footnotes). Default true. */
  gfm?: boolean;
  /** Add `data-line` to block elements. Default true. */
  dataLines?: boolean;
  /** Rewrite relative image sources through `RenderContext.resolveAsset`. Default true. */
  resolveAssets?: boolean;
  /**
   * Sanitise the HTML. Default true. Only the conformance tests turn this off, because the spec
   * examples include raw HTML that the sanitiser (correctly) removes.
   */
  sanitise?: boolean;
}

/** GitHub-style default schema plus what this app needs. */
export const sanitiseSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // `align` (table cells) and the task-list checkbox attributes are already in the default
    // schema; `data-line` is ours, for editor/preview scroll sync.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataLine"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // `asset` is the scheme Tauri uses for local files. Images only; links stay http(s)/mailto.
    src: [...(defaultSchema.protocols?.["src"] ?? []), "asset"],
  },
};

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** A path relative to the document: no scheme, not protocol-relative, not root-relative, not a fragment. */
export function isRelativePath(url: string): boolean {
  if (url === "" || url.startsWith("#") || url.startsWith("/") || url.startsWith("\\")) {
    return false;
  }
  return !SCHEME.test(url);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The render was aborted");
    error.name = "AbortError";
    throw error;
  }
}

interface FileData {
  context?: RenderContext;
}

/** Walk hast elements depth-first without pulling in a visitor library. */
function walkElements(node: Nodes, visit: (element: Element, parent: Nodes) => void): void {
  if (!("children" in node)) return;
  for (const child of node.children) {
    if (child.type === "element") visit(child, node);
    walkElements(child, visit);
  }
}

/** Remove any `data-line` the author wrote in raw HTML, then add ours from mdast positions. */
function rehypeDataLines() {
  return (tree: HastRoot) => {
    walkElements(tree, (element) => {
      delete element.properties["dataLine"];
    });
    const mark = (element: Element) => {
      const line = element.position?.start.line;
      if (line !== undefined) element.properties["dataLine"] = line;
    };
    for (const child of tree.children) if (child.type === "element") mark(child);
    walkElements(tree, (element, parent) => {
      if (element.tagName === "li" || element.tagName === "tr") mark(element);
      else if (parent.type === "element" && parent.tagName === "blockquote") mark(element);
    });
  };
}

/** Send relative image sources through `resolveAsset`. Links are left as written. */
function rehypeResolveAssets() {
  return (tree: HastRoot, file: { data: FileData }) => {
    const context = file.data.context;
    if (!context) return;
    walkElements(tree, (element) => {
      if (element.tagName !== "img") return;
      const src = element.properties["src"];
      if (typeof src === "string" && isRelativePath(src)) {
        element.properties["src"] = context.resolveAsset(src);
      }
    });
  };
}

/**
 * The sanitiser prefixes ids (to stop DOM clobbering) but not the `#fragment` links that point
 * at them, which would break footnote links. Prefix those links, only where the target id exists
 * in this document, so other links stay as written.
 */
function rehypeFragmentLinks() {
  return (tree: HastRoot) => {
    const prefix = sanitiseSchema.clobberPrefix ?? "";
    const ids = new Set<string>();
    walkElements(tree, (element) => {
      const id = element.properties["id"];
      if (typeof id === "string") ids.add(id);
    });
    walkElements(tree, (element) => {
      const href = element.properties["href"];
      if (element.tagName === "a" && typeof href === "string" && href.startsWith("#")) {
        if (ids.has(href.slice(1))) element.properties["href"] = `#${prefix}${href.slice(1)}`;
      }
    });
  };
}

const NEWLINE_MARK = "dataLeadingNewline";

/**
 * `rehype-raw` re-parses the tree with an HTML parser, and HTML parsers drop one newline right
 * after `<pre>`, even when `<code>` sits in between. That would silently delete a leading blank
 * line from a fenced code block, so note which code blocks start with one and put it back.
 */
function rehypeNoteCodeNewline() {
  return (tree: HastRoot) => {
    walkElements(tree, (element) => {
      const first = element.children[0];
      if (element.tagName === "code" && first?.type === "text" && first.value.startsWith("\n")) {
        element.properties[NEWLINE_MARK] = true;
      }
    });
  };
}

function rehypeRestoreCodeNewline() {
  return (tree: HastRoot) => {
    walkElements(tree, (element) => {
      if (element.tagName !== "code" || element.properties[NEWLINE_MARK] === undefined) return;
      delete element.properties[NEWLINE_MARK];
      const first = element.children[0];
      if (first?.type === "text") first.value = `\n${first.value}`;
    });
  };
}

function build(options: PipelineOptions): Processor {
  const { frontmatter = true, gfm = true, dataLines = true, resolveAssets = true } = options;
  const sanitise = options.sanitise ?? true;
  // The builder chain changes the processor's type at every step; this is the one place that
  // needs it to stay loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified's chained generics cannot be reassigned conditionally
  const processor: any = unified().use(remarkParse);
  if (frontmatter) processor.use(remarkFrontmatter, ["yaml"]);
  if (gfm) processor.use(remarkGfm);
  processor.use(remarkRehype, {
    allowDangerousHtml: true,
    // The sanitiser adds the `user-content-` prefix to ids; `rehypeFragmentLinks` does the same
    // for links that point at them. Prefixing here as well would prefix ids twice.
    clobberPrefix: "",
    // Front matter is metadata, not body text.
    handlers: { yaml: () => undefined },
  });
  processor.use(rehypeNoteCodeNewline);
  processor.use(rehypeRaw);
  processor.use(rehypeRestoreCodeNewline);
  if (dataLines) processor.use(rehypeDataLines);
  if (resolveAssets) processor.use(rehypeResolveAssets);
  if (sanitise) processor.use(rehypeFragmentLinks);
  if (sanitise) processor.use(rehypeSanitize, sanitiseSchema);
  processor.use(rehypeStringify, { allowDangerousHtml: !sanitise });
  return processor as Processor;
}

export interface MarkdownProcessor {
  render(text: string, context: RenderContext): Promise<string>;
}

/**
 * Build a processor. Normal use goes through `renderMarkdown`, which builds one safe processor
 * and reuses it. Other option sets exist for the conformance tests.
 */
export function createMarkdownProcessor(options: PipelineOptions = {}): MarkdownProcessor {
  const processor = build(options).freeze();
  return {
    async render(text, context) {
      throwIfAborted(context.signal);
      const file = await processor.process({ value: text, data: { context } satisfies FileData });
      throwIfAborted(context.signal);
      return String(file);
    },
  };
}
