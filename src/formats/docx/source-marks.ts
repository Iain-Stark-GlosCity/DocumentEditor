/**
 * Source marks: how the generator learns which lines of the view came from which element.
 *
 * The view is built from many small strings (blocks) that are indented, joined and sometimes
 * dropped on the way. Rather than track line numbers through all of that, each block that has a
 * source is wrapped in a pair of invisible markers when it is made. `finish` reads the markers
 * from the final text, works out the lines they sit on, and removes them. A block that is dropped
 * or rewritten takes its markers with it, so it simply gets no entry.
 *
 * The markers are control characters that XML cannot contain, followed by a number.
 */
import type { SourceMapEntry } from "../../core/source-map";
import { locatorOf, siblingPosition, type XElement } from "./xml";

const START = "\u0001";
const END = "\u0003";
const STOP = "\u0002";
// Built from the characters rather than written as literals, which the linter rightly distrusts.
const MARK_RE = new RegExp(`([${START}${END}])(\\d+)${STOP}`, "g");
const ANY_MARK_RE = new RegExp(`[${START}${END}]\\d+${STOP}`, "g");

interface Mark {
  part: string;
  el: XElement;
  label: string | undefined;
  from: number;
  to: number;
}

/** Text with any markers taken out, for code that compares or measures rendered blocks. */
export function unmark(text: string): string {
  return text.includes(STOP) ? text.replace(ANY_MARK_RE, "") : text;
}

/** The element's position among same-named siblings (1-based), for labels. */
function positionOf(el: XElement): number {
  return el.parent ? siblingPosition(el.parent, el).index : 1;
}

/** "paragraph 12", "table 2", "table 2, row 3, cell 1, paragraph 1" and so on. */
export function labelOf(el: XElement): string {
  const word = (e: XElement) =>
    e.name === "w:p"
      ? "paragraph"
      : e.name === "w:tbl"
        ? "table"
        : e.name === "w:tr"
          ? "row"
          : "cell";
  if (el.name === "w:p" || el.name === "w:tbl") {
    const chain: string[] = [`${word(el)} ${positionOf(el)}`];
    for (let cur = el.parent; cur; cur = cur.parent) {
      if (cur.name === "w:tc" || cur.name === "w:tr" || cur.name === "w:tbl")
        chain.push(`${word(cur)} ${positionOf(cur)}`);
      else if (cur.name === "w:body") break;
    }
    return chain.reverse().join(", ");
  }
  return el.name.replace(/^w:/, "");
}

export class SourceMarks {
  private readonly marks: Mark[] = [];

  /** Wraps `text` so the finished view can say which element its lines came from. */
  wrap(part: string, el: XElement, text: string, label?: string): string {
    const id = this.marks.length;
    this.marks.push({ part, el, label, from: 0, to: 0 });
    return `${START}${id}${STOP}${text}${END}${id}${STOP}`;
  }

  /** The text without markers, and the entries for the blocks that are still in it. */
  finish(text: string): { text: string; sourceMap: SourceMapEntry[] } {
    const pieces: string[] = [];
    const order: number[] = [];
    const closed = new Set<number>();
    let line = 1;
    let last = 0;
    MARK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARK_RE.exec(text))) {
      const id = Number(m[2]);
      const mark = this.marks[id];
      if (!mark) continue;
      const piece = text.slice(last, m.index);
      pieces.push(piece);
      for (let i = piece.indexOf("\n"); i >= 0; i = piece.indexOf("\n", i + 1)) line++;
      last = m.index + m[0].length;
      if (m[1] === START) {
        mark.from = line;
        order.push(id);
      } else {
        mark.to = line;
        closed.add(id);
      }
    }
    pieces.push(text.slice(last));
    const sourceMap: SourceMapEntry[] = [];
    // Outermost first: an outer block's start marker comes before its inner blocks'.
    for (const id of order) {
      if (!closed.has(id)) continue;
      const mark = this.marks[id]!;
      sourceMap.push({
        fromLine: mark.from,
        toLine: Math.max(mark.from, mark.to),
        part: mark.part,
        locator: locatorOf(mark.el),
        label: mark.label ?? labelOf(mark.el),
      });
    }
    return { text: pieces.join(""), sourceMap };
  }
}
