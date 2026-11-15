/**
 * Surgical text edits for repairs. A repair never re-serialises a part: it lists the exact ranges
 * of the original text to replace, and everything else (namespaces, attribute order, whitespace,
 * line endings) stays exactly as it was. Ranges come from the parsed elements' source offsets.
 */
import type { XDocument, XElement } from "../xml";

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Applies non-overlapping edits to `text`. Throws if two edits overlap or one is out of range. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let out = "";
  let at = 0;
  for (const edit of sorted) {
    if (edit.from < at) throw new Error("Two repair edits overlap");
    if (edit.from < 0 || edit.to < edit.from || edit.to > text.length) {
      throw new Error("A repair edit is outside the text");
    }
    out += text.slice(at, edit.from) + edit.insert;
    at = edit.to;
  }
  return out + text.slice(at);
}

/**
 * The range of an element's content, between its start tag and its end tag, or null for a
 * self-closing element (which has none). `source` is the text the element was parsed from.
 */
export function innerRange(source: string, el: XElement): { from: number; to: number } | null {
  const open = source.indexOf(">", el.start);
  if (open < 0 || open >= el.end) return null;
  if (source.charAt(open - 1) === "/") return null;
  const close = source.lastIndexOf("</", el.end - 1);
  if (close < open + 1) return null;
  return { from: open + 1, to: close };
}

/** Collects the edits of one part and applies them together. */
export class PartEditor {
  private readonly edits: TextEdit[] = [];

  constructor(
    readonly part: string,
    readonly doc: XDocument,
  ) {}

  get source(): string {
    return this.doc.source;
  }

  /** Replaces a whole element (start tag to end tag) with `insert`. */
  replace(el: XElement, insert: string): void {
    this.edits.push({ from: el.start, to: el.end, insert });
  }

  /** Removes a whole element. */
  remove(el: XElement): void {
    this.replace(el, "");
  }

  /** Replaces an element's content, keeping its tags. Does nothing for a self-closing element. */
  setInner(el: XElement, insert: string): void {
    const range = innerRange(this.source, el);
    if (range) this.edits.push({ from: range.from, to: range.to, insert });
  }

  /** Replaces a range of the text. */
  splice(from: number, to: number, insert: string): void {
    this.edits.push({ from, to, insert });
  }

  get count(): number {
    return this.edits.length;
  }

  /** The new text of the part. */
  result(): string {
    return applyEdits(this.source, this.edits);
  }
}
