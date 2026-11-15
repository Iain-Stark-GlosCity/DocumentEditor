/**
 * Rules that need a paragraph's effective formatting, resolved through document defaults, list
 * level, style chain and direct formatting (see ../explain.ts). Read from the main document only.
 */
import { effectiveIndent, paragraphStack } from "../explain";
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
    const raw = el?.attrs[name];
    if (raw !== undefined && Number.isFinite(Number(raw))) return Number(raw);
  }
  return undefined;
};

/** Text width in twips of the document's last section, if it states a page and margins. */
function textWidth(ctx: InspectContext, main: string): number | undefined {
  const sects = ctx
    .all(main, "w:sectPr")
    .filter((s) => !s.parent || s.parent.name !== "w:pPrChange");
  const sect = sects[sects.length - 1];
  const width = num(child(sect, "w:pgSz"), "w:w");
  const mar = child(sect, "w:pgMar");
  const left = num(mar, "w:left") ?? 0;
  const right = num(mar, "w:right") ?? 0;
  if (width === undefined) return undefined;
  const text = width - left - right;
  return text > 0 ? text : undefined;
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
      const differs = (names: string[]) => {
        const mine = num(ind, ...names);
        return mine !== undefined && mine !== (num(level, ...names) ?? 0);
      };
      if (differs(["w:left", "w:start"]) || differs(["w:hanging"]) || differs(["w:firstLine"]))
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
    const width = textWidth(ctx, m.main);
    if (width === undefined) return;
    const hits: Hit[] = [];
    for (const p of ctx.all(m.main, "w:p")) {
      // Paragraphs in tables are laid out inside cells whose width we do not resolve.
      if (ancestor(p, "w:tc")) continue;
      const stack = paragraphStack(p, m.styles, m.numbering);
      const left = effectiveIndent(stack, "left")?.twips ?? 0;
      const right = effectiveIndent(stack, "right")?.twips ?? 0;
      if (left < 0 || right < 0 || left + right >= width * EXTREME_FRACTION)
        hits.push({ part: m.main, el: p, label: "paragraph" });
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
      facts: { count: hits.length, textWidthTwips: width },
    });
  },
};

export const paragraphRules: Rule[] = [overridesList, extreme];
