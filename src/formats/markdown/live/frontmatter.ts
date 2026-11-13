import type { Text } from "@codemirror/state";

/** Front matter longer than this many lines is not looked for (keeps the check cheap). */
const MAX_LINES = 2000;

const cache = new WeakMap<Text, number>();

/**
 * End offset (end of the closing `---` or `...` line) of a YAML front matter block at the very
 * start of the document, or 0 if there is none. The Lezer Markdown grammar does not know front
 * matter (it reads it as a rule and a setext heading), so it is detected here, by text.
 */
export function frontMatterEnd(doc: Text): number {
  const cached = cache.get(doc);
  if (cached !== undefined) return cached;
  let end = 0;
  if (doc.lines > 1 && /^---[ \t]*$/.test(doc.line(1).text)) {
    const last = Math.min(doc.lines, MAX_LINES);
    for (let n = 2; n <= last; n++) {
      const line = doc.line(n);
      if (/^(---|\.\.\.)[ \t]*$/.test(line.text)) {
        end = line.to;
        break;
      }
    }
  }
  cache.set(doc, end);
  return end;
}
