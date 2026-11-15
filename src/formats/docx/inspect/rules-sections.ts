/**
 * Section rules: headers and footers that cannot be found, first-page and even-page settings that
 * do not match the headers defined, and page setup that changes between sections. Read from the
 * main document's section properties (`w:sectPr`) and settings.xml.
 */
import { isOn } from "../notation";
import { child, type XElement } from "../xml";
import { plural, type Hit, type InspectContext } from "./context";
import type { Rule } from "./rule";

const FAMILY = "sections";

interface Section {
  sectPr: XElement;
  index: number;
}

/** The body's sections in order; the last one is the body's own `w:sectPr`. */
function sections(ctx: InspectContext): { main: string; body?: XElement; list: Section[] } | null {
  const main = ctx.main();
  if (!main) return null;
  const root = ctx.xml(main)?.root;
  const body = child(root ?? undefined, "w:body");
  const list = ctx
    .all(main, "w:sectPr")
    .filter((s) => s.parent?.name === "w:body" || s.parent?.name === "w:pPr")
    .map((sectPr, index) => ({ sectPr, index }));
  return { main, body, list };
}

const label = (s: Section, total: number) => `section ${s.index + 1} of ${total}`;

const headerFooter: Rule = {
  name: "header-footer-references",
  codes: ["sections.header-footer-missing"],
  run(ctx) {
    const info = sections(ctx);
    if (!info) return;
    const missing = new Map<string, { hits: Hit[]; reason: string; kind: string }>();
    for (const s of info.list)
      for (const ref of s.sectPr.children) {
        if (typeof ref === "string") continue;
        if (ref.name !== "w:headerReference" && ref.name !== "w:footerReference") continue;
        const id = ref.attrs["r:id"] ?? "";
        const rel = ctx.rel(info.main, id);
        let reason: string | undefined;
        if (!rel) reason = "has no relationship with this id";
        else if (!rel.external && !ctx.exists(rel.target))
          reason = `points at ${rel.target}, which is not in the package`;
        if (!reason) continue;
        const kind = ref.name === "w:headerReference" ? "header" : "footer";
        let entry = missing.get(id);
        if (!entry) missing.set(id, (entry = { hits: [], reason, kind }));
        entry.hits.push({
          part: info.main,
          el: ref,
          label: `${ref.attrs["w:type"] ?? "default"} ${kind}, ${label(s, info.list.length)}`,
        });
      }
    for (const [id, { hits, reason, kind }] of missing)
      ctx.report({
        rule: "sections.header-footer-missing",
        severity: "error",
        family: FAMILY,
        title: `A ${kind} reference (${id}) ${reason}`,
        why: `The section names a ${kind} through a relationship of the main document. It cannot be found, so the ${kind} is lost, and Word usually reports unreadable content.`,
        key: id,
        hits,
        facts: { relationshipId: id, sections: hits.length },
      });
  },
};

const firstPage: Rule = {
  name: "title-page",
  codes: ["sections.title-page-without-first-header"],
  run(ctx) {
    const info = sections(ctx);
    if (!info) return;
    // A section without its own first-page header inherits the previous section's.
    let haveFirst = false;
    const hits: Hit[] = [];
    for (const s of info.list) {
      for (const ref of s.sectPr.children)
        if (
          typeof ref !== "string" &&
          (ref.name === "w:headerReference" || ref.name === "w:footerReference") &&
          ref.attrs["w:type"] === "first"
        )
          haveFirst = true;
      const titlePg = child(s.sectPr, "w:titlePg");
      if (isOn(titlePg) && !haveFirst)
        hits.push({ part: info.main, el: titlePg, label: label(s, info.list.length) });
    }
    if (hits.length === 0) return;
    ctx.report({
      rule: "sections.title-page-without-first-header",
      severity: "info",
      family: FAMILY,
      title: `${plural(hits.length, "section")} ${hits.length === 1 ? "has" : "have"} a different first page but no first-page header or footer`,
      why: 'With "Different first page" on and no first-page header or footer, the first page of the section has a blank header and footer. That is often what was wanted (a title page), but if a header is missing from page 1, this is why.',
      key: "title-page",
      hits,
    });
  },
};

const evenOdd: Rule = {
  name: "even-odd-headers",
  codes: ["sections.even-headers-unused", "sections.even-headers-missing"],
  run(ctx) {
    const info = sections(ctx);
    if (!info) return;
    const settingsPart = ctx.related(info.main, "settings");
    const flag = settingsPart
      ? child(ctx.xml(settingsPart)?.root ?? undefined, "w:evenAndOddHeaders")
      : undefined;
    const on = isOn(flag) === true;
    const evens: Hit[] = [];
    for (const s of info.list)
      for (const ref of s.sectPr.children)
        if (
          typeof ref !== "string" &&
          (ref.name === "w:headerReference" || ref.name === "w:footerReference") &&
          ref.attrs["w:type"] === "even"
        )
          evens.push({ part: info.main, el: ref, label: label(s, info.list.length) });
    if (!on && evens.length > 0)
      ctx.report({
        rule: "sections.even-headers-unused",
        severity: "info",
        family: FAMILY,
        title: `${plural(evens.length, "even-page header or footer", "even-page headers or footers")} defined, but "Different odd and even pages" is off`,
        why: "Even-page headers and footers are used only when the document setting for different odd and even pages is on. It is off, so these are never shown, though they stay in the file.",
        key: "unused",
        hits: evens,
      });
    if (on && evens.length === 0 && settingsPart)
      ctx.report({
        rule: "sections.even-headers-missing",
        severity: "info",
        family: FAMILY,
        title:
          '"Different odd and even pages" is on, but no section has an even-page header or footer',
        why: "With the setting on, even pages use the even-page header and footer. There are none, so every even page has a blank header and footer.",
        key: "missing",
        hits: [{ part: settingsPart, el: flag }],
      });
  },
};

function pageSetup(sectPr: XElement): string {
  const sz = child(sectPr, "w:pgSz");
  const mar = child(sectPr, "w:pgMar");
  const a = (el: XElement | undefined, names: string[]) =>
    names.map((n) => el?.attrs[`w:${n}`] ?? "").join(",");
  const orient = sz?.attrs["w:orient"] || "portrait";
  return `${a(sz, ["w", "h"])},${orient};${a(mar, ["top", "right", "bottom", "left"])}`;
}

const pageSetupRule: Rule = {
  name: "page-setup",
  codes: ["sections.page-setup-differs", "sections.page-numbering-restart"],
  run(ctx) {
    const info = sections(ctx);
    if (!info || info.list.length === 0) return;
    const first = pageSetup(info.list[0]!.sectPr);
    const differ = info.list.filter((s) => pageSetup(s.sectPr) !== first);
    if (differ.length > 0)
      ctx.report({
        rule: "sections.page-setup-differs",
        severity: "info",
        family: FAMILY,
        title: `${plural(differ.length, "section")} ${differ.length === 1 ? "has" : "have"} a different page size, orientation or margins from the first`,
        why: "Sections can have their own page setup, for example a landscape page for a wide table. If that was not intended, a page that looks different is probably in its own section.",
        key: "page-setup",
        hits: differ.map((s) => ({
          part: info.main,
          el: child(s.sectPr, "w:pgSz") ?? child(s.sectPr, "w:pgMar") ?? s.sectPr,
          label: label(s, info.list.length),
        })),
        facts: { sections: info.list.length, differing: differ.length },
      });
    const restarts: Hit[] = [];
    for (const s of info.list) {
      const pg = child(s.sectPr, "w:pgNumType");
      if (pg && pg.attrs["w:start"] !== undefined)
        restarts.push({ part: info.main, el: pg, label: label(s, info.list.length) });
    }
    if (restarts.length > 0)
      ctx.report({
        rule: "sections.page-numbering-restart",
        severity: "info",
        family: FAMILY,
        title: `Page numbering restarts in ${plural(restarts.length, "section")}`,
        why: "A section can start its page numbers again at a fixed number. If page numbers jump back or repeat, this is where.",
        key: "restart",
        hits: restarts,
      });
  },
};

const finalSection: Rule = {
  name: "final-section",
  codes: ["sections.missing-final-sectpr"],
  run(ctx) {
    const info = sections(ctx);
    if (!info?.body) return;
    if (child(info.body, "w:sectPr")) return;
    ctx.report({
      rule: "sections.missing-final-sectpr",
      severity: "warning",
      family: FAMILY,
      title: "The document body has no final section properties",
      why: "Word keeps the last section's page size, margins, headers and footers in a w:sectPr at the end of the body. Without it, that section uses defaults that differ between programs and countries (A4 or Letter), and its headers and footers are lost.",
      key: "final",
      hits: [{ part: info.main, el: info.body }],
    });
  },
};

export const sectionRules: Rule[] = [headerFooter, firstPage, evenOdd, pageSetupRule, finalSection];
