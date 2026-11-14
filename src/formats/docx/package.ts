/**
 * The package around the main document: parts, relationships and the theme. Everything here is
 * read lazily and cached, and a part that is missing or not XML is simply absent.
 */
import { child, elements, localName, parseXml, type XDocument, type XElement } from "./xml";

/** What the generator reads: the names of the parts and their text. */
export interface PartSource {
  names(): string[];
  text(name: string): string | undefined;
}

export interface Relationship {
  id: string;
  type: string;
  /** For an internal target, the resolved part name (`word/media/image1.png`). */
  target: string;
  external: boolean;
}

export interface Theme {
  colours: Map<string, string>;
  majorFont?: string;
  minorFont?: string;
  majorEastAsia?: string;
  minorEastAsia?: string;
  majorCs?: string;
  minorCs?: string;
}

export class Package {
  private readonly docs = new Map<string, XDocument | null>();
  private readonly rels = new Map<string, Map<string, Relationship>>();
  private themeCache: Theme | undefined;
  readonly mainPart: string;

  constructor(readonly source: PartSource) {
    this.mainPart = this.findMainPart();
  }

  has(name: string): boolean {
    return this.source.names().includes(name);
  }

  /** Parsed part, or null if it is missing. */
  xml(name: string): XDocument | null {
    if (this.docs.has(name)) return this.docs.get(name)!;
    let doc: XDocument | null = null;
    const text = this.source.text(name);
    if (text !== undefined) doc = parseXml(text);
    this.docs.set(name, doc);
    return doc;
  }

  /** The relationships of a part, by id. */
  relsOf(part: string): Map<string, Relationship> {
    const cached = this.rels.get(part);
    if (cached) return cached;
    const map = new Map<string, Relationship>();
    this.rels.set(part, map);
    const slash = part.lastIndexOf("/");
    const dir = slash < 0 ? "" : part.slice(0, slash);
    const relsName = `${dir ? dir + "/" : ""}_rels/${part.slice(slash + 1)}.rels`;
    const doc = this.xml(relsName);
    for (const rel of elements(doc?.root)) {
      if (localName(rel.name) !== "Relationship") continue;
      const id = rel.attrs.Id ?? "";
      const external = rel.attrs.TargetMode === "External";
      const rawTarget = rel.attrs.Target ?? "";
      map.set(id, {
        id,
        type: (rel.attrs.Type ?? "").split("/").pop() ?? "",
        target: external ? rawTarget : resolvePartName(dir, rawTarget),
        external,
      });
    }
    return map;
  }

  /** The first part related to `part` with the given relationship type (last URI segment). */
  related(part: string, type: string): string | undefined {
    for (const rel of this.relsOf(part).values())
      if (rel.type === type && !rel.external) return rel.target;
    return undefined;
  }

  theme(): Theme {
    if (this.themeCache) return this.themeCache;
    const theme: Theme = { colours: new Map() };
    this.themeCache = theme;
    const name = this.related(this.mainPart, "theme") ?? "word/theme/theme1.xml";
    const root = this.xml(name)?.root;
    const elementsEl = child(root, "a:themeElements");
    const scheme = child(elementsEl, "a:clrScheme");
    for (const c of elements(scheme)) {
      const value = elements(c)[0];
      if (!value) continue;
      const hex = value.attrs.lastClr ?? value.attrs.val;
      if (hex) theme.colours.set(localName(c.name), hex.toUpperCase());
    }
    const fonts = child(elementsEl, "a:fontScheme");
    const font = (which: string, script: string) =>
      child(child(fonts, which), script)?.attrs.typeface || undefined;
    theme.majorFont = font("a:majorFont", "a:latin");
    theme.minorFont = font("a:minorFont", "a:latin");
    theme.majorEastAsia = font("a:majorFont", "a:ea");
    theme.minorEastAsia = font("a:minorFont", "a:ea");
    theme.majorCs = font("a:majorFont", "a:cs");
    theme.minorCs = font("a:minorFont", "a:cs");
    return theme;
  }

  private findMainPart(): string {
    const root = this.xml("_rels/.rels")?.root;
    for (const rel of elements(root)) {
      if (
        localName(rel.name) === "Relationship" &&
        (rel.attrs.Type ?? "").endsWith("/officeDocument")
      ) {
        return resolvePartName("", rel.attrs.Target ?? "");
      }
    }
    return "word/document.xml";
  }
}

/** Resolves a relationship target against the directory of its source part. */
export function resolvePartName(dir: string, target: string): string {
  if (target.startsWith("/")) return normalise(target.slice(1));
  return normalise(dir ? `${dir}/${target}` : target);
}

function normalise(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Applies DrawingML-style tint/shade (`w:themeTint`, `w:themeShade`, hex 00–FF). */
export function tintShade(hex: string, tint?: string, shade?: string): string {
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  let rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (shade) {
    const s = parseInt(shade, 16) / 255;
    if (Number.isFinite(s)) rgb = rgb.map((c) => c * s);
  }
  if (tint) {
    const t = parseInt(tint, 16) / 255;
    if (Number.isFinite(t)) rgb = rgb.map((c) => c * t + 255 * (1 - t));
  }
  return rgb.map((c) => Math.round(c).toString(16).padStart(2, "0").toUpperCase()).join("");
}

export type { XElement };
