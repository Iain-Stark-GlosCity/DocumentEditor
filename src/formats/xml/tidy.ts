/**
 * Tidy for XML: re-indents the whitespace between elements and changes nothing else.
 *
 * It works on a token stream over the text, never on a parsed and re-serialised document, so every
 * other character (text, attribute values and their quoting, entity references, CDATA sections,
 * comments, processing instructions, the DOCTYPE and the XML declaration) is carried over byte for
 * byte. Only whitespace between the children of an element with element-only content changes. An
 * element with any text, CDATA or `xml:space="preserve"` is left as it is, along with everything
 * inside it.
 *
 * Plain TypeScript: no DOM, no React, no Tauri.
 */

/** One replacement in the original text. Changes never overlap and are in ascending order. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

type Kind = "text" | "start" | "end" | "empty" | "comment" | "cdata" | "pi" | "doctype";

interface Token {
  kind: Kind;
  from: number;
  to: number;
  /** Start and end tags: the element name. */
  name?: string;
  /** Start and empty tags: the value of `xml:space`, if present. */
  space?: string;
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13;

/** True for a string of XML whitespace only (possibly empty). */
function blank(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (!isSpace(text.charCodeAt(i))) return false;
  return true;
}

/** Index of the end of a start, empty or end tag that opens at `from`, or -1; fills `token`. */
function scanTag(text: string, from: number, token: Token): number {
  const n = text.length;
  let i = from + 1;
  const closing = text.charCodeAt(i) === 47; // "/"
  if (closing) i++;
  const nameStart = i;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (isSpace(c) || c === 62 || c === 47 || c === 60 || c === 61 || c === 34 || c === 39) break;
    i++;
  }
  if (i === nameStart) return -1;
  token.name = text.slice(nameStart, i);
  for (;;) {
    while (i < n && isSpace(text.charCodeAt(i))) i++;
    if (i >= n) return -1;
    const c = text.charCodeAt(i);
    if (c === 62) {
      // ">"
      token.kind = closing ? "end" : "start";
      return i + 1;
    }
    if (closing) return -1;
    if (c === 47) {
      // "/>"
      if (text.charCodeAt(i + 1) !== 62) return -1;
      token.kind = "empty";
      return i + 2;
    }
    // An attribute: name, "=", quoted value.
    const attrStart = i;
    while (i < n) {
      const d = text.charCodeAt(i);
      if (isSpace(d) || d === 61 || d === 62 || d === 47 || d === 60 || d === 34 || d === 39) break;
      i++;
    }
    if (i === attrStart) return -1;
    const attr = text.slice(attrStart, i);
    while (i < n && isSpace(text.charCodeAt(i))) i++;
    if (text.charCodeAt(i) !== 61) return -1;
    i++;
    while (i < n && isSpace(text.charCodeAt(i))) i++;
    const quote = text.charCodeAt(i);
    if (quote !== 34 && quote !== 39) return -1;
    const close = text.indexOf(quote === 34 ? '"' : "'", i + 1);
    if (close < 0) return -1;
    if (attr === "xml:space") token.space = text.slice(i + 1, close);
    i = close + 1;
  }
}

/** Index after a DOCTYPE that starts at `from`, honouring quotes, comments and the `[...]` subset. */
function scanDoctype(text: string, from: number): number {
  const n = text.length;
  let i = from + 9;
  let depth = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34 || c === 39) {
      const close = text.indexOf(text.charAt(i), i + 1);
      if (close < 0) return -1;
      i = close + 1;
    } else if (c === 60 && text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      if (close < 0) return -1;
      i = close + 3;
    } else if (c === 60 && text.charCodeAt(i + 1) === 63) {
      const close = text.indexOf("?>", i + 2);
      if (close < 0) return -1;
      i = close + 2;
    } else if (c === 91) {
      depth++;
      i++;
    } else if (c === 93) {
      depth--;
      i++;
    } else if (c === 62 && depth <= 0) {
      return i + 1;
    } else {
      i++;
    }
  }
  return -1;
}

/** The tokens of a document, or null if the markup is malformed or unbalanced. */
export function tokenise(text: string): Token[] | null {
  const tokens: Token[] = [];
  const open: string[] = [];
  let roots = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text.charCodeAt(i) !== 60) {
      let end = text.indexOf("<", i);
      if (end < 0) end = n;
      if (open.length === 0 && !blank(text, i, end)) return null;
      tokens.push({ kind: "text", from: i, to: end });
      i = end;
      continue;
    }
    const next = text.charCodeAt(i + 1);
    const token: Token = { kind: "text", from: i, to: i };
    let end: number;
    if (next === 33) {
      // "<!"
      if (text.startsWith("<!--", i)) {
        const close = text.indexOf("-->", i + 4);
        if (close < 0) return null;
        token.kind = "comment";
        end = close + 3;
      } else if (text.startsWith("<![CDATA[", i)) {
        if (open.length === 0) return null;
        const close = text.indexOf("]]>", i + 9);
        if (close < 0) return null;
        token.kind = "cdata";
        end = close + 3;
      } else if (text.startsWith("<!DOCTYPE", i)) {
        if (open.length > 0 || roots > 0) return null;
        end = scanDoctype(text, i);
        if (end < 0) return null;
        token.kind = "doctype";
      } else {
        return null;
      }
    } else if (next === 63) {
      // "<?"
      const close = text.indexOf("?>", i + 2);
      if (close < 0) return null;
      token.kind = "pi";
      end = close + 2;
    } else {
      end = scanTag(text, i, token);
      if (end < 0) return null;
      if (token.kind === "start") {
        if (open.length === 0 && ++roots > 1) return null;
        open.push(token.name ?? "");
      } else if (token.kind === "empty") {
        if (open.length === 0 && ++roots > 1) return null;
      } else if (open.pop() !== token.name) {
        return null;
      }
    }
    token.to = end;
    tokens.push(token);
    i = end;
  }
  if (open.length > 0 || roots !== 1) return null;
  return tokens;
}

/** The newline and indentation that put a child at `depth`. */
function lineAt(depth: number, unit: string): string {
  return "\n" + unit.repeat(depth);
}

/**
 * The changes that tidy `text`, indenting nested elements by `indent` spaces per level; an empty
 * list when it is tidy already, and null when the text is not well-formed XML (nothing is done).
 */
export function tidyChanges(text: string, indent: number): TextChange[] | null {
  const tokens = tokenise(text);
  if (tokens === null) return null;
  const unit = " ".repeat(Math.max(0, Math.round(indent)));
  const count = tokens.length;

  // Pass 1: which start tags hold only elements, comments and processing instructions (plus
  // whitespace), and are not `xml:space="preserve"`? Their whitespace may be changed.
  interface Frame {
    index: number;
    elements: boolean;
    text: boolean;
    preserve: boolean;
  }
  const own = new Uint8Array(count);
  const stack: Frame[] = [];
  for (let t = 0; t < count; t++) {
    const token = tokens[t] as Token;
    const top = stack[stack.length - 1];
    switch (token.kind) {
      case "start":
        if (top) top.elements = true;
        stack.push({
          index: t,
          elements: false,
          text: false,
          preserve: token.space === "preserve",
        });
        break;
      case "empty":
        if (top) top.elements = true;
        break;
      case "end": {
        const done = stack.pop();
        if (done && done.elements && !done.text && !done.preserve) own[done.index] = 1;
        break;
      }
      case "text":
        if (top && !blank(text, token.from, token.to)) top.text = true;
        break;
      case "cdata":
        if (top) top.text = true;
        break;
      default:
        break;
    }
  }
  // An element that is mixed or preserving is opaque, with everything inside it: a nested
  // element-only element is not re-indented, because the surrounding text may depend on it.
  const formatted = new Uint8Array(count);
  const walk: number[] = [];
  for (let t = 0; t < count; t++) {
    const token = tokens[t] as Token;
    if (token.kind === "start") {
      const parent = walk.length > 0 ? (walk[walk.length - 1] as number) : -1;
      if (own[t] === 1 && (parent < 0 || formatted[parent] === 1)) formatted[t] = 1;
      walk.push(t);
    } else if (token.kind === "end") {
      walk.pop();
    }
  }

  // Pass 2: replace the whitespace in front of every non-text token that sits in a formatted
  // element, and in front of its end tag.
  const changes: TextChange[] = [];
  const chain: number[] = []; // start tokens of open elements
  let seenTop = false; // a top-level token (not text) has been passed
  const set = (from: number, to: number, insert: string) => {
    if (text.slice(from, to) !== insert) changes.push({ from, to, insert });
  };
  for (let t = 0; t < count; t++) {
    const token = tokens[t] as Token;
    if (token.kind === "text") continue;
    const prev = t > 0 ? (tokens[t - 1] as Token) : null;
    const gapFrom = prev && prev.kind === "text" ? prev.from : token.from;
    const parent = chain.length > 0 ? (chain[chain.length - 1] as number) : -1;
    if (token.kind === "end") {
      const open = chain.pop() as number;
      if (formatted[open] === 1) set(gapFrom, token.from, lineAt(chain.length, unit));
    } else {
      if (parent >= 0 && formatted[parent] === 1) {
        set(gapFrom, token.from, lineAt(chain.length, unit));
      } else if (parent < 0 && seenTop) {
        // Between top-level items (declaration, DOCTYPE, comments, the root): a line break
        // wherever there is none.
        if (!text.slice(gapFrom, token.from).includes("\n")) set(gapFrom, token.from, "\n");
      }
      if (parent < 0) seenTop = true;
      if (token.kind === "start") chain.push(t);
    }
  }
  return changes;
}

/** Applies changes (ascending, non-overlapping) to a string. Used by tests and callers off the editor. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const c of changes) {
    parts.push(text.slice(at, c.from), c.insert);
    at = c.to;
  }
  parts.push(text.slice(at));
  return parts.join("");
}

/** `text` tidied, or null if it is not well-formed. */
export function tidyXml(text: string, indent: number): string | null {
  const changes = tidyChanges(text, indent);
  return changes === null ? null : applyChanges(text, changes);
}
