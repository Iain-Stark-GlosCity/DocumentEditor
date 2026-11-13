/**
 * Small rehype steps that add to the tree before it is sanitised: heading ids, task-list classes
 * and Mermaid placeholders. All pure, none touch the DOM.
 */
import type { Element, Nodes, Root as HastRoot } from "hast";
import GithubSlugger from "github-slugger";
import { toString } from "hast-util-to-string";

/** Class of the placeholder the preview turns into a diagram. The sanitiser allows only this. */
export const MERMAID_CLASS = "mermaid-source";

function walk(node: Nodes, visit: (element: Element, parent: Element | HastRoot) => void): void {
  if (!("children" in node)) return;
  for (const child of node.children) {
    if (child.type === "element") visit(child, node as Element | HastRoot);
    walk(child, visit);
  }
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Gives headings GitHub-style ids: lower case, punctuation removed, spaces to hyphens, repeats
 * numbered `-1`, `-2`. A heading that already has an id (footnotes' label) keeps it. The
 * sanitiser adds its `user-content-` prefix afterwards, and `rehypeFragmentLinks` prefixes the
 * links that point here to match.
 */
export function rehypeHeadingIds() {
  return (tree: HastRoot) => {
    const slugger = new GithubSlugger();
    const taken = new Set<string>();
    walk(tree, (element) => {
      const id = element.properties["id"];
      if (typeof id === "string") taken.add(id);
    });
    walk(tree, (element) => {
      if (!HEADINGS.has(element.tagName) || element.properties["id"] !== undefined) return;
      const text = toString(element).trim();
      if (text === "") return;
      let slug = slugger.slug(text);
      // An id written elsewhere in raw HTML wins; ours moves on to the next number.
      while (slug !== "" && taken.has(slug)) slug = slugger.slug(text);
      if (slug === "") return;
      taken.add(slug);
      element.properties["id"] = slug;
    });
  };
}

/**
 * Task lists: `remark-rehype` already adds `task-list-item` and `contains-task-list`, the same
 * as github.com. This adds GitHub's `task-list-item-checkbox` on the checkbox, or, with `keep`
 * false, strips all three (the spec examples show none of them).
 */
export function rehypeTaskListClasses(options: { keep: boolean }) {
  const classes = new Set(["task-list-item", "contains-task-list", "task-list-item-checkbox"]);
  return (tree: HastRoot) => {
    walk(tree, (element) => {
      const current = element.properties["className"];
      const names = Array.isArray(current) ? current.map(String) : [];
      if (options.keep) {
        if (element.tagName === "input" && element.properties["type"] === "checkbox") {
          if (!names.includes("task-list-item-checkbox")) {
            element.properties["className"] = [...names, "task-list-item-checkbox"];
          }
        }
        return;
      }
      if (!names.some((name) => classes.has(name))) return;
      const rest = names.filter((name) => !classes.has(name));
      if (rest.length > 0) element.properties["className"] = rest;
      else delete element.properties["className"];
    });
  };
}

/**
 * Replaces ```` ```mermaid ```` blocks with `<pre class="mermaid-source" data-line="n">`
 * holding the source as text (escaped when stringified). The preview renders the diagram on the
 * main thread, because Mermaid needs the DOM. Until then, and with Mermaid switched off in the
 * preview, the reader sees the source.
 */
export function rehypeMermaidPlaceholders() {
  return (tree: HastRoot) => {
    walk(tree, (element, parent) => {
      if (element.tagName !== "pre") return;
      const only = element.children.length === 1 ? element.children[0] : undefined;
      if (only?.type !== "element" || only.tagName !== "code") return;
      const classes = only.properties["className"];
      if (!Array.isArray(classes) || !classes.includes("language-mermaid")) return;
      const index = parent.children.indexOf(element);
      const placeholder: Element = {
        type: "element",
        tagName: "pre",
        properties: { className: [MERMAID_CLASS] },
        children: [{ type: "text", value: toString(only) }],
        ...(element.position ? { position: element.position } : {}),
      };
      const line = element.properties["dataLine"];
      if (line !== undefined) placeholder.properties["dataLine"] = line;
      parent.children[index] = placeholder;
    });
  };
}
