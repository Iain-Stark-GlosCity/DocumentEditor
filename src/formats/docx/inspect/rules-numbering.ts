/**
 * Numbering rules: list references that lead nowhere, impossible levels, and the slow build-up of
 * list definitions that makes Word's numbering unpredictable. Read from numbering.xml (the main
 * document's `numbering` relationship), styles.xml and every part that holds content.
 */
import { Styles } from "../styles";
import { child, type XElement } from "../xml";
import { groupBy, plural, type Hit, type InspectContext } from "./context";
import { readStyles } from "./rules-styles";
import type { Rule } from "./rule";

const FAMILY = "numbering";

/**
 * More list instances (`w:num`) than this is reported as numbering proliferation. Word adds an
 * instance each time a list is restarted or pasted in from elsewhere; an ordinary long document
 * has a few dozen. Past fifty, "continue numbering" and "restart at 1" start to pick surprising
 * neighbours, and the definitions are usually the residue of years of copy and paste.
 */
export const MANY_NUMS = 50;

interface NumInfo {
  id: string;
  el: XElement;
  abstractId?: string;
  abstractEl?: XElement;
}

interface NumberingModel {
  part?: string;
  nums: Map<string, NumInfo>;
  abstracts: Map<string, XElement>;
  /** Every `w:numPr` that names a list, in content and in styles. */
  refs: { part: string; numPr: XElement; numId?: XElement; ilvl?: XElement }[];
}

function model(ctx: InspectContext): NumberingModel {
  return ctx.memo("numbering", () => {
    const main = ctx.main();
    const part = main ? ctx.related(main, "numbering") : undefined;
    const nums = new Map<string, NumInfo>();
    const abstracts = new Map<string, XElement>();
    const root = part ? ctx.xml(part)?.root : undefined;
    if (part && root) {
      for (const el of ctx.all(part, "w:abstractNum")) {
        if (el.parent !== root) continue;
        const id = el.attrs["w:abstractNumId"] ?? "";
        if (!abstracts.has(id)) abstracts.set(id, el);
      }
      for (const el of ctx.all(part, "w:num")) {
        if (el.parent !== root) continue;
        const id = el.attrs["w:numId"] ?? "";
        const abstractEl = child(el, "w:abstractNumId");
        if (!nums.has(id))
          nums.set(id, { id, el, abstractEl, abstractId: abstractEl?.attrs["w:val"] });
      }
    }
    const refs: NumberingModel["refs"] = [];
    const parts = ctx.stories();
    const styles = readStyles(ctx);
    if (styles) parts.push(styles.part);
    for (const p of parts)
      for (const numPr of ctx.all(p, "w:numPr"))
        refs.push({ part: p, numPr, numId: child(numPr, "w:numId"), ilvl: child(numPr, "w:ilvl") });
    return { part, nums, abstracts, refs };
  });
}

const undefinedNums: Rule = {
  name: "undefined-numbering",
  codes: ["numbering.undefined-num", "numbering.missing-abstract"],
  run(ctx) {
    const m = model(ctx);
    const dangling = m.refs.filter((r) => {
      const id = r.numId?.attrs["w:val"];
      return id !== undefined && id !== "" && id !== "0" && !m.nums.has(id);
    });
    for (const [id, refs] of groupBy(dangling, (r) => r.numId!.attrs["w:val"]!)) {
      ctx.report({
        rule: "numbering.undefined-num",
        severity: "error",
        family: FAMILY,
        title: `${plural(refs.length, "paragraph or style", "paragraphs or styles")} ${refs.length === 1 ? "uses" : "use"} list ${id}, which ${m.part ? `${m.part} does not define` : "is not defined (the document has no numbering part)"}`,
        why: "A numbered or bulleted paragraph names its list by numId. This list does not exist, so Word shows the paragraphs without their numbers or bullets, and the list structure is lost.",
        key: id,
        hits: refs.map((r) => ({ part: r.part, el: r.numId, label: `numId ${id}` })),
        facts: { numId: id, count: refs.length },
      });
    }
    for (const num of m.nums.values()) {
      if (num.abstractId !== undefined && m.abstracts.has(num.abstractId)) continue;
      ctx.report({
        rule: "numbering.missing-abstract",
        severity: "error",
        family: FAMILY,
        title: `List ${num.id} is based on list definition ${num.abstractId ?? "(none)"}, which is not defined`,
        why: "Each list instance (w:num) takes its levels, number formats and indents from an abstract list definition. Without one the list has no formatting, and Word drops its numbering.",
        key: num.id,
        hits: [{ part: m.part!, el: num.abstractEl ?? num.el, label: `list ${num.id}` }],
        facts: { numId: num.id },
      });
    }
  },
};

const levels: Rule = {
  name: "numbering-levels",
  codes: ["numbering.level-out-of-range"],
  run(ctx) {
    const m = model(ctx);
    const bad = (v: string | undefined) => v !== undefined && !/^[0-8]$/.test(v.trim());
    const hits: Hit[] = [];
    for (const r of m.refs)
      if (bad(r.ilvl?.attrs["w:val"]))
        hits.push({ part: r.part, el: r.ilvl, label: `level ${r.ilvl!.attrs["w:val"]}` });
    if (m.part)
      for (const name of ["w:lvl", "w:lvlOverride"])
        for (const el of ctx.all(m.part, name))
          if (bad(el.attrs["w:ilvl"]))
            hits.push({ part: m.part, el, label: `level ${el.attrs["w:ilvl"]}` });
    if (hits.length === 0) return;
    ctx.report({
      rule: "numbering.level-out-of-range",
      severity: "warning",
      family: FAMILY,
      title: `${plural(hits.length, "list level")} outside the nine levels Word supports`,
      why: "Word lists have nine levels, numbered 0 to 8. A paragraph or definition on any other level is shown at a level Word chooses, or without its number.",
      key: "levels",
      hits,
      facts: { count: hits.length },
    });
  },
};

const hygiene: Rule = {
  name: "numbering-hygiene",
  codes: ["numbering.proliferation", "numbering.unused-definitions", "numbering.restart-overrides"],
  run(ctx) {
    const m = model(ctx);
    if (!m.part) return;
    const part = m.part;
    if (m.nums.size > MANY_NUMS)
      ctx.report({
        rule: "numbering.proliferation",
        severity: "info",
        family: FAMILY,
        title: `${m.nums.size} list instances and ${m.abstracts.size} list definitions`,
        why: `Word adds a list instance each time a list is restarted or pasted in. More than ${MANY_NUMS} usually means years of copy and paste; lists may then continue or restart in surprising places, and cleaning up with "Define new list" helps.`,
        key: "many",
        hits: [{ part, el: ctx.xml(part)?.root ?? undefined }],
        facts: { nums: m.nums.size, abstracts: m.abstracts.size },
      });

    const usedNums = new Set(m.refs.map((r) => r.numId?.attrs["w:val"]).filter((v) => v));
    const unusedNums = [...m.nums.values()].filter((n) => !usedNums.has(n.id));
    const referencedAbstracts = new Set([...m.nums.values()].map((n) => n.abstractId));
    // List-style definitions (styleLink / numStyleLink) are reached through styles; leave them be.
    const unusedAbstracts = [...m.abstracts].filter(
      ([id, el]) =>
        !referencedAbstracts.has(id) && !child(el, "w:styleLink") && !child(el, "w:numStyleLink"),
    );
    if (unusedNums.length + unusedAbstracts.length > 0)
      ctx.report({
        rule: "numbering.unused-definitions",
        severity: "info",
        family: FAMILY,
        title: `${[
          unusedNums.length > 0 ? plural(unusedNums.length, "list instance") : "",
          unusedAbstracts.length > 0 ? plural(unusedAbstracts.length, "list definition") : "",
        ]
          .filter((s) => s)
          .join(
            " and ",
          )} ${unusedNums.length + unusedAbstracts.length === 1 ? "is" : "are"} not used`,
        why: "Unused list definitions are harmless, but they accumulate from pasting and editing, and make the numbering harder to repair by hand.",
        key: "unused",
        hits: [
          ...unusedNums.map((n) => ({ part, el: n.el, label: `list ${n.id}` })),
          ...unusedAbstracts.map(([id, el]) => ({ part, el, label: `list definition ${id}` })),
        ],
        facts: {
          unusedNums: unusedNums.length,
          unusedAbstracts: unusedAbstracts.length,
          count: unusedNums.length + unusedAbstracts.length,
        },
      });

    const restarts: Hit[] = [];
    for (const num of m.nums.values())
      for (const o of num.el.children)
        if (typeof o !== "string" && o.name === "w:lvlOverride" && child(o, "w:startOverride"))
          restarts.push({ part, el: o, label: `list ${num.id}` });
    if (restarts.length > 0)
      ctx.report({
        rule: "numbering.restart-overrides",
        severity: "info",
        family: FAMILY,
        title: `${plural(restarts.length, "list level")} ${restarts.length === 1 ? "is" : "are"} forced to restart by a start override`,
        why: 'A start override makes a list instance begin again at a fixed number, which is how Word records "Restart at 1" and "Set numbering value". If a list restarts or continues unexpectedly, look here.',
        key: "restarts",
        hits: restarts,
        facts: { count: restarts.length },
      });
  },
};

const styleDisagreement: Rule = {
  name: "numbering-vs-style",
  codes: ["numbering.direct-differs-from-style"],
  run(ctx) {
    const m = model(ctx);
    const info = readStyles(ctx);
    if (!info) return;
    const styles = new Styles(ctx.xml(info.part)?.root);
    const hits: Hit[] = [];
    for (const r of m.refs) {
      if (r.part === info.part) continue;
      const numId = r.numId?.attrs["w:val"];
      if (numId === undefined || numId === "0") continue;
      const pPr = r.numPr.parent;
      if (!pPr || pPr.name !== "w:pPr") continue;
      const styleId = child(pPr, "w:pStyle")?.attrs["w:val"];
      const fromStyle = styles.numbering(styleId)?.numId;
      if (fromStyle === undefined || fromStyle === "0" || fromStyle === numId) continue;
      hits.push({
        part: r.part,
        el: r.numPr,
        label: `list ${numId}, style ${styleId} uses list ${fromStyle}`,
      });
    }
    if (hits.length === 0) return;
    ctx.report({
      rule: "numbering.direct-differs-from-style",
      severity: "info",
      family: FAMILY,
      title: `${plural(hits.length, "paragraph")} ${hits.length === 1 ? "has" : "have"} direct numbering that differs from ${hits.length === 1 ? "its" : "their"} style's list`,
      why: "The paragraph style puts the paragraph in one list, and numbering applied directly puts it in another. The direct numbering wins, so restyling or updating the style will not change these paragraphs' numbers.",
      key: "vs-style",
      hits,
      facts: { count: hits.length },
    });
  },
};

export const numberingRules: Rule[] = [undefinedNums, levels, hygiene, styleDisagreement];
