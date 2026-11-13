/**
 * Updates the preview in place by replacing only the top-level blocks that changed.
 *
 * Replacing the whole content on every keystroke would reset scrolling, reload images and drop
 * any text the reader has selected. Instead the new top-level nodes are compared with the live
 * ones from both ends, and only the differing range in the middle is swapped. Everything else
 * keeps its DOM node.
 *
 * `data-line` is ignored when comparing, because inserting a line near the top shifts the line
 * number of every block below it without changing what they look like. Matched blocks get their
 * `data-line` values refreshed in place.
 */

const LINE_ATTRIBUTE = "data-line";

/** Structural equality of two nodes, not counting `data-line` anywhere in the subtree. */
export function sameIgnoringLines(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType === Node.TEXT_NODE || a.nodeType === Node.COMMENT_NODE) {
    return a.nodeValue === b.nodeValue;
  }
  if (a.nodeType === Node.ELEMENT_NODE) {
    const x = a as Element;
    const y = b as Element;
    let compared = 0;
    for (const attribute of Array.from(x.attributes)) {
      if (attribute.name === LINE_ATTRIBUTE) continue;
      if (y.getAttribute(attribute.name) !== attribute.value) return false;
      compared++;
    }
    const other = y.attributes.length - (y.hasAttribute(LINE_ATTRIBUTE) ? 1 : 0);
    if (compared !== other) return false;
  }
  if (a.childNodes.length !== b.childNodes.length) return false;
  for (let i = 0; i < a.childNodes.length; i++) {
    const left = a.childNodes[i];
    const right = b.childNodes[i];
    if (!left || !right || !sameIgnoringLines(left, right)) return false;
  }
  return true;
}

/** Copies `data-line` from `source` onto `target`, throughout two subtrees known to match. */
function copyLines(target: Node, source: Node): void {
  if (target.nodeType !== Node.ELEMENT_NODE) return;
  const to = target as Element;
  const from = source as Element;
  const line = from.getAttribute(LINE_ATTRIBUTE);
  if (line === null) to.removeAttribute(LINE_ATTRIBUTE);
  else if (to.getAttribute(LINE_ATTRIBUTE) !== line) to.setAttribute(LINE_ATTRIBUTE, line);
  for (let i = 0; i < to.childNodes.length; i++) {
    const child = to.childNodes[i];
    const sourceChild = from.childNodes[i];
    if (child && sourceChild) copyLines(child, sourceChild);
  }
}

export interface BlockUpdate {
  /** Blocks kept as they were. */
  kept: number;
  removed: number;
  inserted: number;
}

/** Whitespace between blocks carries no meaning at the top level and only gets in the way. */
function withoutBlankText<T extends Node>(nodes: readonly T[]): T[] {
  return nodes.filter((n) => n.nodeType !== Node.TEXT_NODE || (n.nodeValue ?? "").trim() !== "");
}

/**
 * Makes the children of `container` match the children of `next`. `next` is emptied: its nodes
 * are moved into `container` where they are needed. Only ever pass sanitised pipeline output.
 */
export function updateBlocks(container: HTMLElement, next: ParentNode): BlockUpdate {
  const current = withoutBlankText(Array.from(container.childNodes));
  const incoming = withoutBlankText(Array.from(next.childNodes));
  // Stray whitespace from an earlier render is dropped, so `current` is exactly the block list.
  for (const node of Array.from(container.childNodes)) {
    if (!current.includes(node)) node.remove();
  }

  let start = 0;
  const shortest = Math.min(current.length, incoming.length);
  while (start < shortest) {
    const old = current[start];
    const fresh = incoming[start];
    if (!old || !fresh || !sameIgnoringLines(old, fresh)) break;
    copyLines(old, fresh);
    start++;
  }

  let endCurrent = current.length;
  let endIncoming = incoming.length;
  while (endCurrent > start && endIncoming > start) {
    const old = current[endCurrent - 1];
    const fresh = incoming[endIncoming - 1];
    if (!old || !fresh || !sameIgnoringLines(old, fresh)) break;
    copyLines(old, fresh);
    endCurrent--;
    endIncoming--;
  }

  // The first kept block after the changed range, or null to append.
  const anchor = current[endCurrent] ?? null;
  for (let i = start; i < endCurrent; i++) current[i]?.remove();
  const fragment = container.ownerDocument.createDocumentFragment();
  for (let i = start; i < endIncoming; i++) {
    const node = incoming[i];
    if (node) fragment.appendChild(node);
  }
  container.insertBefore(fragment, anchor);

  return {
    kept: start + (current.length - endCurrent),
    removed: endCurrent - start,
    inserted: endIncoming - start,
  };
}
