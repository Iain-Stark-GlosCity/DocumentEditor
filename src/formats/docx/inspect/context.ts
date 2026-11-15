/**
 * What every integrity rule reads: the package's parts, their parsed XML, an index of each part's
 * elements by name, the relationships of each part, the content types, and the parts Word reads
 * the document's content from. Everything is read lazily and cached, so a rule pays only for what
 * it reads and the second rule to read a part pays nothing.
 *
 * Pure: no DOM, no Node APIs. Safe in a Web Worker.
 */
import type { Finding, FindingLocation, FindingSeverity } from "../../../core/findings";
import { resolvePartName, type PartSource } from "../package";
import { locatorOf, localName, parseXml, type XDocument, type XElement } from "../xml";

/** At most this many locations are listed on one finding; the count goes in `facts`. */
export const MAX_LOCATIONS = 5;

/** Parts larger than this (in characters) are not parsed; the inspector says so instead. */
export const MAX_PART_CHARS = 64 * 1024 * 1024;

/** Elements that hold a revision's OLD properties: their contents are history, not live markup. */
export const CHANGE_ELEMENTS = new Set([
  "w:pPrChange",
  "w:rPrChange",
  "w:sectPrChange",
  "w:tblPrChange",
  "w:tblPrExChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:tblGridChange",
  "w:numberingChange",
]);

export interface Relationship {
  id: string;
  /** The last segment of the type URI (`styles`, `header`, `officeDocument`). */
  type: string;
  /** The resolved part name for an internal target; the raw target for an external one. */
  target: string;
  rawTarget: string;
  external: boolean;
  /** The `<Relationship>` element, in the `.rels` part named by `relsPart`. */
  el: XElement;
  relsPart: string;
}

/** A relationship reference in a part: an attribute in the relationships namespace (`r:id`). */
export interface RelReference {
  el: XElement;
  attr: string;
  value: string;
}

export interface PartIndex {
  doc: XDocument;
  /**
   * Elements by canonical name, in document order. Leaves out the contents of `mc:Fallback`
   * (Word writes the same content twice in `mc:AlternateContent`, and reading both copies would
   * report every bookmark and id twice) and the contents of revision "old properties" elements
   * (`w:rPrChange` and friends, whose contents are what the formatting used to be).
   */
  byName: Map<string, XElement[]>;
  /** Every relationship reference in the part, including those in `mc:Fallback`. */
  relRefs: RelReference[];
}

/** One place a finding points at. */
export interface Hit {
  part: string;
  el?: XElement;
  label?: string;
}

export interface Report {
  rule: string;
  severity: FindingSeverity;
  family: string;
  title: string;
  why: string;
  /** What makes this finding unique within its rule (an id, a part name). Never document text. */
  key: string;
  /** All the places; the first `MAX_LOCATIONS` become locations, the rest are counted. */
  hits: Hit[];
  facts?: Record<string, string | number | boolean>;
}

/** A short, stable hash (FNV-1a, 32-bit) for finding ids. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The name of the `.rels` part that holds `part`'s relationships (`""` is the package itself). */
export function relsPartOf(part: string): string {
  const slash = part.lastIndexOf("/");
  const dir = slash < 0 ? "" : part.slice(0, slash);
  return `${dir ? dir + "/" : ""}_rels/${part.slice(slash + 1)}.rels`;
}

/** The source part of a `.rels` part (`word/_rels/document.xml.rels` -> `word/document.xml`). */
export function sourceOfRels(relsPart: string): string | undefined {
  const m = /^(.*?)(?:^|\/)_rels\/([^/]*)\.rels$/.exec(relsPart);
  if (!m) return undefined;
  const dir = m[1] ?? "";
  return dir ? `${dir}/${m[2]}` : (m[2] ?? "");
}

function percentDecode(text: string): string {
  if (text.indexOf("%") < 0) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function extensionOf(part: string): string {
  const slash = part.lastIndexOf("/");
  const dot = part.lastIndexOf(".");
  return dot > slash ? part.slice(dot + 1).toLowerCase() : "";
}

export class InspectContext {
  readonly names: string[];
  private readonly lower = new Map<string, string>();
  private readonly docs = new Map<string, XDocument | null>();
  private readonly indexes = new Map<string, PartIndex | null>();
  private readonly relsCache = new Map<string, Relationship[]>();
  private readonly tooLarge = new Set<string>();
  readonly findings: Finding[] = [];
  private readonly ids = new Set<string>();
  private mainCache: string | null | undefined;

  constructor(readonly source: PartSource) {
    let names: string[];
    try {
      names = source.names().filter((n) => n !== "" && !n.endsWith("/"));
    } catch {
      names = [];
    }
    this.names = [...new Set(names)].sort();
    for (const name of this.names) {
      const key = name.toLowerCase();
      if (!this.lower.has(key)) this.lower.set(key, name);
    }
  }

  private readonly memos = new Map<string, unknown>();

  /** A value computed once per inspection and shared between rules. */
  memo<T>(key: string, make: () => T): T {
    if (this.memos.has(key)) return this.memos.get(key) as T;
    const value = make();
    this.memos.set(key, value);
    return value;
  }

  /** The part's name as stored, matching case-insensitively (OPC part names ignore case). */
  find(name: string): string | undefined {
    return this.lower.get(name.toLowerCase());
  }

  exists(name: string): boolean {
    return this.lower.has(name.toLowerCase());
  }

  text(name: string): string | undefined {
    const stored = this.find(name);
    if (stored === undefined) return undefined;
    try {
      return this.source.text(stored);
    } catch {
      return undefined;
    }
  }

  /** The parsed part, or null if it is missing, too large, or plainly not XML. */
  xml(name: string): XDocument | null {
    const stored = this.find(name) ?? name;
    if (this.docs.has(stored)) return this.docs.get(stored)!;
    let doc: XDocument | null = null;
    const text = this.text(stored);
    if (text !== undefined) {
      if (text.length > MAX_PART_CHARS) this.tooLarge.add(stored);
      else doc = parseXml(text);
    }
    this.docs.set(stored, doc);
    return doc;
  }

  /** Parts that were too large to parse. */
  partsTooLarge(): string[] {
    return [...this.tooLarge].sort();
  }

  /** The part's elements by name (see `PartIndex`), or null if the part is missing. */
  index(name: string): PartIndex | null {
    const stored = this.find(name) ?? name;
    if (this.indexes.has(stored)) return this.indexes.get(stored)!;
    const doc = this.xml(stored);
    const index = doc ? buildIndex(doc) : null;
    this.indexes.set(stored, index);
    return index;
  }

  /** Elements of one name in a part, in document order (see `PartIndex.byName`). */
  all(part: string, name: string): XElement[] {
    return this.index(part)?.byName.get(name) ?? [];
  }

  /** The relationships of a part (`""` for the package), in file order, duplicates included. */
  rels(part: string): Relationship[] {
    const cached = this.relsCache.get(part);
    if (cached) return cached;
    const relsPart = part === "" ? "_rels/.rels" : relsPartOf(part);
    const list: Relationship[] = [];
    this.relsCache.set(part, list);
    const root = this.xml(relsPart)?.root;
    if (!root) return list;
    const slash = part.lastIndexOf("/");
    const dir = slash < 0 ? "" : part.slice(0, slash);
    for (const el of root.children) {
      if (typeof el === "string" || localName(el.name) !== "Relationship") continue;
      const rawTarget = el.attrs.Target ?? "";
      const external = (el.attrs.TargetMode ?? "").toLowerCase() === "external";
      list.push({
        id: el.attrs.Id ?? "",
        type: (el.attrs.Type ?? "").split("/").pop() ?? "",
        // A target with a URI scheme (file:, http:) is not a part name, marked External or not.
        target:
          external || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
            ? rawTarget
            : resolvePartName(dir, percentDecode(rawTarget.split("#")[0]!)),
        rawTarget,
        external,
        el,
        relsPart: this.find(relsPart) ?? relsPart,
      });
    }
    return list;
  }

  /** The first relationship of `part` with this id. */
  rel(part: string, id: string): Relationship | undefined {
    for (const r of this.rels(part)) if (r.id === id) return r;
    return undefined;
  }

  /** Internal targets of `part`'s relationships of a type, that exist. */
  relatedAll(part: string, type: string): string[] {
    const out: string[] = [];
    for (const r of this.rels(part)) {
      if (r.type !== type || r.external) continue;
      const stored = this.find(r.target);
      if (stored !== undefined && !out.includes(stored)) out.push(stored);
    }
    return out;
  }

  related(part: string, type: string): string | undefined {
    return this.relatedAll(part, type)[0];
  }

  /** The main document part, from the package relationships; null if there is none. */
  main(): string | null {
    if (this.mainCache !== undefined) return this.mainCache;
    let main: string | null = null;
    for (const r of this.rels("")) {
      if (r.type === "officeDocument" && !r.external) {
        main = this.find(r.target) ?? null;
        break;
      }
    }
    this.mainCache = main;
    return main;
  }

  /**
   * The parts that hold the document's content, the main document first: headers, footers,
   * footnotes, endnotes and comments, as the main document's relationships name them.
   */
  stories(): string[] {
    const main = this.main();
    if (!main) return [];
    const out = [main];
    for (const type of ["header", "footer", "footnotes", "endnotes", "comments"])
      for (const part of this.relatedAll(main, type)) if (!out.includes(part)) out.push(part);
    return out;
  }

  /** The location of an element in a part. */
  location(hit: Hit): FindingLocation {
    const location: FindingLocation = { part: hit.part };
    if (hit.el) location.locator = locatorOf(hit.el);
    if (hit.label) location.label = hit.label;
    return location;
  }

  report(report: Report): void {
    const locations = report.hits.slice(0, MAX_LOCATIONS).map((h) => this.location(h));
    let id = `${report.rule}#${hash(report.key)}`;
    // Two findings of one rule with the same key would share an id; keep them apart, stably.
    for (let n = 2; this.ids.has(id); n++) id = `${report.rule}#${hash(report.key)}-${n}`;
    this.ids.add(id);
    const finding: Finding = {
      id,
      rule: report.rule,
      severity: report.severity,
      family: report.family,
      title: report.title,
      why: report.why,
      locations,
    };
    const facts = { ...(report.facts ?? {}) };
    if (report.hits.length > 1 || facts.count !== undefined) facts.count ??= report.hits.length;
    if (Object.keys(facts).length > 0) finding.facts = facts;
    this.findings.push(finding);
  }
}

/** One walk over the part, in document order, without recursion (tables nest deeply). */
function buildIndex(doc: XDocument): PartIndex {
  const byName = new Map<string, XElement[]>();
  const relRefs: RelReference[] = [];
  if (!doc.root) return { doc, byName, relRefs };
  // Each entry: the element and whether it is outside the indexed content.
  const stack: [XElement, boolean][] = [[doc.root, false]];
  while (stack.length > 0) {
    const [el, hidden] = stack.pop()!;
    if (!hidden) {
      let list = byName.get(el.name);
      if (!list) byName.set(el.name, (list = []));
      list.push(el);
    }
    for (const attr in el.attrs) {
      if (attr.startsWith("r:")) {
        const value = el.attrs[attr]!;
        if (value !== "") relRefs.push({ el, attr, value });
      }
    }
    const hideChildren = hidden || el.name === "mc:Fallback" || CHANGE_ELEMENTS.has(el.name);
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i]!;
      if (typeof c !== "string") stack.push([c, hideChildren]);
    }
  }
  return { doc, byName, relRefs };
}

/** `w:val` of a child property element, if present. */
export function valOf(el: XElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  for (const c of el.children)
    if (typeof c !== "string" && c.name === name) return c.attrs["w:val"];
  return undefined;
}

/** True when the element is inside an ancestor with one of these names. */
export function within(el: XElement, names: ReadonlySet<string> | string): boolean {
  for (let p = el.parent; p; p = p.parent)
    if (typeof names === "string" ? p.name === names : names.has(p.name)) return true;
  return false;
}

/** The closest ancestor with this name. */
export function ancestor(el: XElement, name: string): XElement | undefined {
  for (let p = el.parent; p; p = p.parent) if (p.name === name) return p;
  return undefined;
}

/** "1 paragraph" / "3 paragraphs". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Groups hits by a key, keeping the first-seen order of keys. */
export function groupBy<T>(items: Iterable<T>, keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(item);
  }
  return map;
}
