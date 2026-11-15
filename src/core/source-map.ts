/**
 * A source map ties lines of a generated view back to the place they came from: the part of the
 * container and the element inside it. It is what lets "Reveal in XML" jump from a paragraph in a
 * DOCX Formatting view to that paragraph's XML.
 */

export interface SourceMapEntry {
  /** First and last line (1-based, inclusive) of the view that this entry covers. */
  fromLine: number;
  toLine: number;
  /** The part's name inside the archive, for example `word/document.xml`. */
  part: string;
  /** An element path inside the part, read by the part's format (see `TextFormatProvider.locate`). */
  locator: string;
  /** A short human label, for example "paragraph 12" or "table 2, row 3". */
  label?: string;
}

/**
 * The entry that covers `line`; when entries nest (a table around its paragraphs) the narrowest
 * one wins, and the earliest of equals.
 */
export function sourceFor(
  map: readonly SourceMapEntry[] | undefined,
  line: number,
): SourceMapEntry | undefined {
  if (!map) return undefined;
  let best: SourceMapEntry | undefined;
  for (const entry of map) {
    if (line < entry.fromLine || line > entry.toLine) continue;
    if (!best || entry.toLine - entry.fromLine < best.toLine - best.fromLine) best = entry;
  }
  return best;
}
