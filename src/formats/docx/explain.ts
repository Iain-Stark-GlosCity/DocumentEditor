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

/** The layers that format a paragraph (see the file comment). */
export function paragraphStack(p: XElement, styles: Styles, numbering: Numbering): ParagraphStack {
  const direct = child(p, "w:pPr");
  const styleId = child(direct, "w:pStyle")?.attrs["w:val"] ?? styles.defaults.paragraph;

  const layers: Layer[] = [{ source: { label: "Document defaults" }, pPr: styles.docDefaultsP }];
  const styleLayers: Layer[] = styleId
    ? styles
        .chain(styleId)
        .reverse()
        .map((def) => ({ source: { label: `Style "${def.name}"` }, pPr: child(def.el, "w:pPr") }))
    : [];

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

export function explainParagraph(
  source: PartSource,
  part: string,
  locator: string,
): Explanation | null {
  const pkg = new Package(source);
  const p = findByLocator(pkg.xml(part)?.root ?? null, locator);
  if (!p || p.name !== "w:p") return null;

  const main = pkg.mainPart;
  const stylesPart = pkg.related(main, "styles") ?? "word/styles.xml";
  const numberingPart = pkg.related(main, "numbering") ?? "word/numbering.xml";
  const styles = new Styles(pkg.xml(stylesPart)?.root);
  const numbering = new Numbering(pkg.xml(numberingPart)?.root, styles);

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
        row(
          prop.label,
          candidates(main_, prop.read, partOf),
          alt ? candidates(alt, prop.read, partOf) : undefined,
        ),
      ),
    }),
  );

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
