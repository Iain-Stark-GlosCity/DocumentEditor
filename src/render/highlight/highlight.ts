/**
 * Syntax highlighting for fenced code, with highlight.js grammars through lowlight.
 *
 * The output is plain hast: `<span class="hljs-keyword">` and friends, no inline styles. The
 * colours live in `preview.css` as CSS variables with a light and a dark palette, so switching
 * theme needs no re-render. The main sanitiser then allows exactly those class names.
 *
 * Blocks over `MAX_HIGHLIGHT_LENGTH` characters are left as plain text, so one huge paste
 * cannot stall a render, and a document as a whole has a budget too. An unknown language, or a
 * grammar that throws, leaves the block plain without a word.
 */
import type { Element, Root as HastRoot } from "hast";
import { toString } from "hast-util-to-string";
import { createLowlight } from "lowlight";
import { canonicalLanguage, loadLanguage } from "./languages";

/** A single block above this many characters is not highlighted. */
export const MAX_HIGHLIGHT_LENGTH = 100_000;
/** Across one document. */
export const MAX_TOTAL_LENGTH = 400_000;

const lowlight = createLowlight();

export interface Candidate {
  code: Element;
  language: string;
}

/** The language named by a `language-xxx` class, if there is one. */
export function fenceLanguage(code: Element): string | undefined {
  const classes = code.properties["className"];
  if (!Array.isArray(classes)) return undefined;
  for (const name of classes) {
    if (typeof name === "string" && name.startsWith("language-") && name.length > 9) {
      return name.slice(9);
    }
  }
  return undefined;
}

/** Highlights every candidate in place. Never throws. */
export async function highlightBlocks(candidates: readonly Candidate[]): Promise<void> {
  let budget = MAX_TOTAL_LENGTH;
  for (const { code, language } of candidates) {
    const canonical = canonicalLanguage(language);
    if (canonical === undefined) continue;
    const text = toString(code);
    if (text.length > MAX_HIGHLIGHT_LENGTH || text.length > budget) continue;
    try {
      if (!lowlight.registered(canonical)) {
        const grammar = await loadLanguage(canonical);
        if (!grammar) continue;
        lowlight.register(canonical, grammar);
      }
      const result = lowlight.highlight(canonical, text);
      code.children = result.children as Element["children"];
      const classes = code.properties["className"];
      code.properties["className"] = ["hljs", ...(Array.isArray(classes) ? classes : [])];
      budget -= text.length;
    } catch {
      // Plain text is always an acceptable fallback.
    }
  }
}

function collect(tree: HastRoot): Candidate[] {
  const found: Candidate[] = [];
  const visit = (node: HastRoot | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "pre") {
        const only = child.children.length === 1 ? child.children[0] : undefined;
        if (only?.type === "element" && only.tagName === "code") {
          const language = fenceLanguage(only);
          if (language !== undefined) found.push({ code: only, language });
        }
        continue;
      }
      visit(child);
    }
  };
  visit(tree);
  return found;
}

/** rehype plugin: highlight fenced code blocks that name a language. */
export function rehypeHighlight() {
  return async (tree: HastRoot): Promise<void> => {
    const candidates = collect(tree);
    if (candidates.length > 0) await highlightBlocks(candidates);
  };
}
