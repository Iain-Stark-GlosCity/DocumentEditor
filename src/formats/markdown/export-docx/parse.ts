/**
 * Markdown to mdast, read exactly as the preview reads it (`src/render/pipeline.ts`): CommonMark,
 * YAML front matter, GFM (tables, task lists, strikethrough, autolinks, footnotes) and `$`/`$$`
 * maths with the same single-dollar rules. Only the parse is shared; nothing here renders HTML.
 */
import type { Nodes, Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkDollarMath } from "../../../render/math/dollar";

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false })
  .use(remarkDollarMath)
  .freeze();

export function parseMarkdown(text: string): Root {
  return processor.runSync(processor.parse(text)) as Root;
}

/**
 * The plain text of a node, without recursion (a pathological document can nest deeply). Images
 * give nothing unless `imageAlt` is set; breaks give a space.
 */
export function plainText(node: Nodes, options: { imageAlt?: boolean } = {}): string {
  let out = "";
  const stack: Nodes[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === "image") {
      if (options.imageAlt) out += current.alt ?? "";
      continue;
    }
    if (current.type === "imageReference") {
      if (options.imageAlt) out += current.alt ?? "";
      continue;
    }
    if (current.type === "break") {
      out += " ";
      continue;
    }
    if ("value" in current && typeof current.value === "string") {
      if (current.type !== "html" && current.type !== "yaml") out += current.value;
      continue;
    }
    if ("children" in current) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) stack.push(current.children[i]!);
    }
  }
  return out;
}
