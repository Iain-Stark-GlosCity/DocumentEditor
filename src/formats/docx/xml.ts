/**
 * A small, tolerant, order-preserving XML parser for Office Open XML parts.
 *
 * Why our own and not a library: the view needs (1) document order of mixed children, (2) the
 * exact source text of any element, so unknown markup can be shown verbatim, (3) namespace
 * tolerance (Word writes `w:`, but the Strict variant and other producers may use other prefixes
 * or a default namespace), and (4) it must never throw on damaged input. A scanner that does
 * exactly this is about 250 lines and a few kilobytes minified, smaller than `fast-xml-parser`
 * and with no source offsets to bolt on.
 *
 * Names are canonicalised: an element or attribute in a known namespace gets that namespace's
 * conventional prefix (`w:p`, `r:id`, `wp:inline`), whatever prefix the file used. Unknown
 * namespaces keep the prefix from the file. `xmlns` declarations are not kept as attributes.
 */

export interface XElement {
  /** The canonical name (`w:p`), whatever prefix the file used. */
  readonly name: string;
  /** The qualified name exactly as written in the file, for building locators (see `locatorOf`). */
  readonly rawName: string;
  readonly attrs: Record<string, string>;
  readonly children: XNode[];
  readonly parent: XElement | null;
  /** Offsets of the element in the source text (start of `<`, end after `>`). */
  readonly start: number;
  end: number;
}

/** Text nodes are plain strings (entities decoded). */
export type XNode = XElement | string;

export interface XDocument {
  readonly root: XElement | null;
  readonly source: string;
  /** Problems found while parsing (unclosed tags, stray end tags and so on). */
  readonly problems: string[];
}

const KNOWN_NAMESPACES: Record<string, string> = {
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
  "http://purl.oclc.org/ooxml/wordprocessingml/main": "w",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
  "http://purl.oclc.org/ooxml/officeDocument/relationships": "r",
  "http://schemas.openxmlformats.org/package/2006/relationships": "pr",
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing": "wp",
  "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": "wp",
  "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
  "http://purl.oclc.org/ooxml/drawingml/main": "a",
  "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
  "http://purl.oclc.org/ooxml/drawingml/picture": "pic",
  "http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
  "urn:schemas-microsoft-com:vml": "v",
  "urn:schemas-microsoft-com:office:office": "o",
  "urn:schemas-microsoft-com:office:word": "w10",
  "http://schemas.openxmlformats.org/officeDocument/2006/math": "m",
  "http://purl.oclc.org/ooxml/officeDocument/math": "m",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape": "wps",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup": "wpg",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas": "wpc",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing": "wp14",
  "http://schemas.microsoft.com/office/word/2010/wordml": "w14",
  "http://schemas.microsoft.com/office/word/2012/wordml": "w15",
  "http://schemas.microsoft.com/office/word/2018/wordml/cex": "w16cex",
  "http://schemas.microsoft.com/office/word/2016/wordml/cid": "w16cid",
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties": "cp",
  "http://purl.org/dc/elements/1.1/": "dc",
  "http://purl.org/dc/terms/": "dcterms",
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties": "ep",
  "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties": "cup",
  "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes": "vt",
  "http://www.w3.org/2001/XMLSchema-instance": "xsi",
  "http://www.w3.org/XML/1998/namespace": "xml",
};

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (text.indexOf("&") < 0) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[body] ?? whole;
  });
}

type Scope = Map<string, string> | null;

interface Frame {
  el: XElement;
  rawName: string;
  /** prefix -> canonical prefix, inherited. */
  scope: Scope;
}

function canonical(rawName: string, scope: Scope, isAttr: boolean): string {
  const colon = rawName.indexOf(":");
  const prefix = colon < 0 ? "" : rawName.slice(0, colon);
  const local = colon < 0 ? rawName : rawName.slice(colon + 1);
  if (colon < 0 && isAttr) return local; // Unprefixed attributes have no namespace.
  if (prefix === "xml") return rawName;
  const mapped = scope?.get(prefix);
  if (mapped === undefined) return rawName;
  return mapped === "" ? local : `${mapped}:${local}`;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parses XML text. Never throws. */
export function parseXml(source: string): XDocument {
  const problems: string[] = [];
  const stack: Frame[] = [];
  let root: XElement | null = null;
  const docChildren: XElement[] = [];
  let pos = 0;
  const n = source.length;
  // Skip a BOM.
  if (source.charCodeAt(0) === 0xfeff) pos = 1;

  const pushText = (text: string) => {
    const top = stack[stack.length - 1];
    if (!top || text === "") return;
    const kids = top.el.children;
    const last = kids[kids.length - 1];
    if (typeof last === "string") kids[kids.length - 1] = last + text;
    else kids.push(text);
  };

  while (pos < n) {
    const lt = source.indexOf("<", pos);
    if (lt < 0) {
      pushText(decodeEntities(source.slice(pos)));
      break;
    }
    if (lt > pos) pushText(decodeEntities(source.slice(pos, lt)));
    const next = source.charCodeAt(lt + 1);
    if (next === 33 /* ! */) {
      if (source.startsWith("<!--", lt)) {
        const end = source.indexOf("-->", lt + 4);
        pos = end < 0 ? n : end + 3;
      } else if (source.startsWith("<![CDATA[", lt)) {
        const end = source.indexOf("]]>", lt + 9);
        pushText(source.slice(lt + 9, end < 0 ? n : end));
        pos = end < 0 ? n : end + 3;
      } else {
        const end = source.indexOf(">", lt);
        pos = end < 0 ? n : end + 1;
      }
      continue;
    }
    if (next === 63 /* ? */) {
      const end = source.indexOf("?>", lt);
      pos = end < 0 ? n : end + 2;
      continue;
    }
    const gt = findTagEnd(source, lt + 1);
    if (gt < 0) {
      problems.push(`unterminated tag at offset ${lt}`);
      pushText(source.slice(lt));
      break;
    }
    pos = gt + 1;
    if (next === 47 /* / */) {
      const rawName = source.slice(lt + 2, gt).trim();
      let i = stack.length - 1;
      while (i >= 0 && stack[i]!.rawName !== rawName) i--;
      if (i < 0) {
        problems.push(`stray end tag </${rawName}> at offset ${lt}`);
        continue;
      }
      while (stack.length - 1 > i) {
        const lost = stack.pop()!;
        lost.el.end = lt;
        problems.push(`<${lost.rawName}> was not closed`);
      }
      const frame = stack.pop()!;
      frame.el.end = gt + 1;
      continue;
    }
    let body = source.slice(lt + 1, gt);
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);
    const nameEnd = body.search(/[\s]/);
    const rawName = nameEnd < 0 ? body : body.slice(0, nameEnd);
    if (rawName === "" || /[<>"']/.test(rawName)) {
      pushText(source.slice(lt, gt + 1));
      problems.push(`not a tag at offset ${lt}`);
      continue;
    }
    const parentFrame = stack[stack.length - 1];
    let scope: Scope = parentFrame ? parentFrame.scope : null;
    const rawAttrs: [string, string][] = [];
    if (nameEnd >= 0) {
      const attrText = body.slice(nameEnd);
      ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ATTR_RE.exec(attrText))) {
        const key = m[1]!;
        const value = decodeEntities(m[3] ?? m[4] ?? "");
        if (key === "xmlns" || key.startsWith("xmlns:")) {
          const prefix = key === "xmlns" ? "" : key.slice(6);
          const known = KNOWN_NAMESPACES[value];
          if (scope === (parentFrame ? parentFrame.scope : null)) scope = new Map(scope ?? []);
          scope!.set(prefix, known ?? prefix);
        } else rawAttrs.push([key, value]);
      }
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of rawAttrs) attrs[canonical(k, scope, true)] = v;
    const el: XElement = {
      name: canonical(rawName, scope, false),
      rawName,
      attrs,
      children: [],
      parent: parentFrame ? parentFrame.el : null,
      start: lt,
      end: gt + 1,
    };
    if (parentFrame) parentFrame.el.children.push(el);
    else {
      docChildren.push(el);
      if (root === null) root = el;
    }
    if (!selfClosing) stack.push({ el, rawName, scope });
  }
  while (stack.length) {
    const lost = stack.pop()!;
    lost.el.end = n;
    problems.push(`<${lost.rawName}> was not closed`);
  }
  if (docChildren.length > 1) problems.push("more than one root element");
  return { root, source, problems };
}

/** Index of the `>` that ends the tag starting at `from`, skipping quoted attribute values. */
function findTagEnd(source: string, from: number): number {
  let quote = 0;
  for (let i = from; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 62) return i;
    else if (c === 60) return -1;
  }
  return -1;
}

/* ---------- helpers ---------- */

export function isElement(node: XNode | undefined | null): node is XElement {
  return typeof node === "object" && node !== null;
}

export function elements(el: XElement | null | undefined): XElement[] {
  if (!el) return [];
  const out: XElement[] = [];
  for (const c of el.children) if (typeof c !== "string") out.push(c);
  return out;
}

export function child(el: XElement | null | undefined, name: string): XElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (typeof c !== "string" && c.name === name) return c;
  return undefined;
}

export function childrenNamed(el: XElement | null | undefined, name: string): XElement[] {
  return elements(el).filter((c) => c.name === name);
}

/** First descendant (depth first) with the given name. */
export function descendant(el: XElement | null | undefined, name: string): XElement | undefined {
  return el ? firstInOrder(el, name) : undefined;
}

function firstInOrder(el: XElement, name: string): XElement | undefined {
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (c.name === name) return c;
    const found = firstInOrder(c, name);
    if (found) return found;
  }
  return undefined;
}

export function descendants(el: XElement | null | undefined, name: string): XElement[] {
  const out: XElement[] = [];
  const walk = (e: XElement) => {
    for (const c of e.children) {
      if (typeof c === "string") continue;
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  if (el) walk(el);
  return out;
}

/** The concatenated text of an element and its descendants. */
export function textOf(el: XElement | null | undefined): string {
  if (!el) return "";
  let out = "";
  for (const c of el.children) out += typeof c === "string" ? c : textOf(c);
  return out;
}

export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

/** An XPath-like path to the element, for example `/w:document/w:body/w:p[12]/w:r[3]`. */
export function pathOf(el: XElement): string {
  const parts: string[] = [];
  let cur: XElement | null = el;
  while (cur) {
    const parent: XElement | null = cur.parent;
    if (!parent) {
      parts.push(cur.name);
      break;
    }
    let index = 0;
    let count = 0;
    for (const c of parent.children) {
      if (typeof c === "string" || c.name !== cur.name) continue;
      count++;
      if (c === cur) index = count;
    }
    parts.push(count > 1 || index > 1 ? `${cur.name}[${index}]` : cur.name);
    cur = parent;
  }
  return "/" + parts.reverse().join("/");
}

/**
 * A locator for the element that can be found again in the part's text by reading it as written:
 * an XPath-like path of the qualified names AS WRITTEN IN THE FILE (not canonicalised), each with its
 * 1-based position among siblings of the same written name. The position is left off when it is 1
 * and the only element of that name (`/w:document/w:body/w:p[12]`, but `/w:document/w:body`).
 * `TextFormatProvider.locate` of the XML format reads this form back.
 */
export function locatorOf(el: XElement): string {
  const parts: string[] = [];
  let cur: XElement | null = el;
  while (cur) {
    const parent: XElement | null = cur.parent;
    if (!parent) {
      parts.push(cur.rawName);
      break;
    }
    const { index, count } = siblingPosition(parent, cur);
    parts.push(count > 1 ? `${cur.rawName}[${index}]` : cur.rawName);
    cur = parent;
  }
  return "/" + parts.reverse().join("/");
}

export interface Position {
  index: number;
  count: number;
}

/**
 * Sibling positions per parent, built once on first use: a body of 10,000 paragraphs would
 * otherwise cost a scan of every sibling for every locator. Parsed documents are never changed
 * after parsing, so the cache cannot go stale.
 */
const positions = new WeakMap<XElement, Map<XElement, Position>>();

export function siblingPosition(parent: XElement, el: XElement): Position {
  let map = positions.get(parent);
  if (!map) {
    map = new Map();
    const counts = new Map<string, number>();
    for (const c of parent.children) {
      if (typeof c === "string") continue;
      const n = (counts.get(c.rawName) ?? 0) + 1;
      counts.set(c.rawName, n);
      map.set(c, { index: n, count: 0 });
    }
    for (const [c, pos] of map) pos.count = counts.get(c.rawName) ?? 1;
    positions.set(parent, map);
  }
  return map.get(el) ?? { index: 1, count: 1 };
}

/** The element's source text, as written in the file. */
export function sourceOf(doc: { source: string }, el: XElement): string {
  return doc.source.slice(el.start, el.end);
}
