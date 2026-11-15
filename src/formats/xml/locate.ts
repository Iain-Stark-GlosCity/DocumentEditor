/**
 * Finds an element in XML text from a locator such as `/w:document/w:body/w:p[12]`.
 *
 * A locator is the path of qualified names as written in the file, each step with its 1-based
 * position among the siblings of the same written name; a step without a position means the
 * first. The names are compared as written, so namespace prefixes need no resolving.
 *
 * It reads the raw text with a streaming scan, never building a tree: it counts siblings only at
 * the level it is looking at, skips every other subtree by balancing tags, and stops at the
 * target. Comments, CDATA, processing instructions and the DOCTYPE are skipped whole, and quoted
 * attribute values may hold `>`, `<` and `/`. Word writes `document.xml` as a single line of a
 * few megabytes, so nothing here is quadratic in the length of a line.
 */

export interface TextRange {
  from: number;
  to: number;
}

interface Step {
  name: string;
  index: number;
}

const STEP = /^([^[\]/\s<>"'=]+)(?:\[([0-9]+)\])?$/;

/** The steps of a locator, or null when it is not one. */
export function parseLocator(locator: string): Step[] | null {
  if (typeof locator !== "string" || locator.length < 2 || locator[0] !== "/") return null;
  const steps: Step[] = [];
  for (const part of locator.slice(1).split("/")) {
    const m = STEP.exec(part);
    if (!m) return null;
    const index = m[2] === undefined ? 1 : Number(m[2]);
    if (!Number.isSafeInteger(index) || index < 1) return null;
    steps.push({ name: m[1]!, index });
  }
  return steps;
}

// A start tag: name, then attributes whose quoted values may hold anything. The alternatives
// start with different characters, so the match is linear.
const START_TAG = /<([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;

const CC_SLASH = 47;

/** Where the element the locator names starts and ends in `text`, or null if it is not there. */
export function locateElement(text: string, locator: string): TextRange | null {
  try {
    const steps = parseLocator(locator);
    return steps ? scan(text, steps) : null;
  } catch {
    return null;
  }
}

function scan(text: string, steps: Step[]): TextRange | null {
  const n = text.length;
  const last = steps.length - 1;
  // `level`: how many steps are matched; the scan is looking for steps[level] among the children
  // of the last matched element (or among the top-level elements for level 0).
  let level = 0;
  let count = 0;
  // Depth inside a subtree that is being skipped, or, once the target is found, inside the target.
  let depth = 0;
  let from = -1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // The text ended inside the target: a damaged part whose element was never closed. The element
  // is still the one asked for, and runs to the end of the text.
  const ended = (): TextRange | null => (from >= 0 ? { from, to: n } : null);

  while (pos < n) {
    const lt = text.indexOf("<", pos);
    if (lt < 0) return ended();
    const next = text.charCodeAt(lt + 1);
    if (next === 33 /* ! */) {
      if (text.startsWith("<!--", lt)) {
        const end = text.indexOf("-->", lt + 4);
        if (end < 0) return ended();
        pos = end + 3;
      } else if (text.startsWith("<![CDATA[", lt)) {
        const end = text.indexOf("]]>", lt + 9);
        if (end < 0) return ended();
        pos = end + 3;
      } else {
        pos = declarationEnd(text, lt);
        if (pos < 0) return ended();
      }
      continue;
    }
    if (next === 63 /* ? */) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) return ended();
      pos = end + 2;
      continue;
    }
    if (next === CC_SLASH) {
      const gt = text.indexOf(">", lt + 2);
      if (gt < 0) return ended();
      pos = gt + 1;
      if (depth > 0) {
        depth--;
        if (depth === 0 && from >= 0) return { from, to: pos };
      } else return null; // The element being searched in closed without holding the target.
      continue;
    }
    START_TAG.lastIndex = lt;
    const m = START_TAG.exec(text);
    if (!m) {
      pos = lt + 1; // A stray `<` in text: carry on after it.
      continue;
    }
    pos = lt + m[0].length;
    const selfClosing = m[2]!.charCodeAt(m[2]!.length - 1) === CC_SLASH;
    if (depth > 0) {
      if (!selfClosing) depth++;
      continue;
    }
    // At the level being searched.
    const step = steps[level]!;
    if (m[1] === step.name && ++count === step.index) {
      if (level === last) {
        if (selfClosing) return { from: lt, to: pos };
        from = lt;
        depth = 1;
      } else if (selfClosing) return null;
      else {
        level++;
        count = 0;
      }
    } else if (!selfClosing) depth = 1;
  }
  return ended();
}

/** The end of a `<!DOCTYPE ...>` or other declaration, which may hold an `[ ... ]` subset. */
function declarationEnd(text: string, from: number): number {
  let bracket = 0;
  let quote = 0;
  for (let i = from + 2; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 91) bracket++;
    else if (c === 93) bracket--;
    else if (c === 62 && bracket <= 0) return i + 1;
    else if (c === 60 && text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) return -1;
      i = end + 2;
    }
  }
  return -1;
}
