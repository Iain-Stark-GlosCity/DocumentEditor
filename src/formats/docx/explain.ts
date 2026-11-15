/**
 * "Why does this paragraph look like that?": resolves a paragraph's indentation, spacing and
 * alignment through the layers Word applies, and says which layer won each value.
 *
 * Layers, weakest first: document defaults, the list level (when the paragraph is in a list), the
 * paragraph style and the styles it is based on, direct formatting. Where Word's precedence is not
 * certain (a list that comes from the style) the row is marked uncertain and says what the other
 * order would give. Not covered: table styles, conditional formatting, and character-unit indents.
 * Pure and tolerant: it never throws on a damaged part.
 */
import type {
  Explanation,
  ExplanationRow,
  ExplanationSection,
  ExplanationSource,
} from "../../core/explain";
import { Numbering } from "./numbering";
import { Package, type PartSource } from "./package";
import { Styles } from "./styles";
import { child, locatorOf, type XElement } from "./xml";

export interface Layer {
  source: ExplanationSource;
  /** The `w:pPr` this layer contributes (a style's, a list level's, the paragraph's own). */
  pPr: XElement | undefined;
}

const TWIPS_PER_PT = 20;
const TWIPS_PER_CM = 567;

export function describeTwips(twips: number): string {
  const cm = twips / TWIPS_PER_CM;
  const pt = twips / TWIPS_PER_PT;
  const round = (n: number) => String(Math.round(n * 100) / 100);
  return `${round(cm)} cm (${round(pt)} pt)`;
}

const JC: Record<string, string> = {
  left: "left",
  start: "left",
  right: "right",
  end: "right",
  center: "centred",
  both: "justified",
  distribute: "distributed",
  justify: "justified",
};

type Reader = (pPr: XElement | undefined) => { value: string; el: XElement } | undefined;

function attr(
  name: string,
  ...attrNames: string[]
): (pPr: XElement | undefined) => { raw: string; el: XElement } | undefined {
  return (pPr) => {
    const el = child(pPr, name);
    if (!el) return undefined;
    for (const a of attrNames) if (el.attrs[a] !== undefined) return { raw: el.attrs[a], el };
    return undefined;
  };
}

function twipsReader(read: ReturnType<typeof attr>): Reader {
  return (pPr) => {
    const hit = read(pPr);
    if (!hit) return undefined;
    const n = Number(hit.raw);
    return Number.isFinite(n) ? { value: describeTwips(n), el: hit.el } : undefined;
  };
}

/** First line and hanging share one property: the later of the two wins, and replaces the other. */
const firstLine: Reader = (pPr) => {
  const ind = child(pPr, "w:ind");
  if (!ind) return undefined;
  const hanging = ind.attrs["w:hanging"];
  const first = ind.attrs["w:firstLine"];
  if (hanging !== undefined && Number(hanging) !== 0 && Number.isFinite(Number(hanging)))
    return { value: `hanging ${describeTwips(Number(hanging))}`, el: ind };
  if (first !== undefined && Number.isFinite(Number(first)) && Number(first) !== 0)
    return { value: `first line ${describeTwips(Number(first))}`, el: ind };
  if (hanging !== undefined || first !== undefined) return { value: "none", el: ind };
  return undefined;
};

const lineSpacing: Reader = (pPr) => {
  const sp = child(pPr, "w:spacing");
  const line = Number(sp?.attrs["w:line"]);
  if (!sp || sp.attrs["w:line"] === undefined || !Number.isFinite(line)) return undefined;
  const rule = sp.attrs["w:lineRule"] ?? "auto";
  const round = (n: number) => String(Math.round(n * 100) / 100);
  if (rule === "auto") return { value: `${round(line / 240)} lines`, el: sp };
  return {
    value: `${rule === "atLeast" ? "at least" : "exactly"} ${round(line / TWIPS_PER_PT)} pt`,
    el: sp,
  };
};

const alignment: Reader = (pPr) => {
  const jc = child(pPr, "w:jc");
  const val = jc?.attrs["w:val"];
  return jc && val !== undefined ? { value: JC[val] ?? val, el: jc } : undefined;
};

const PROPERTIES: {
  label: string;
  read: Reader;
  group: "Indentation" | "Spacing" | "Alignment";
}[] = [
  {
    label: "Left indent",
    read: twipsReader(attr("w:ind", "w:left", "w:start")),
    group: "Indentation",
  },
  {
    label: "Right indent",
    read: twipsReader(attr("w:ind", "w:right", "w:end")),
    group: "Indentation",
  },
  { label: "First line", read: firstLine, group: "Indentation" },
  { label: "Space before", read: twipsReader(attr("w:spacing", "w:before")), group: "Spacing" },
  { label: "Space after", read: twipsReader(attr("w:spacing", "w:after")), group: "Spacing" },
  { label: "Line spacing", read: lineSpacing, group: "Spacing" },
  { label: "Alignment", read: alignment, group: "Alignment" },
];

interface Candidate {
  source: ExplanationSource;
  value: string;
}

/** Every layer that sets the property, weakest first. */
function candidates(layers: Layer[], read: Reader, part: (el: XElement) => string): Candidate[] {
  const out: Candidate[] = [];
  for (const layer of layers) {
    const hit = read(layer.pPr);
    if (!hit) continue;
    out.push({
      source: {
        ...layer.source,
        part: layer.source.part ?? part(hit.el),
        locator: locatorOf(hit.el),
      },
      value: hit.value,
    });
  }
  return out;
}

function row(label: string, cands: Candidate[], alt?: Candidate[]): ExplanationRow {
  if (cands.length === 0) return { label, value: "not set" };
  const win = cands[cands.length - 1]!;
  const out: ExplanationRow = { label, value: win.value, source: win.source };
  const lost = cands
    .slice(0, -1)
    .reverse()
    .filter((c) => c.value !== win.value || c.source.label !== win.source.label);
  if (lost.length > 0) out.overridden = lost.map((c) => ({ source: c.source, value: c.value }));
  const altWin = alt?.[alt.length - 1];
  if (altWin && altWin.value !== win.value) {
    out.uncertain = true;
    out.note = `If Word applies the list level after the style, this would be ${altWin.value} (from ${altWin.source.label}). Check in Word's Paragraph dialog.`;
  }
  return out;
}

/** The element a locator names, read against the names as written in the part. */
export function findByLocator(root: XElement | null, locator: string): XElement | null {
  if (!root || !locator.startsWith("/")) return null;
  const steps = locator.slice(1).split("/");
  const first = /^(.*?)(?:\[(\d+)\])?$/.exec(steps[0] ?? "");
  if (!first || first[1] !== root.rawName) return null;
  let cur: XElement = root;
  for (const step of steps.slice(1)) {
    const m = /^(.*?)(?:\[(\d+)\])?$/.exec(step);
    if (!m) return null;
    const want = Number(m[2] ?? 1);
    let n = 0;
    let found: XElement | null = null;
    for (const c of cur.children) {
      if (typeof c === "string" || c.rawName !== m[1]) continue;
      if (++n === want) {
        found = c;
        break;
      }
    }
    if (!found) return null;
    cur = found;
  }
  return cur;
}

const FIXES: Record<string, { element: string; label: string; what: string }> = {
  Indentation: {
    element: "w:ind",
    label: "Remove this paragraph's own indent",
    what: "the w:ind element (left, right and first-line indents)",
  },
  Spacing: {
    element: "w:spacing",
    label: "Remove this paragraph's own spacing",
    what: "the w:spacing element (space before, space after and line spacing)",
  },
  Alignment: {
    element: "w:jc",
    label: "Remove this paragraph's own alignment",
    what: "the w:jc element (alignment)",
  },
};

/** Offers to delete the paragraph's own element when it is what decides a row. */
function withFix(row: ExplanationRow, group: string): ExplanationRow {
  const src = row.source;
  const fix = FIXES[group];
  if (fix && src?.label === "Direct formatting" && src.part && src.locator?.endsWith(fix.element))
    row.fix = {
      label: fix.label,
      detail: `Deletes ${fix.what} from the paragraph so the style or list decides again. The edit appears in the XML tab: undo with Ctrl+Z, or save with Ctrl+S (a backup of the file is kept).`,
      part: src.part,
      locator: src.locator,
    };
  return row;
}

export interface ParagraphStack {
  direct: XElement | undefined;
  styleId: string | undefined;
  list: { numId: string; ilvl: number; fromStyle: boolean } | undefined;
  listLayer: Layer | undefined;
  /** Layers weakest first, in the order we believe Word applies them. */
  main_: Layer[];
  /** The same with the list level and style swapped, when that order is uncertain. */
  alt: Layer[] | undefined;
}

/**
 * The style chain as layers, weakest first. A document has few styles and many paragraphs, so the
 * layers are built once per style and shared; they are never modified. Keyed on the `Styles`
 * object, so a different file (or a re-read of the same one) starts afresh.
 */
const styleLayerCache = new WeakMap<Styles, Map<string, Layer[]>>();

function styleLayersOf(styles: Styles, styleId: string): Layer[] {
  let perStyle = styleLayerCache.get(styles);
  if (!perStyle) styleLayerCache.set(styles, (perStyle = new Map()));
  let layers = perStyle.get(styleId);
  if (!layers) {
    layers = styles
      .chain(styleId)
      .reverse()
      .map((def) => ({ source: { label: `Style "${def.name}"` }, pPr: child(def.el, "w:pPr") }));
    perStyle.set(styleId, layers);
  }
  return layers;
}

/** The layers that format a paragraph (see the file comment). */
export function paragraphStack(p: XElement, styles: Styles, numbering: Numbering): ParagraphStack {
  const direct = child(p, "w:pPr");
  const styleId = child(direct, "w:pStyle")?.attrs["w:val"] ?? styles.defaults.paragraph;

  const layers: Layer[] = [{ source: { label: "Document defaults" }, pPr: styles.docDefaultsP }];
  const styleLayers: Layer[] = styleId ? styleLayersOf(styles, styleId) : [];

  // The list the paragraph is in: its own numPr, else the style's.
  const directNum = child(direct, "w:numPr");
  const directNumId = child(directNum, "w:numId")?.attrs["w:val"];
  const styleNum = styleId ? styles.numbering(styleId) : undefined;
  let list: { numId: string; ilvl: number; fromStyle: boolean } | undefined;
  if (directNumId !== undefined) {
    if (directNumId !== "0")
      list = {
        numId: directNumId,
        ilvl: Number(child(directNum, "w:ilvl")?.attrs["w:val"] ?? styleNum?.ilvl ?? 0) || 0,
        fromStyle: false,
      };
  } else if (styleNum && styleNum.numId !== "0") {
    list = { ...styleNum, fromStyle: true };
  }

  let listLayer: Layer | undefined;
  if (list) {
    const level = numbering.level(list.numId, list.ilvl);
    if (level) {
      listLayer = {
        source: { label: `List level ${list.ilvl + 1} (list ${list.numId})` },
        pPr: child(level.el, "w:pPr"),
      };
    }
  }

  const directLayer: Layer = { source: { label: "Direct formatting" }, pPr: direct };
  const order = (listFirst: boolean): Layer[] => [
    ...layers,
    ...(listLayer && listFirst ? [listLayer] : []),
    ...styleLayers,
    ...(listLayer && !listFirst ? [listLayer] : []),
    directLayer,
  ];
  // A list from direct formatting sits above the style; one from the style is uncertain.
  const main_ = order(listLayer !== undefined && list!.fromStyle);
  const alt = listLayer && list!.fromStyle ? order(false) : undefined;

  return { direct, styleId, list, listLayer, main_, alt };
}

/**
 * The parsed package, styles and numbering that explaining a paragraph needs. Building one is the
 * expensive part (the parts are parsed lazily and then kept); reuse it for the same bytes only.
 */
export interface ExplainContext {
  pkg: Package;
  styles: Styles;
  numbering: Numbering;
  stylesPart: string;
  numberingPart: string;
}

export function prepareExplain(source: PartSource): ExplainContext {
  const pkg = new Package(source);
  const main = pkg.mainPart;
  const stylesPart = pkg.related(main, "styles") ?? "word/styles.xml";
  const numberingPart = pkg.related(main, "numbering") ?? "word/numbering.xml";
  const styles = new Styles(pkg.xml(stylesPart)?.root);
  const numbering = new Numbering(pkg.xml(numberingPart)?.root, styles);
  return { pkg, styles, numbering, stylesPart, numberingPart };
}

export function explainParagraph(
  source: PartSource,
  part: string,
  locator: string,
): Explanation | null {
  return explainWith(prepareExplain(source), part, locator);
}

export function explainWith(
  context: ExplainContext,
  part: string,
  locator: string,
): Explanation | null {
  const { pkg, styles, numbering, stylesPart, numberingPart } = context;
  const p = findByLocator(pkg.xml(part)?.root ?? null, locator);
  if (!p || p.name !== "w:p") return null;

  const partOf = (el: XElement): string => {
    let top: XElement = el;
    while (top.parent) top = top.parent;
    if (top === pkg.xml(stylesPart)?.root) return stylesPart;
    if (top === pkg.xml(numberingPart)?.root) return numberingPart;
    return part;
  };

  const stack = paragraphStack(p, styles, numbering);
  const { direct, styleId, list, listLayer, main_, alt } = stack;
  const notes: string[] = [];
  if (list && !listLayer)
    notes.push(`The list this paragraph uses (${list.numId}) has no definition for its level.`);

  const sections: ExplanationSection[] = (["Indentation", "Spacing", "Alignment"] as const).map(
    (group) => ({
      heading: group,
      rows: PROPERTIES.filter((prop) => prop.group === group).map((prop) =>
        withFix(
          row(
            prop.label,
            candidates(main_, prop.read, partOf),
            alt ? candidates(alt, prop.read, partOf) : undefined,
          ),
          group,
        ),
      ),
    }),
  );

  // Rows that share an element (before, after and line spacing) offer its repair once, on the first.
  const offered = new Set<string>();
  for (const section of sections)
    for (const r of section.rows) {
      if (!r.fix) continue;
      const key = `${r.fix.part}\u0000${r.fix.locator}`;
      if (offered.has(key)) delete r.fix;
      else offered.add(key);
    }

  if (list) {
    const label = listLayer
      ? `level ${list.ilvl + 1} of list ${list.numId}${list.fromStyle ? ", from the paragraph style" : ""}`
      : `list ${list.numId}`;
    sections.unshift({
      heading: "Context",
      rows: [{ label: "In a list", value: label }],
    });
  }
  sections.unshift({
    heading: "Style",
    rows: [
      {
        label: "Paragraph style",
        value: styleId ? styles.name(styleId) : "none (Word's Normal)",
      },
    ],
  });

  if (
    child(direct, "w:ind")?.attrs &&
    Object.keys(child(direct, "w:ind")!.attrs).some((a) => /Chars$/.test(a))
  )
    notes.push(
      "This paragraph has indents in character units. Word uses those instead of the twip values shown.",
    );
  for (let a: XElement | null = p.parent; a; a = a.parent) {
    if (a.name === "w:tc") {
      notes.push("The paragraph is in a table: table styles and cell margins are not included.");
      break;
    }
  }
  notes.push("Text-box and conditional table formatting are not included.");

  return { title: "Paragraph formatting", sections, notes };
}

/** The effective left or right indent in twips, and the layer that set it. */
export function effectiveIndent(
  stack: ParagraphStack,
  side: "left" | "right",
): { twips: number; layer: string } | undefined {
  const names = side === "left" ? ["w:left", "w:start"] : ["w:right", "w:end"];
  let out: { twips: number; layer: string } | undefined;
  for (const layer of stack.main_) {
    const ind = child(layer.pPr, "w:ind");
    if (!ind) continue;
    for (const name of names) {
      const n = Number(ind.attrs[name]);
      if (ind.attrs[name] !== undefined && Number.isFinite(n)) {
        out = { twips: n, layer: layer.source.label };
        break;
      }
    }
  }
  return out;
}
