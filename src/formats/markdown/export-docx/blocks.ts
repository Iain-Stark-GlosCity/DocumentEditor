/**
 * Markdown blocks (mdast flow content) to Word paragraphs and tables. The tree is walked with an
 * explicit stack, never recursion, so a document of any length or nesting depth converts in time
 * roughly linear in its size. Anything not understood becomes its text.
 */
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import type { Heading, List, Nodes, PhrasingContent, Table as MdTable } from "mdast";
import type { Env } from "./env";
import { htmlToParagraphs } from "./html-text";
import { CHECKBOX, inlineRuns, type InlineState, type Marks } from "./inline";
import { itemIndent, MAX_INDENT, MAX_LEVEL, numberingConfig } from "./lists";
import { plainText } from "./parse";
import { STYLE, TEXT_WIDTH } from "./styles";
import { runSafe } from "./xml-text";

/** Where a block sits: inside quotes, lists or a footnote. */
interface Context {
  /** Left indent of the block's content, in twips. */
  indent: number;
  quoteDepth: number;
  /** Depth of the innermost list (0 is a top-level list), or -1 outside lists. */
  listLevel: number;
  /** In a loose list: paragraphs keep their space after. */
  loose: boolean;
  footnote: boolean;
}

/** The list number a paragraph carries: only the first paragraph of each list item has one. */
interface ItemMark {
  reference: string;
  level: number;
  checked: boolean | null;
}

type Work = { node: Nodes; context: Context; item?: ItemMark };

export type Block = Paragraph | Table;

const ROOT_CONTEXT: Context = {
  indent: 0,
  quoteDepth: 0,
  listLevel: -1,
  loose: false,
  footnote: false,
};

/** Left indent a paragraph style gives by itself, so direct indents are added only when needed. */
const STYLE_INDENT: Record<string, number> = { [STYLE.quote]: 720, [STYLE.listParagraph]: 720 };

function paragraphStyle(context: Context): string | undefined {
  if (context.quoteDepth > 0) return STYLE.quote;
  if (context.listLevel >= 0) return STYLE.listParagraph;
  if (context.footnote) return STYLE.footnoteText;
  return undefined;
}

type MutableParagraphOptions = { -readonly [K in keyof IParagraphOptions]: IParagraphOptions[K] };

/** Paragraph options for ordinary text in a context, with the item's number if it has one. */
function paragraphOptions(
  context: Context,
  item: ItemMark | undefined,
  style = paragraphStyle(context),
): MutableParagraphOptions {
  const options: MutableParagraphOptions = {};
  if (style !== undefined) options.style = style;
  if (item !== undefined) {
    options.numbering = { reference: item.reference, level: item.level };
  } else if (context.indent !== (style === undefined ? 0 : (STYLE_INDENT[style] ?? 0))) {
    options.indent = { left: context.indent };
  }
  if (context.listLevel >= 0 && context.loose) options.contextualSpacing = false;
  return options;
}

const CELL_SHADING = { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" } as const;

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

/** Column widths that fill `width`, weighted by how much text each column holds. */
export function columnWidths(table: MdTable, columns: number, width: number): number[] {
  const weights = new Array<number>(columns).fill(4);
  for (const row of table.children) {
    row.children.slice(0, columns).forEach((cell, i) => {
      const length = Math.min(60, Math.max(4, plainText(cell).trim().length));
      weights[i] = Math.max(weights[i]!, length);
    });
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(1, Math.floor((width * w) / total)));
  widths[widths.length - 1]! += width - widths.reduce((a, b) => a + b, 0);
  return widths;
}

export class BlockConverter {
  readonly inline: InlineState = { pictures: { n: 0 } };

  constructor(private readonly env: Env) {}

  /** Converts the body of a document. Footnotes referred to are collected in the environment. */
  body(children: readonly Nodes[]): Block[] {
    return this.run(children, ROOT_CONTEXT);
  }

  /** Converts the content of a footnote to paragraphs (tables become text, one row per line). */
  footnote(children: readonly Nodes[]): Paragraph[] {
    const blocks = this.run(children, { ...ROOT_CONTEXT, footnote: true });
    const paragraphs = blocks.filter((b): b is Paragraph => b instanceof Paragraph);
    return paragraphs.length > 0 ? paragraphs : [new Paragraph({ style: STYLE.footnoteText })];
  }

  private run(children: readonly Nodes[], context: Context): Block[] {
    const out: Block[] = [];
    const stack: Work[] = [];
    const push = (nodes: readonly Nodes[], ctx: Context) => {
      for (let i = nodes.length - 1; i >= 0; i -= 1) stack.push({ node: nodes[i]!, context: ctx });
    };
    push(children, context);
    while (stack.length > 0) {
      const { node, context: ctx, item } = stack.pop()!;
      this.block(node, ctx, item, out, stack, push);
    }
    // Two tables in a row would join into one in Word; keep them apart with an empty paragraph.
    const spaced: Block[] = [];
    for (const block of out) {
      if (block instanceof Table && spaced[spaced.length - 1] instanceof Table) {
        spaced.push(new Paragraph({}));
      }
      spaced.push(block);
    }
    return spaced;
  }

  private block(
    node: Nodes,
    ctx: Context,
    item: ItemMark | undefined,
    out: Block[],
    stack: Work[],
    push: (nodes: readonly Nodes[], ctx: Context) => void,
  ): void {
    switch (node.type) {
      case "paragraph":
        out.push(this.paragraph(node.children, ctx, item));
        return;
      case "heading":
        out.push(this.heading(node, ctx, item));
        return;
      case "blockquote":
        push(node.children, {
          ...ctx,
          indent: Math.min(ctx.indent + 720, MAX_INDENT),
          quoteDepth: ctx.quoteDepth + 1,
        });
        return;
      case "list":
        this.list(node, ctx, stack);
        return;
      case "listItem":
        // Only reached for an item outside a list, which the parser never makes.
        push(node.children, ctx);
        return;
      case "code":
        // The language label is dropped. Mermaid diagrams stay as their source (known limitation).
        out.push(this.code(node.value, ctx, item));
        return;
      case "math":
        // Known limitation: display maths stays as its TeX source in a code block.
        out.push(this.code(node.value, ctx, item));
        return;
      case "table":
        if (ctx.footnote) this.tableAsText(node, ctx, out);
        else out.push(this.table(node, ctx));
        return;
      case "thematicBreak":
        out.push(
          new Paragraph({
            ...paragraphOptions(ctx, item),
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } },
          }),
        );
        return;
      case "html": {
        const paragraphs = htmlToParagraphs(node.value);
        paragraphs.forEach((pieces, i) => {
          const children: ParagraphChild[] = [];
          for (const piece of pieces) {
            const text = piece.kind === "text" ? runSafe(piece.text) : "";
            if (piece.kind === "break") children.push(new TextRun({ break: 1 }));
            else if (text !== "") children.push(new TextRun(text));
          }
          out.push(
            new Paragraph({ ...paragraphOptions(ctx, i === 0 ? item : undefined), children }),
          );
        });
        if (paragraphs.length === 0 && item !== undefined) out.push(this.paragraph([], ctx, item));
        return;
      }
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        // Metadata: definitions are used where they are referred to, front matter is properties.
        if (item !== undefined) out.push(this.paragraph([], ctx, item));
        return;
      default: {
        const text = plainText(node, { imageAlt: true });
        if (text.trim() !== "" || item !== undefined) {
          out.push(this.paragraph(text === "" ? [] : [{ type: "text", value: text }], ctx, item));
        }
      }
    }
  }

  private paragraph(
    children: readonly PhrasingContent[],
    ctx: Context,
    item?: ItemMark,
  ): Paragraph {
    const prefix =
      item?.checked === undefined || item.checked === null
        ? undefined
        : { text: item.checked ? CHECKBOX.checked : CHECKBOX.unchecked, font: CHECKBOX.font };
    const runs = inlineRuns(children, this.env, this.inline, {
      inFootnote: ctx.footnote,
      ...(prefix ? { prefix } : {}),
    });
    return new Paragraph({ ...paragraphOptions(ctx, item), children: runs });
  }

  private heading(node: Heading, ctx: Context, item?: ItemMark): Paragraph {
    const bookmark = this.env.headingBookmarks.get(node);
    const mark = (runs: ParagraphChild[]) =>
      bookmark === undefined ? runs : [new Bookmark({ id: bookmark, children: runs })];
    if (ctx.footnote || item !== undefined) {
      // A heading inside a footnote or as a list item stays in its place, in bold.
      const marks: Marks = { bold: true };
      const runs = inlineRuns(node.children, this.env, this.inline, {
        inFootnote: ctx.footnote,
        marks,
      });
      return new Paragraph({ ...paragraphOptions(ctx, item), children: mark(runs) });
    }
    const level = Math.min(6, Math.max(1, node.depth));
    const runs = inlineRuns(node.children, this.env, this.inline);
    const options: MutableParagraphOptions = { style: STYLE.heading(level), children: mark(runs) };
    if (ctx.indent > 0) options.indent = { left: ctx.indent };
    return new Paragraph(options);
  }

  private list(node: List, ctx: Context, stack: Work[]): void {
    const level = Math.min(MAX_LEVEL, ctx.listLevel + 1);
    const reference = `list-${this.env.lists.length + 1}`;
    this.env.lists.push(
      numberingConfig(reference, {
        ordered: node.ordered === true,
        start: node.start ?? 1,
        level,
        base: ctx.indent,
      }),
    );
    const loose = node.spread === true || node.children.some((child) => child.spread === true);
    const childContext: Context = {
      ...ctx,
      indent: itemIndent(ctx.indent),
      listLevel: level,
      loose,
    };
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const listItem = node.children[i]!;
      const mark: ItemMark = {
        reference,
        level,
        checked: typeof listItem.checked === "boolean" ? listItem.checked : null,
      };
      const [first, ...rest] = listItem.children;
      for (let j = rest.length - 1; j >= 0; j -= 1)
        stack.push({ node: rest[j]!, context: childContext });
      if (first === undefined) {
        stack.push({
          node: { type: "paragraph", children: [] },
          context: childContext,
          item: mark,
        });
      } else if (first.type === "paragraph" || first.type === "heading" || first.type === "html") {
        stack.push({ node: first, context: childContext, item: mark });
      } else {
        // An item that starts with a code block, a quote or a list: its number goes on an empty
        // paragraph of its own.
        stack.push({ node: first, context: childContext });
        stack.push({
          node: { type: "paragraph", children: [] },
          context: childContext,
          item: mark,
        });
      }
    }
  }

  private code(value: string, ctx: Context, item?: ItemMark): Paragraph {
    const children: TextRun[] = [];
    value.split("\n").forEach((line, i) => {
      const parts: (string | Tab)[] = [];
      runSafe(line)
        .split("\t")
        .forEach((part, j) => {
          if (j > 0) parts.push(new Tab());
          if (part !== "") parts.push(part);
        });
      if (i > 0) children.push(new TextRun({ break: 1, children: parts }));
      else if (parts.length > 0) children.push(new TextRun({ children: parts }));
    });
    const options = paragraphOptions(ctx, item, STYLE.sourceCode);
    delete options.contextualSpacing;
    return new Paragraph({ ...options, children });
  }

  private table(node: MdTable, ctx: Context): Table {
    const columns = Math.max(1, node.align?.length ?? 0, node.children[0]?.children.length ?? 0);
    const width = TEXT_WIDTH - ctx.indent;
    const widths = columnWidths(node, columns, width);
    const rows = node.children.map((row, r) => {
      const header = r === 0;
      const cells: TableCell[] = [];
      for (let c = 0; c < columns; c += 1) {
        const cell = row.children[c];
        const align = node.align?.[c];
        const runs = cell
          ? inlineRuns(
              cell.children,
              this.env,
              this.inline,
              header ? { marks: { bold: true } } : {},
            )
          : [];
        const paragraph = new Paragraph({
          children: runs,
          ...(align ? { alignment: ALIGN[align] } : {}),
        });
        cells.push(
          new TableCell({
            width: { size: widths[c]!, type: WidthType.DXA },
            children: [paragraph],
            ...(header ? { shading: CELL_SHADING } : {}),
          }),
        );
      }
      return new TableRow({ children: cells, ...(header ? { tableHeader: true } : {}) });
    });
    return new Table({
      style: STYLE.tableGrid,
      rows,
      columnWidths: widths,
      // `docx` multiplies a percentage by 50 itself: 100 is written as 5000 fiftieths, the whole width.
      width:
        ctx.indent > 0
          ? { size: width, type: WidthType.DXA }
          : { size: 100, type: WidthType.PERCENTAGE },
      ...(ctx.indent > 0 ? { indent: { size: ctx.indent, type: WidthType.DXA } } : {}),
    });
  }

  private tableAsText(node: MdTable, ctx: Context, out: Block[]): void {
    for (const row of node.children) {
      const children: PhrasingContent[] = [];
      row.children.forEach((cell, i) => {
        if (i > 0) children.push({ type: "text", value: " | " });
        children.push(...cell.children);
      });
      out.push(this.paragraph(children, ctx));
    }
  }
}
