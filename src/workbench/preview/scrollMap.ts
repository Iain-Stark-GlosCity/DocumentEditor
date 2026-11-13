/**
 * Maps a position in the source to a position in the preview and back. Pure maths, no DOM.
 *
 * The preview reports an anchor for each element that carries `data-line`: the source line the
 * element starts on, and its pixel offset from the top of the preview content. Between two
 * anchors the mapping is linear, so a tall block (a long code fence, a big table) is traversed
 * in proportion to its source lines rather than jumping. Lines are fractional: `12.5` is half
 * way between the start of line 12 and the start of line 13.
 */

export interface Anchor {
  /** 1-based source line the block starts on. */
  line: number;
  /** Pixels from the top of the preview content to the top of the block. */
  offset: number;
}

export interface ScrollMap {
  /** Strictly increasing in `line`, non-decreasing in `offset`. Always starts at line 1. */
  readonly anchors: readonly Anchor[];
}

/**
 * Builds a map from the anchors found in the preview, in document order.
 *
 * `totalLines` is the number of lines in the source; `contentHeight` the full height of the
 * preview content. Anchors that go backwards (raw HTML can produce odd orders) or repeat a line
 * are dropped, so the result can be searched. An empty document maps everything to the top.
 */
export function buildScrollMap(
  anchors: readonly Anchor[],
  totalLines: number,
  contentHeight: number,
): ScrollMap {
  const out: Anchor[] = [];
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.line) || !Number.isFinite(anchor.offset)) continue;
    const last = out[out.length - 1];
    if (last && anchor.line <= last.line) continue;
    out.push({ line: anchor.line, offset: Math.max(anchor.offset, last?.offset ?? 0) });
  }
  if (out.length === 0) return { anchors: [] };

  // Lines before the first block (front matter, blank lines) map onto the space above it.
  const first = out[0];
  if (first && first.line > 1) out.unshift({ line: 1, offset: 0 });

  // Lines after the last block map onto the space below its start, up to the end of the content.
  const last = out[out.length - 1];
  const endLine = Math.max(totalLines + 1, (last?.line ?? 1) + 1);
  if (last && contentHeight > last.offset) out.push({ line: endLine, offset: contentHeight });
  return { anchors: out };
}

/** Index of the last anchor for which `value(anchor) <= target`, or -1 if there is none. */
function lastAtOrBefore(
  anchors: readonly Anchor[],
  target: number,
  key: "line" | "offset",
): number {
  let low = 0;
  let high = anchors.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const anchor = anchors[mid];
    if (anchor && anchor[key] <= target) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Pixel offset in the preview for a (fractional, 1-based) source line. */
export function lineToOffset(map: ScrollMap, line: number): number {
  const { anchors } = map;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) return 0;
  if (line <= first.line) return first.offset;
  if (line >= last.line) return last.offset;
  const at = lastAtOrBefore(anchors, line, "line");
  const from = anchors[at];
  const to = anchors[at + 1];
  if (!from || !to) return last.offset;
  return from.offset + ((line - from.line) / (to.line - from.line)) * (to.offset - from.offset);
}

/** Fractional, 1-based source line for a pixel offset in the preview. */
export function offsetToLine(map: ScrollMap, offset: number): number {
  const { anchors } = map;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) return 1;
  if (offset <= first.offset) return first.line;
  if (offset >= last.offset) return last.line;
  // The rightmost anchor at or before `offset` has a strictly larger offset after it, so a block
  // of zero height (hidden, or collapsed by CSS) is skipped without dividing by zero.
  const at = lastAtOrBefore(anchors, offset, "offset");
  const from = anchors[at];
  const to = anchors[at + 1];
  if (!from || !to) return last.line;
  return from.line + ((offset - from.offset) / (to.offset - from.offset)) * (to.line - from.line);
}
