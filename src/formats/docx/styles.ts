/**
 * Styles (styles.xml): the definitions by id, and their resolved properties following `basedOn`
 * chains down to the document defaults.
 */
import { displayStyleName, isOn } from "./notation";
import { child, elements, type XElement } from "./xml";

export type StyleType = "paragraph" | "character" | "table" | "numbering";

export interface StyleDef {
  id: string;
  type: StyleType;
  name: string;
  basedOn?: string;
  next?: string;
  link?: string;
  isDefault: boolean;
  el: XElement;
}

/** Property elements by name, later ones having overridden earlier ones. */
export type PropMap = Map<string, XElement>;

/** Attributes of these merge one by one rather than the element replacing the earlier one. */
const MERGE_ATTRS = new Set(["w:rFonts", "w:ind", "w:spacing", "w:lang"]);

export class Styles {
  readonly byId = new Map<string, StyleDef>();
  readonly order: string[] = [];
  readonly defaults: Partial<Record<StyleType, string>> = {};
  docDefaultsP?: XElement;
  docDefaultsR?: XElement;
  latentCount = 0;
  private readonly cache = new Map<string, PropMap>();

  constructor(root: XElement | null | undefined) {
    if (!root) return;
    const docDefaults = child(root, "w:docDefaults");
    this.docDefaultsP = child(child(docDefaults, "w:pPrDefault"), "w:pPr");
    this.docDefaultsR = child(child(docDefaults, "w:rPrDefault"), "w:rPr");
    this.latentCount = elements(child(root, "w:latentStyles")).length;
    for (const el of elements(root)) {
      if (el.name !== "w:style") continue;
      const id = el.attrs["w:styleId"] ?? "";
      const type = (el.attrs["w:type"] ?? "paragraph") as StyleType;
      const val = (name: string) => child(el, name)?.attrs["w:val"];
      const def: StyleDef = {
        id,
        type,
        name: displayStyleName(val("w:name") ?? id),
        basedOn: val("w:basedOn"),
        next: val("w:next"),
        link: val("w:link"),
        isDefault: el.attrs["w:default"] === "1" || el.attrs["w:default"] === "true",
        el,
      };
      if (!this.byId.has(id)) this.order.push(id);
      this.byId.set(id, def);
      if (def.isDefault && !this.defaults[type]) this.defaults[type] = id;
    }
  }

  get(id: string | undefined): StyleDef | undefined {
    return id === undefined ? undefined : this.byId.get(id);
  }

  name(id: string): string {
    return this.byId.get(id)?.name ?? id;
  }

  /** The `basedOn` chain, the style itself first. Stops at a cycle. */
  chain(id: string): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = this.byId.get(id);
    while (cur && !seen.has(cur.id) && out.length < 50) {
      seen.add(cur.id);
      out.push(cur);
      cur = cur.basedOn ? this.byId.get(cur.basedOn) : undefined;
    }
    return out;
  }

  /**
   * The resolved properties of `which` (`w:pPr`, `w:rPr`, `w:tblPr`, `w:trPr`, `w:tcPr`) for a
   * style, document defaults first for paragraph and run properties.
   */
  resolved(id: string, which: string, withDefaults = true): PropMap {
    const key = `${id}\u0000${which}\u0000${withDefaults}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const map: PropMap = new Map();
    if (withDefaults) {
      if (which === "w:pPr") mergeInto(map, this.docDefaultsP);
      if (which === "w:rPr") mergeInto(map, this.docDefaultsR);
    }
    for (const def of this.chain(id).reverse()) mergeInto(map, child(def.el, which));
    this.cache.set(key, map);
    return map;
  }

  /** The heading level (1–9) a paragraph style gives, from its outline level or its name. */
  headingLevel(id: string | undefined): number | undefined {
    if (id === undefined) return undefined;
    const outline = this.resolved(id, "w:pPr", false).get("w:outlineLvl")?.attrs["w:val"];
    if (outline !== undefined) {
      const n = Number(outline);
      return Number.isFinite(n) && n >= 0 && n < 9 ? n + 1 : undefined;
    }
    for (const def of this.chain(id)) {
      const m = /^heading ([1-9])$/i.exec(def.name);
      if (m) return Number(m[1]);
    }
    return undefined;
  }

  isQuote(id: string | undefined): boolean {
    if (id === undefined) return false;
    return this.chain(id).some((d) => /quote/i.test(d.name));
  }

  /** `numId` and level from a paragraph style's (inherited) numbering. */
  numbering(id: string | undefined): { numId: string; ilvl: number } | undefined {
    if (id === undefined) return undefined;
    const numPr = this.resolved(id, "w:pPr", false).get("w:numPr");
    const numId = child(numPr, "w:numId")?.attrs["w:val"];
    if (numId === undefined) return undefined;
    return { numId, ilvl: Number(child(numPr, "w:ilvl")?.attrs["w:val"] ?? 0) || 0 };
  }

  isOn(map: PropMap, name: string): boolean {
    return isOn(map.get(name)) === true;
  }
}

/** A synthetic element, for merged attributes. */
function synthetic(name: string, attrs: Record<string, string>, base: XElement): XElement {
  return {
    name,
    rawName: name,
    attrs,
    children: base.children,
    parent: base.parent,
    start: base.start,
    end: base.end,
  };
}

export function mergeInto(map: PropMap, container: XElement | undefined): void {
  for (const el of elements(container)) {
    const prev = map.get(el.name);
    if (prev && MERGE_ATTRS.has(el.name))
      map.set(el.name, synthetic(el.name, { ...prev.attrs, ...el.attrs }, el));
    else {
      map.delete(el.name); // Keep the order of the latest definition.
      map.set(el.name, el);
    }
  }
}

/** A property map as a container element, so the describer can read it. */
export function asContainer(name: string, map: PropMap): XElement {
  const children = [...map.values()];
  return { name, rawName: name, attrs: {}, children, parent: null, start: 0, end: 0 };
}
