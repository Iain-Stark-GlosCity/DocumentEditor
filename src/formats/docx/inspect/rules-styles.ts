/**
 * Style rules: references to styles that do not exist, broken inheritance, duplicates, and
 * clutter. Read from styles.xml (the main document's `styles` relationship) and from every part
 * that holds content.
 */
import { displayStyleName } from "../notation";
import { child, type XElement } from "../xml";
import { plural, type Hit, type InspectContext } from "./context";
import type { Rule } from "./rule";

const FAMILY = "styles";

/**
 * Style ids of Word's built-in styles that tools commonly refer to without defining. Word knows
 * these by name and adds the definition back when the style is applied again, so a missing one is
 * awareness rather than a defect. The table families (`GridTable4-Accent1` and so on) are matched
 * by pattern.
 */
const BUILT_IN_IDS = new Set(
  [
    "Normal",
    "Title",
    "Subtitle",
    "Quote",
    "IntenseQuote",
    "ListParagraph",
    "NoSpacing",
    "Strong",
    "Emphasis",
    "SubtleEmphasis",
    "IntenseEmphasis",
    "SubtleReference",
    "IntenseReference",
    "BookTitle",
    "Hyperlink",
    "FollowedHyperlink",
    "FootnoteReference",
    "FootnoteText",
    "EndnoteReference",
    "EndnoteText",
    "CommentReference",
    "CommentText",
    "CommentSubject",
    "Caption",
    "TOCHeading",
    "Header",
    "Footer",
    "PageNumber",
    "LineNumber",
    "BalloonText",
    "PlaceholderText",
    "DefaultParagraphFont",
    "TableNormal",
    "TableGrid",
    "NoList",
    "BodyText",
    "PlainText",
    "Revision",
    "Bibliography",
    "ListBullet",
    "ListNumber",
    "UnresolvedMention",
  ].map((s) => s.toLowerCase()),
);

export function isBuiltInStyleId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    BUILT_IN_IDS.has(lower) ||
    /^heading[1-9]$/.test(lower) ||
    /^toc[1-9]$/.test(lower) ||
    /^(listbullet|listnumber)[2-5]$/.test(lower) ||
    /^(gridtable|listtable)[1-7](light)?(-accent[1-6])?$/.test(lower) ||
    /^plaintable[1-5]$/.test(lower)
  );
}

export interface StyleInfo {
  id: string;
  type: string;
  name: string;
  basedOn?: XElement;
  next?: XElement;
  link?: XElement;
  isDefault: boolean;
  custom: boolean;
  el: XElement;
}

/** The styles part's definitions, in file order (duplicates included). */
export function readStyles(ctx: InspectContext): { part: string; list: StyleInfo[] } | null {
  return ctx.memo("styles", () => readStylesUncached(ctx));
}

function readStylesUncached(ctx: InspectContext): { part: string; list: StyleInfo[] } | null {
  const main = ctx.main();
  const part = main ? ctx.related(main, "styles") : undefined;
  if (!part) return null;
  const list: StyleInfo[] = [];
  for (const el of ctx.all(part, "w:style")) {
    if (el.parent !== ctx.xml(part)?.root) continue;
    const on = (v: string | undefined) => v === "1" || v === "true" || v === "on";
    list.push({
      id: el.attrs["w:styleId"] ?? "",
      type: el.attrs["w:type"] ?? "paragraph",
      name: child(el, "w:name")?.attrs["w:val"] ?? "",
      basedOn: child(el, "w:basedOn"),
      next: child(el, "w:next"),
      link: child(el, "w:link"),
      isDefault: on(el.attrs["w:default"]),
      custom: on(el.attrs["w:customStyle"]),
      el,
    });
  }
  return { part, list };
}

const KIND: Record<string, string> = {
  "w:pStyle": "paragraph",
  "w:rStyle": "character",
  "w:tblStyle": "table",
  "w:numStyleLink": "numbering",
  "w:styleLink": "numbering",
};

/** Every reference to a style by id from content and numbering, in document order. */
function styleReferences(ctx: InspectContext): { part: string; el: XElement; id: string }[] {
  const out: { part: string; el: XElement; id: string }[] = [];
  const main = ctx.main();
  const parts = ctx.stories();
  const numbering = main ? ctx.related(main, "numbering") : undefined;
  if (numbering) parts.push(numbering);
  for (const part of parts)
    for (const name of Object.keys(KIND))
      for (const el of ctx.all(part, name)) {
        const id = el.attrs["w:val"];
        if (id !== undefined && id !== "") out.push({ part, el, id });
      }
  return out;
}

const undefinedStyles: Rule = {
  name: "undefined-styles",
  codes: ["styles.undefined-style", "styles.styles-part-missing"],
  run(ctx) {
    const styles = readStyles(ctx);
    const refs = styleReferences(ctx);
    if (!styles) {
      if (refs.length === 0) return; // A minimal document without styles is fine.
      ctx.report({
        rule: "styles.styles-part-missing",
        severity: "warning",
        family: FAMILY,
        title: `The document refers to styles ${plural(refs.length, "time")}, but has no styles part`,
        why: "Without styles.xml every style reference falls back to Word's defaults, so headings, quotes and other styled text lose their look. Word keeps the references, but nothing defines them.",
        key: "no-styles",
        hits: refs.map((r) => ({ part: r.part, el: r.el, label: `style ${r.id}` })),
        facts: { references: refs.length },
      });
      return;
    }
    const defined = new Set(styles.list.map((s) => s.id));
    const missing = refs.filter((r) => !defined.has(r.id));
    const groups = new Map<string, typeof missing>();
    for (const r of missing) {
      const key = `${KIND[r.el.name]}\u0000${r.id}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(r);
    }
    for (const [key, list] of groups) {
      const first = list[0]!;
      const kind = KIND[first.el.name]!;
      const builtIn = isBuiltInStyleId(first.id);
      const what =
        kind === "paragraph"
          ? "paragraphs"
          : kind === "table"
            ? "tables"
            : kind === "character"
              ? "runs"
              : "lists";
      ctx.report({
        rule: "styles.undefined-style",
        severity: builtIn ? "info" : "warning",
        family: FAMILY,
        title: `${list.length} ${list.length === 1 ? what.replace(/s$/, "") : what} use${list.length === 1 ? "s" : ""} the ${kind} style ${first.id}, which is not defined`,
        why: builtIn
          ? "This is one of Word's built-in styles, but the file does not define it, so Word shows the text in the default style instead. Applying the style again in Word adds its definition back."
          : "No style with this id is defined in styles.xml, so Word shows the text in the default style and the intended formatting is lost. Word also drops the reference when it saves.",
        key,
        hits: list.map((r) => ({ part: r.part, el: r.el, label: `${kind} style ${r.id}` })),
        facts: { styleId: first.id, kind, builtIn },
      });
    }
  },
};

const styleLinks: Rule = {
  name: "style-links",
  codes: ["styles.based-on-missing", "styles.link-missing", "styles.next-missing"],
  run(ctx) {
    const styles = readStyles(ctx);
    if (!styles) return;
    const defined = new Set(styles.list.map((s) => s.id));
    const specs = [
      {
        prop: "basedOn" as const,
        rule: "styles.based-on-missing",
        severity: "warning" as const,
        why: "A style inherits everything it does not set from the style it is based on. That style is missing, so this style loses the inherited formatting and Word bases it on the defaults instead.",
      },
      {
        prop: "link" as const,
        rule: "styles.link-missing",
        severity: "info" as const,
        why: "A paragraph style and a character style can be linked so that applying the style to part of a paragraph uses the character half. The linked style is missing, so Word ignores the link.",
      },
      {
        prop: "next" as const,
        rule: "styles.next-missing",
        severity: "info" as const,
        why: "The next style is the one Word applies to a new paragraph after pressing Enter. It is missing, so Word keeps the same style instead. Harmless, but it shows the style was copied from elsewhere.",
      },
    ];
    for (const spec of specs) {
      // A missing built-in parent (Default Paragraph Font, Normal Table) usually adds nothing, so
      // basing a style on one is noted rather than warned about.
      for (const builtIn of [false, true]) {
        const hits: Hit[] = [];
        const ids: string[] = [];
        for (const s of styles.list) {
          const el = s[spec.prop];
          const target = el?.attrs["w:val"];
          if (!el || target === undefined || target === "" || defined.has(target)) continue;
          if (isBuiltInStyleId(target) !== builtIn) continue;
          hits.push({ part: styles.part, el, label: `style ${s.id}` });
          ids.push(s.id);
        }
        if (hits.length === 0) continue;
        const verb =
          spec.prop === "basedOn" ? "based on" : spec.prop === "link" ? "linked to" : "followed by";
        ctx.report({
          rule: spec.rule,
          severity: builtIn ? "info" : spec.severity,
          family: FAMILY,
          title: `${plural(hits.length, "style")} ${hits.length === 1 ? "is" : "are"} ${verb} a ${builtIn ? "built-in " : ""}style that is not defined (${ids.slice(0, 3).join(", ")}${ids.length > 3 ? ", …" : ""})`,
          why: builtIn
            ? `${spec.why} The missing style is one of Word's built-in styles, which Word adds back when it is needed.`
            : spec.why,
          key: `${spec.prop}\u0000${builtIn}`,
          hits,
        });
      }
    }
  },
};

/** The deepest basedOn chain Word handles comfortably; deeper chains are reported as info. */
export const MAX_CHAIN = 10;

const inheritance: Rule = {
  name: "style-inheritance",
  codes: ["styles.based-on-cycle", "styles.deep-based-on-chain"],
  run(ctx) {
    const styles = readStyles(ctx);
    if (!styles) return;
    const byId = new Map<string, (typeof styles.list)[number]>();
    for (const s of styles.list) if (!byId.has(s.id)) byId.set(s.id, s);
    const parent = (id: string) => byId.get(id)?.basedOn?.attrs["w:val"];
    const reported = new Set<string>();
    const deep: Hit[] = [];
    let deepest = 0;
    for (const s of byId.values()) {
      const path: string[] = [];
      const seen = new Map<string, number>();
      let cur: string | undefined = s.id;
      while (cur !== undefined && byId.has(cur) && !seen.has(cur)) {
        seen.set(cur, path.length);
        path.push(cur);
        cur = parent(cur);
      }
      if (cur !== undefined && seen.has(cur)) {
        const cycle = path.slice(seen.get(cur)!);
        const key = [...cycle].sort().join("\u0000");
        if (!reported.has(key)) {
          reported.add(key);
          ctx.report({
            rule: "styles.based-on-cycle",
            severity: "warning",
            family: FAMILY,
            title: `Styles are based on each other in a loop: ${cycle.join(" → ")} → ${cycle[0]}`,
            why: "A style's basedOn chain must end. In a loop no style has a starting point, so Word breaks the loop somewhere of its own choosing, and the formatting you see may differ between Word versions and other programs.",
            key,
            hits: cycle.map((id) => ({
              part: styles.part,
              el: byId.get(id)!.basedOn,
              label: `style ${id}`,
            })),
            facts: { styles: cycle.length },
          });
        }
        continue;
      }
      if (path.length > MAX_CHAIN) {
        deep.push({ part: styles.part, el: s.el, label: `style ${s.id}` });
        deepest = Math.max(deepest, path.length);
      }
    }
    if (deep.length > 0)
      ctx.report({
        rule: "styles.deep-based-on-chain",
        severity: "info",
        family: FAMILY,
        title: `${plural(deep.length, "style")} ${deep.length === 1 ? "has" : "have"} a basedOn chain more than ${MAX_CHAIN} styles deep`,
        why: "Each style inherits from the one it is based on. Very long chains are legal but hard to reason about: a change near the top ripples unpredictably, and they usually come from styles copied between documents.",
        key: "deep",
        hits: deep,
        facts: { deepest },
      });
  },
};

const duplicates: Rule = {
  name: "style-duplicates",
  codes: ["styles.duplicate-id", "styles.duplicate-name"],
  run(ctx) {
    const styles = readStyles(ctx);
    if (!styles) return;
    const byId = new Map<string, StyleInfo[]>();
    const byName = new Map<string, StyleInfo[]>();
    for (const s of styles.list) {
      const list = byId.get(s.id) ?? [];
      list.push(s);
      byId.set(s.id, list);
      if (s.name.trim() === "") continue;
      const key = displayStyleName(s.name.trim()).toLowerCase();
      const named = byName.get(key) ?? [];
      named.push(s);
      byName.set(key, named);
    }
    for (const [id, list] of byId) {
      if (list.length < 2) continue;
      ctx.report({
        rule: "styles.duplicate-id",
        severity: "warning",
        family: FAMILY,
        title: `${list.length} styles share the id ${id}`,
        why: "Every style needs its own id. Word uses one of the definitions and ignores the rest, so the formatting you see may not be the definition you edit.",
        key: id,
        hits: list.map((s) => ({ part: styles.part, el: s.el, label: `style ${s.id}` })),
        facts: { styleId: id },
      });
    }
    for (const list of byName.values()) {
      const ids = new Set(list.map((s) => s.id));
      if (ids.size < 2) continue;
      ctx.report({
        rule: "styles.duplicate-name",
        severity: "warning",
        family: FAMILY,
        title: `${list.length} styles are called "${list[0]!.name}" (${[...ids].join(", ")})`,
        why: "Word picks styles by name in its galleries and when pasting. With two styles of the same name, Word may rename one of them when it opens the file, and text can end up in the other one.",
        key: [...ids].sort().join("\u0000"),
        hits: list.map((s) => ({ part: styles.part, el: s.el, label: `style ${s.id}` })),
      });
    }
  },
};

const defaults: Rule = {
  name: "style-defaults",
  codes: ["styles.no-default-paragraph-style"],
  run(ctx) {
    const styles = readStyles(ctx);
    if (!styles || styles.list.length === 0) return;
    if (styles.list.some((s) => s.type === "paragraph" && s.isDefault)) return;
    const root = ctx.xml(styles.part)?.root;
    ctx.report({
      rule: "styles.no-default-paragraph-style",
      severity: "info",
      family: FAMILY,
      title: "No paragraph style is marked as the default",
      why: "Paragraphs that name no style use the default paragraph style (usually Normal). Without one, programs disagree about how those paragraphs look, and Word may add its own Normal style.",
      key: "default",
      hits: [{ part: styles.part, el: root ?? undefined }],
    });
  },
};

const unused: Rule = {
  name: "unused-styles",
  codes: ["styles.unused-styles"],
  run(ctx) {
    const styles = readStyles(ctx);
    if (!styles) return;
    const used = new Set(styleReferences(ctx).map((r) => r.id));
    // A style used through another one's basedOn, link or next is in use.
    const byId = new Map(styles.list.map((s) => [s.id, s]));
    const queue = [...used];
    while (queue.length > 0) {
      const s = byId.get(queue.pop()!);
      if (!s) continue;
      for (const el of [s.basedOn, s.link, s.next]) {
        const id = el?.attrs["w:val"];
        if (id && !used.has(id)) {
          used.add(id);
          queue.push(id);
        }
      }
    }
    const idle = styles.list.filter((s) => !s.isDefault && !used.has(s.id));
    if (idle.length === 0) return;
    const custom = idle.filter((s) => s.custom);
    const shown = [...custom, ...idle.filter((s) => !s.custom)];
    ctx.report({
      rule: "styles.unused-styles",
      severity: "info",
      family: FAMILY,
      title: `${plural(idle.length, "style")} ${idle.length === 1 ? "is" : "are"} defined but not used${custom.length > 0 ? ` (${custom.length} of them custom)` : ""}`,
      why: "Unused styles are harmless, but many of them, especially custom ones, usually come from pasting between documents and clutter the style gallery.",
      key: "unused",
      hits: shown.map((s) => ({ part: styles.part, el: s.el, label: `style ${s.id}` })),
      facts: { unused: idle.length, custom: custom.length, defined: styles.list.length },
    });
  },
};

export const styleRules: Rule[] = [
  undefinedStyles,
  styleLinks,
  inheritance,
  duplicates,
  defaults,
  unused,
];
