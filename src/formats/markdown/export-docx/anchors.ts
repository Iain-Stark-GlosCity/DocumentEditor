/**
 * Bookmarks on headings, so that `[see](#results)` links work in Word. Headings get the same slugs
 * as in the preview (`rehypeHeadingIds`: GitHub's rule, repeats numbered `-1`, `-2`), worked out
 * from the same text the preview sees, including a footnote's number in a heading.
 */
import GithubSlugger from "github-slugger";
import type { Heading, Nodes, Root } from "mdast";
import type { Env } from "./env";

/** Word keeps bookmark names of at most 40 characters that start with a letter. */
const WORD_BOOKMARK = /^\p{L}[\p{L}\p{N}_-]{0,39}$/u;

/** The text the preview's slug is made from: like `hast-util-to-string` on the rendered heading. */
function headingText(heading: Heading, footnoteNumbers: ReadonlyMap<string, number>): string {
  let out = "";
  const stack: Nodes[] = [heading];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "footnoteReference") {
      out += String(footnoteNumbers.get(node.identifier) ?? "");
    } else if (node.type === "break") {
      out += "\n";
    } else if (node.type === "html" || node.type === "image" || node.type === "imageReference") {
      // Tags and pictures have no text; text between tags is in text nodes of its own.
    } else if ("value" in node && typeof node.value === "string") {
      out += node.value;
    } else if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
  }
  return out.trim();
}

/** Every node of the body in document order, without footnote definitions. */
function* bodyNodes(tree: Root): Generator<Nodes> {
  const stack: Nodes[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "footnoteDefinition") continue;
    yield node;
    if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
  }
}

/** Fills `env.anchors` and `env.headingBookmarks`. Needs `env.footnoteDefinitions`. */
export function assignHeadingAnchors(tree: Root, env: Env): void {
  const footnoteNumbers = new Map<string, number>();
  const headings: Heading[] = [];
  for (const node of bodyNodes(tree)) {
    if (node.type === "heading") headings.push(node);
    else if (
      node.type === "footnoteReference" &&
      env.footnoteDefinitions.has(node.identifier) &&
      !footnoteNumbers.has(node.identifier)
    ) {
      footnoteNumbers.set(node.identifier, footnoteNumbers.size + 1);
    }
  }
  const slugger = new GithubSlugger();
  const names = new Set<string>();
  let generated = 0;
  for (const heading of headings) {
    const text = headingText(heading, footnoteNumbers);
    if (text === "") continue;
    const slug = slugger.slug(text);
    if (slug === "") continue;
    let name = slug;
    // Word drops bookmarks it cannot name; those get a hidden (underscore) name of their own.
    if (!WORD_BOOKMARK.test(name) || names.has(name.toLowerCase())) {
      do {
        generated += 1;
        name = `_Heading_${generated}`;
      } while (names.has(name.toLowerCase()));
    }
    names.add(name.toLowerCase());
    env.anchors.set(slug, name);
    env.headingBookmarks.set(heading, name);
  }
}
