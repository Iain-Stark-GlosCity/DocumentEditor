/**
 * Rules that need a paragraph's effective formatting, resolved through document defaults, list
 * level, style chain and direct formatting (see ../explain.ts). Read from the main document only.
 */
import { effectiveIndent, paragraphStack, parseTwips } from "../explain";
import { Numbering } from "../numbering";
import { Styles } from "../styles";
import { child, type XElement } from "../xml";
import { ancestor, plural, type Hit, type InspectContext } from "./context";
import type { Rule } from "./rule";

const FAMILY = "formatting";

/** A paragraph's indents at least this fraction of the text width are reported. */
export const EXTREME_FRACTION = 0.8;
const MAX_HITS = 200;

interface Models {
  main: string;
  styles: Styles;
  numbering: Numbering;
}

function models(ctx: InspectContext): Models | null {
  return ctx.memo("paragraph-models", () => {
    const main = ctx.main();
    if (!main) return null;
    const stylesPart = ctx.related(main, "styles");
    const numberingPart = ctx.related(main, "numbering");
    const styles = new Styles(stylesPart ? ctx.xml(stylesPart)?.root : null);
    const numbering = new Numbering(numberingPart ? ctx.xml(numberingPart)?.root : null, styles);
    return { main, styles, numbering };
  });
}

const num = (el: XElement | undefined, ...names: string[]): number | undefined => {
  for (const name of names) {
    const n = parseTwips(el?.attrs[name]);
    if (n !== undefined) return n;
  }
  return undefined;
};

/**
 * First-line indent as one signed number (positive first line, negative hanging), so a hanging
 * indent and a first-line indent compare like with like. Undefined when `w:ind` states neither.
 */
function firstLineOf(ind: XElement | undefined): number | undefined {
  const hanging = num(ind, "w:hanging");
  const first = num(ind, "w:firstLine");
  if (hanging !== undefined && hanging !== 0) return -hanging;
  if (first !== undefined) return first;
  return hanging;
}

/** Text width in twips of a section, less its gutter; for several columns, the narrowest column. */
function columnWidth(sect: XElement | undefined): number | undefined {
  const width = num(child(sect, "w:pgSz"), "w:w");
  const mar = child(sect, "w:pgMar");
  if (width === undefined) return undefined;
  const text =
    width - (num(mar, "w:left") ?? 0) - (num(mar, "w:right") ?? 0) - (num(mar, "w:gutter") ?? 0);
  if (!(text > 0)) return undefined;
  const cols = child(sect, "w:cols");
  const count = Math.floor(num(cols, "w:num") ?? 1);
  if (count <= 1) return text;
  const listed = (cols?.children ?? [])
    .filter((c): c is XElement => typeof c !== "string" && c.name === "w:col")
    .map((c) => num(c, "w:w"))
    .filter((w): w is number => w !== undefined && w > 0);
  if (listed.length > 0 && cols?.attrs["w:equalWidth"] !== "1") return Math.min(...listed);
  const col = (text - (num(cols, "w:space") ?? 720) * (count - 1)) / count;
  return col > 0 ? col : undefined;
}

const overridesList: Rule = {
  name: "indent-overrides-list",
  codes: ["formatting.indent-overrides-list"],
  run(ctx) {
    const m = models(ctx);
    if (!m) return;
    const hits: Hit[] = [];
    for (const p of ctx.all(m.main, "w:p")) {
      const direct = child(p, "w:pPr");
      const ind = child(direct, "w:ind");
      if (!ind) continue;
      const stack = paragraphStack(p, m.styles, m.numbering);
      if (!stack.list || !stack.listLayer) continue;
      const level = child(stack.listLayer.pPr, "w:ind");
      // Only a value the level itself sets can be overridden, and only like with like: start
      // against left, and the signed first-line value (hanging against first line).
      const differs = (mine: number | undefined, theirs: number | undefined) =>
        mine !== undefined && theirs !== undefined && mine !== theirs;
      if (
        differs(num(ind, "w:left", "w:start"), num(level, "w:left", "w:start")) ||
        differs(firstLineOf(ind), firstLineOf(level))
      )
        hits.push({ part: m.main, el: p, label: "paragraph" });
    }
    if (hits.length === 0) return;
    ctx.report({
      rule: "formatting.indent-overrides-list",
      severity: "info",
      family: FAMILY,
      title: `${plural(hits.length, "list paragraph")} ${hits.length === 1 ? "has" : "have"} an indent that differs from its list level`,
      why: "The list level sets where the number and text sit. A direct indent on the paragraph overrides it, so these items no longer line up with the rest of the list. This is often someone nudging an item by hand. Open Explain this paragraph on one to see both values.",
      key: "overrides-list",
      hits: hits.slice(0, MAX_HITS),
      facts: { count: hits.length },
    });
  },
};

const extreme: Rule = {
  name: "extreme-indent",
  codes: ["formatting.extreme-indent"],
  run(ctx) {
    const m = models(ctx);
    if (!m) return;
    const body = child(ctx.xml(m.main)?.root, "w:body");
    const paragraphs = ctx.all(m.main, "w:p");
    // A section's properties sit in the last paragraph of that section; the final section's in the
    // body. Walking backwards, the first section break at or after a paragraph is its section's.
    const widths = new Map<XElement, number | undefined>();
    let sect = child(body, "w:sectPr");
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const p = paragraphs[i]!;
      sect = child(child(p, "w:pPr"), "w:sectPr") ?? sect;
      widths.set(p, columnWidth(sect));
    }
    const hits: Hit[] = [];
    let shown: number | undefined;
    for (const p of paragraphs) {
      // Tables and text boxes lay their paragraphs out in a width we do not resolve.
      if (ancestor(p, "w:tc") || ancestor(p, "w:txbxContent")) continue;
      const stack = paragraphStack(p, m.styles, m.numbering);
      const l = effectiveIndent(stack, "left");
      const r = effectiveIndent(stack, "right");
      // Word uses character units, when stated, instead of the twips.
      if (l?.inChars || r?.inChars) continue;
      const left = l?.twips ?? 0;
      const right = r?.twips ?? 0;
      const width = widths.get(p);
      if (
        left < 0 ||
        right < 0 ||
        (width !== undefined && left + right >= width * EXTREME_FRACTION)
      ) {
        hits.push({ part: m.main, el: p, label: "paragraph" });
        shown ??= width;
      }
    }
    if (hits.length === 0) return;
    ctx.report({
      rule: "formatting.extreme-indent",
      severity: "warning",
      family: FAMILY,
      title: `${plural(hits.length, "paragraph")} ${hits.length === 1 ? "has" : "have"} an indent that is negative or leaves almost no room for text`,
      why: "The indents of these paragraphs, once the style, list and direct formatting are combined, are negative or take up most of the page width. The text may be squeezed into a narrow column or pushed into the margin. Open Explain this paragraph to see where each value comes from.",
      key: "extreme",
      hits: hits.slice(0, MAX_HITS),
      facts: { count: hits.length, ...(shown !== undefined ? { textWidthTwips: shown } : {}) },
    });
  },
};

export const paragraphRules: Rule[] = [overridesList, extreme];
