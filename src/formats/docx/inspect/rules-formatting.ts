/**
 * Ghost formatting rules: text you cannot see, fields, bookmarks and content controls whose
 * markers do not match up, and paragraphs buried in direct formatting. Read from every part that
 * holds content.
 */
import { isOn } from "../notation";
import { Styles } from "../styles";
import { child, textOf, type XElement } from "../xml";
import { ancestor, groupBy, plural, within, type Hit } from "./context";
import { readStyles } from "./rules-styles";
import type { Rule } from "./rule";

const FAMILY = "formatting";

/** Runs smaller than this many half-points (3 pt) are reported as tiny text. */
export const TINY_HALF_POINTS = 6;

/** Paragraphs with at least this many direct overrides are formatting hotspots. */
export const HOTSPOT_SCORE = 12;
export const HOTSPOTS_SHOWN = 5;

function hasVisibleText(run: XElement): boolean {
  for (const c of run.children)
    if (typeof c !== "string" && c.name === "w:t" && textOf(c).trim() !== "") return true;
  return false;
}

const hidden: Rule = {
  name: "hidden-text",
  codes: ["formatting.hidden-text"],
  run(ctx) {
    const runs: Hit[] = [];
    const marks: Hit[] = [];
    for (const part of ctx.stories())
      for (const vanish of ctx.all(part, "w:vanish")) {
        if (!isOn(vanish)) continue;
        const rPr = vanish.parent;
        const owner = rPr?.parent;
        if (rPr?.name !== "w:rPr" || !owner) continue;
        if (owner.name === "w:r") runs.push({ part, el: owner, label: "hidden run" });
        else if (owner.name === "w:pPr")
          marks.push({ part, el: owner.parent ?? owner, label: "hidden paragraph mark" });
      }
    const hits = [...runs, ...marks];
    if (hits.length === 0) return;
    ctx.report({
      rule: "formatting.hidden-text",
      severity: "info",
      family: FAMILY,
      title: `${plural(runs.length, "run")} and ${plural(marks.length, "paragraph mark")} are formatted as hidden`,
      why: "Hidden text is not shown or printed unless formatting marks are on, but it is still in the file and is shared with it. Check it is not something you meant to remove.",
      key: "hidden",
      hits,
      facts: { runs: runs.length, paragraphMarks: marks.length, count: hits.length },
    });
  },
};

const HEX = /^[0-9A-Fa-f]{6}$/;

function shadingFill(rPr: XElement | undefined): string | undefined {
  const fill = child(rPr, "w:shd")?.attrs["w:fill"];
  return fill && HEX.test(fill) ? fill.toUpperCase() : undefined;
}

const invisible: Rule = {
  name: "invisible-text",
  codes: ["formatting.invisible-text"],
  run(ctx) {
    const main = ctx.main();
    if (!main) return;
    const info = readStyles(ctx);
    const styles = info ? new Styles(ctx.xml(info.part)?.root) : undefined;
    const root = ctx.xml(main)?.root ?? undefined;
    // White text on a page that has a background colour or pictures behind the text is often
    // deliberate; do not judge white text in such a document at all.
    const busyPage =
      child(root, "w:background") !== undefined ||
      ctx.all(main, "wp:anchor").some((a) => a.attrs.behindDoc === "1") ||
      ctx.all(main, "v:shape").length > 0;
    const hits: Hit[] = [];
    for (const part of ctx.stories())
      for (const color of ctx.all(part, "w:color")) {
        const rPr = color.parent;
        const run = rPr?.parent;
        if (rPr?.name !== "w:rPr" || run?.name !== "w:r") continue;
        const val = color.attrs["w:val"];
        if (!val || !HEX.test(val) || color.attrs["w:themeColor"] !== undefined) continue;
        if (!hasVisibleText(run) || within(run, "w:del")) continue;
        const colour = val.toUpperCase();
        const fill = shadingFill(rPr);
        const highlighted = child(rPr, "w:highlight") !== undefined;
        let invisibleRun = false;
        if (fill !== undefined) invisibleRun = fill === colour && !highlighted;
        else if (colour === "FFFFFF" && part === main && !busyPage && !highlighted) {
          // White on (presumably) white: only when nothing around the run could colour it in.
          const p = ancestor(run, "w:p");
          const pPr = child(p, "w:pPr");
          const pStyle = child(pPr, "w:pStyle")?.attrs["w:val"];
          const rStyle = child(rPr, "w:rStyle")?.attrs["w:val"];
          const styled = (id: string | undefined, which: string) =>
            id !== undefined &&
            styles !== undefined &&
            ["w:shd", "w:highlight"].some((n) => styles.resolved(id, which, false).has(n));
          invisibleRun =
            !within(
              run,
              new Set(["w:tbl", "w:txbxContent", "w:pict", "w:drawing", "mc:AlternateContent"]),
            ) &&
            child(pPr, "w:shd") === undefined &&
            !styled(pStyle, "w:pPr") &&
            !styled(pStyle, "w:rPr") &&
            !styled(rStyle, "w:rPr");
        }
        if (invisibleRun)
          hits.push({ part, el: run, label: fill ? `colour ${colour} on ${fill}` : "white text" });
      }
    if (hits.length === 0) return;
    ctx.report({
      rule: "formatting.invisible-text",
      severity: "warning",
      family: FAMILY,
      title: `${plural(hits.length, "run")} of text ${hits.length === 1 ? "is" : "are"} coloured so that ${hits.length === 1 ? "it" : "they"} cannot be seen`,
      why: "The text colour is the same as its shading, or white on a plain white page. Readers cannot see it, but it is still there to be copied, searched and read by screen readers, which is sometimes used to hide text on purpose.",
      key: "invisible",
      hits,
      facts: { count: hits.length },
    });
  },
};

const tiny: Rule = {
  name: "tiny-text",
  codes: ["formatting.tiny-text"],
  run(ctx) {
    const hits: Hit[] = [];
    for (const part of ctx.stories())
      for (const sz of ctx.all(part, "w:sz")) {
        const rPr = sz.parent;
        const run = rPr?.parent;
        if (rPr?.name !== "w:rPr" || run?.name !== "w:r") continue;
        const n = Number(sz.attrs["w:val"]);
        if (!Number.isFinite(n) || n >= TINY_HALF_POINTS || !hasVisibleText(run)) continue;
        hits.push({ part, el: run, label: `${n / 2} pt` });
      }
    if (hits.length === 0) return;
    ctx.report({
      rule: "formatting.tiny-text",
      severity: "info",
      family: FAMILY,
      title: `${plural(hits.length, "run")} of text ${hits.length === 1 ? "is" : "are"} smaller than ${TINY_HALF_POINTS / 2} pt`,
      why: "Text this small is unreadable on screen and in print. It is sometimes a spacing trick, and sometimes a way to hide text that is still in the file.",
      key: "tiny",
      hits,
      facts: { count: hits.length },
    });
  },
};

const fields: Rule = {
  name: "complex-fields",
  codes: ["formatting.unbalanced-field"],
  run(ctx) {
    for (const part of ctx.stories()) {
      const bad: Hit[] = [];
      const stack: { el: XElement; separated: boolean }[] = [];
      for (const el of ctx.all(part, "w:fldChar")) {
        const type = el.attrs["w:fldCharType"];
        if (type === "begin") stack.push({ el, separated: false });
        else if (type === "separate") {
          const top = stack[stack.length - 1];
          if (!top || top.separated) bad.push({ part, el, label: "separator without a field" });
          else top.separated = true;
        } else if (type === "end") {
          if (!stack.pop()) bad.push({ part, el, label: "end without a beginning" });
        }
      }
      for (const open of stack) bad.push({ part, el: open.el, label: "field never ends" });
      if (bad.length === 0) continue;
      ctx.report({
        rule: "formatting.unbalanced-field",
        severity: "warning",
        family: FAMILY,
        title: `${plural(bad.length, "field marker")} in ${part} ${bad.length === 1 ? "does" : "do"} not pair up`,
        why: "A field (page numbers, cross-references, a table of contents) is written as begin, an optional separator, and end markers. When they do not pair up, Word may show the field code instead of its result, swallow the text that follows, or repair the document.",
        key: part,
        hits: bad,
        facts: { count: bad.length },
      });
    }
  },
};

const bookmarks: Rule = {
  name: "bookmarks",
  codes: [
    "formatting.duplicate-bookmark-name",
    "formatting.duplicate-bookmark-id",
    "formatting.unclosed-bookmark",
  ],
  run(ctx) {
    const named: { part: string; el: XElement; name: string }[] = [];
    for (const part of ctx.stories()) {
      const starts = ctx.all(part, "w:bookmarkStart");
      const ends = new Set(ctx.all(part, "w:bookmarkEnd").map((e) => e.attrs["w:id"]));
      for (const el of starts) {
        const name = el.attrs["w:name"] ?? "";
        if (name !== "" && !name.startsWith("_")) named.push({ part, el, name });
      }
      for (const [id, list] of groupBy(starts, (el) => el.attrs["w:id"] ?? "")) {
        if (id === "" || list.length < 2) continue;
        ctx.report({
          rule: "formatting.duplicate-bookmark-id",
          severity: "warning",
          family: FAMILY,
          title: `${list.length} bookmarks in ${part} share the id ${id}`,
          why: "Each bookmark's start and end are paired by id. With two starts of the same id, Word cannot tell which end belongs to which, and drops or shortens one of the bookmarks.",
          key: `${part}\u0000${id}`,
          hits: list.map((el) => ({ part, el, label: `bookmark id ${id}` })),
          facts: { bookmarkId: id },
        });
      }
      const unclosed = starts.filter((el) => !ends.has(el.attrs["w:id"]));
      if (unclosed.length > 0)
        ctx.report({
          rule: "formatting.unclosed-bookmark",
          severity: "warning",
          family: FAMILY,
          title: `${plural(unclosed.length, "bookmark")} in ${part} ${unclosed.length === 1 ? "starts" : "start"} but never ${unclosed.length === 1 ? "ends" : "end"}`,
          why: "A bookmark needs a start and an end with the same id in the same part. Without an end, Word drops the bookmark, and cross-references and links to it break.",
          key: part,
          hits: unclosed.map((el) => ({
            part,
            el,
            label: `bookmark id ${el.attrs["w:id"] ?? ""}`,
          })),
          facts: { count: unclosed.length },
        });
    }
    for (const [key, list] of groupBy(named, (b) => b.name.toLowerCase())) {
      if (list.length < 2) continue;
      ctx.report({
        rule: "formatting.duplicate-bookmark-name",
        severity: "warning",
        family: FAMILY,
        title: `${list.length} bookmarks are called "${list[0]!.name}"`,
        why: "Bookmark names must be unique in a document (ignoring case). Word keeps one and drops the others, so links and cross-references may jump to the wrong place.",
        key,
        hits: list.map((b) => ({ part: b.part, el: b.el, label: "bookmark" })),
      });
    }
  },
};

const contentControls: Rule = {
  name: "content-controls",
  codes: ["formatting.duplicate-sdt-id"],
  run(ctx) {
    for (const part of ctx.stories()) {
      const ids: { el: XElement; id: string }[] = [];
      for (const sdtPr of ctx.all(part, "w:sdtPr")) {
        const idEl = child(sdtPr, "w:id");
        const id = idEl?.attrs["w:val"];
        if (idEl && id !== undefined && id !== "") ids.push({ el: idEl, id });
      }
      for (const [id, list] of groupBy(ids, (x) => x.id)) {
        if (list.length < 2) continue;
        ctx.report({
          rule: "formatting.duplicate-sdt-id",
          severity: "warning",
          family: FAMILY,
          title: `${list.length} content controls in ${part} share the id ${id}`,
          why: "Content controls are told apart by id, and forms, macros and data binding find them that way. Duplicates usually come from copying controls; Word renumbers them silently, which can break whatever relied on the old ids.",
          key: `${part}\u0000${id}`,
          hits: list.map((x) => ({ part, el: x.el, label: `content control ${id}` })),
          facts: { sdtId: id },
        });
      }
    }
  },
};

const IGNORED_P = new Set(["w:pStyle", "w:numPr", "w:rPr", "w:sectPr", "w:pPrChange"]);
const IGNORED_R = new Set([
  "w:rStyle",
  "w:lang",
  "w:noProof",
  "w:rPrChange",
  "w:webHidden",
  "w:specVanish",
  "w:bCs",
  "w:iCs",
  "w:szCs",
]);

/** Direct paragraph properties plus distinct direct run properties, on top of the styles. */
function overrides(p: XElement): number {
  let score = 0;
  const pPr = child(p, "w:pPr");
  for (const c of pPr?.children ?? []) if (typeof c !== "string" && !IGNORED_P.has(c.name)) score++;
  const runProps = new Set<string>();
  const stack: XElement[] = [p];
  while (stack.length > 0) {
    const el = stack.pop()!;
    for (const c of el.children) {
      if (typeof c === "string") continue;
      if (c.name === "w:r") {
        for (const prop of child(c, "w:rPr")?.children ?? []) {
          if (typeof prop === "string" || IGNORED_R.has(prop.name)) continue;
          if (prop.name === "w:rFonts" && Object.keys(prop.attrs).every((k) => k === "w:hint"))
            continue;
          runProps.add(prop.name);
        }
      } else if (c.name !== "w:p" && c.name !== "w:pPr" && c.name !== "mc:Fallback") stack.push(c);
    }
  }
  return score + runProps.size;
}

const hotspots: Rule = {
  name: "direct-formatting",
  codes: ["formatting.direct-formatting-hotspots"],
  run(ctx) {
    const main = ctx.main();
    if (!main) return;
    const scored: { p: XElement; score: number }[] = [];
    for (const p of ctx.all(main, "w:p")) {
      const score = overrides(p);
      if (score >= HOTSPOT_SCORE) scored.push({ p, score });
    }
    if (scored.length === 0) return;
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, HOTSPOTS_SHOWN);
    ctx.report({
      rule: "formatting.direct-formatting-hotspots",
      severity: "info",
      family: FAMILY,
      title: `${plural(scored.length, "paragraph")} ${scored.length === 1 ? "carries" : "carry"} ${HOTSPOT_SCORE} or more direct formatting overrides`,
      why: "Formatting applied directly sits on top of the paragraph's style and wins over it, so changing the style no longer changes these paragraphs. A paragraph with many overrides is where a document's look drifts; consider a style instead.",
      key: "hotspots",
      hits: top.map(({ p, score }) => ({ part: main, el: p, label: `${score} overrides` })),
      facts: { count: scored.length, highest: top[0]!.score },
    });
  },
};

export const formattingRules: Rule[] = [
  hidden,
  invisible,
  tiny,
  fields,
  bookmarks,
  contentControls,
  hotspots,
];
