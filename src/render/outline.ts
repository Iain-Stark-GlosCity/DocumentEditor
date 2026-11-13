import type { Nodes, PhrasingContent, Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { OutlineItem } from "../core/format";

const parser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).freeze();

/** Plain text of inline content: formatting stripped, images by alt text, raw HTML dropped. */
function plainText(node: Nodes | PhrasingContent): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "image":
      return node.alt ?? "";
    case "break":
      return " ";
    case "html":
      return "";
    default:
      return "children" in node ? node.children.map(plainText).join("") : "";
  }
}

function collect(node: Nodes, items: OutlineItem[]): void {
  if (node.type === "heading") {
    const start = node.position?.start;
    if (start?.offset !== undefined) {
      items.push({
        level: node.depth,
        text: plainText(node).replace(/\s+/g, " ").trim(),
        line: start.line,
        from: start.offset,
      });
    }
    return;
  }
  if ("children" in node) for (const child of node.children) collect(child, items);
}

/** Headings (ATX and setext) in document order. Code blocks and front matter are not headings. */
export function outlineMarkdown(text: string): OutlineItem[] {
  const tree: Root = parser.parse(text);
  const items: OutlineItem[] = [];
  collect(tree, items);
  return items;
}
