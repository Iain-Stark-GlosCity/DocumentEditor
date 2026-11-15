/**
 * The Formatting view of a Word document: Markdown-like text that shows all of the document's
 * formatting. Pure TypeScript (no DOM, no Node), so it can run in a Web Worker. It never throws:
 * whatever cannot be read becomes a visible placeholder. The notation is documented in
 * docs/docx-view.md.
 */
import { comment, commentAttrs, errorPlaceholder, twips, type Attr } from "./notation";
import { Numbering } from "./numbering";
import { Package, type PartSource } from "./package";
import {
  attrsText,
  describeBorder,
  describeProps,
  genericValue,
  revisionLabel,
  type PropContext,
} from "./props";
import { Renderer } from "./render";
import type { SourceMapEntry } from "../../core/source-map";
import { SourceMarks } from "./source-marks";
import { asContainer, Styles } from "./styles";
import { child, elements, localName, textOf, type XDocument, type XElement } from "./xml";

export type { PartSource } from "./package";

export interface DocxViewOptions {
  /** A main document part larger than this (in characters) is not rendered. Default 30 MB. */
  maxMainPartSize?: number;
}

export const MAX_MAIN_PART = 30 * 1024 * 1024;

export const LEGEND = [
  "<!-- Formatting view of a Word document: generated and read-only. Full legend: docs/docx-view.md -->",
  "<!-- Markdown shows headings, lists, **bold**, *italic*, ~~strike~~, [links](url), footnotes [^1] and simple tables. -->",
  '<!-- Tags show the rest: <span font=".." size=".." colour="..">, <u>, <sup>, <sub>, <ins>, <del>, <field>, <drawing>. -->',
  '<!-- A "p" comment ends each paragraph that has a style or direct formatting. Lengths are in points (pt). -->',
  '<!-- Visible tokens: <tab/> <br/> <nbsp/> <sp/> (spaces at either end). A "raw" comment is XML shown as it is. -->',
  "<!-- Styles are named where used; their resolved definitions are in the Styles section at the end. -->",
];

const PAPER: Record<string, string> = {
  "11906x16838": "A4",
  "12240x15840": "Letter",
  "12240x20160": "Legal",
  "16838x23811": "A3",
  "8391x11906": "A5",
  "10318x14570": "B5",
  "10440x15120": "Executive",
};

function banner(title: string): string {
  return `<!-- ==== ${title} ==== -->`;
}

/** The Formatting view as text. */
export function generateDocxView(source: PartSource, options: DocxViewOptions = {}): string {
  return generateDocxViewMapped(source, options).text;
}

export interface MappedDocxView {
  text: string;
  /** Which lines of `text` came from which element of which part (see `src/core/source-map.ts`). */
  sourceMap: SourceMapEntry[];
}

/** The Formatting view with a source map: the lines of each paragraph, table, note and so on. */
export function generateDocxViewMapped(
  source: PartSource,
  options: DocxViewOptions = {},
): MappedDocxView {
  const unmapped = (text: string): MappedDocxView => ({ text, sourceMap: [] });
  const out: string[] = [...LEGEND];
  let pkg: Package;
  try {
    pkg = new Package(source);
  } catch (error) {
    return unmapped(
      [...out, "", comment(`error reading the package: ${String(error)}`)].join("\n") + "\n",
    );
  }
  const main = pkg.mainPart;
  const mainText = safe(() => source.text(main));
  const limit = options.maxMainPartSize ?? MAX_MAIN_PART;
  if (mainText === undefined) {
    out.push(
      "",
      comment(`This file has no main document part (${main}), so there is nothing to show.`),
    );
    return unmapped(out.join("\n") + "\n");
  }
  if (mainText.length > limit) {
    out.push(
      "",
      comment(
        `The main document part (${main}) is ${(mainText.length / 1048576).toFixed(1)} MB, more than the ${(limit / 1048576).toFixed(0)} MB the Formatting view reads. Open its parts one by one in the Parts pane instead.`,
      ),
    );
    return unmapped(out.join("\n") + "\n");
  }

  const styles =
    safe(() => new Styles(pkg.xml(pkg.related(main, "styles") ?? "word/styles.xml")?.root)) ??
    new Styles(null);
  const numbering =
    safe(
      () =>
        new Numbering(
          pkg.xml(pkg.related(main, "numbering") ?? "word/numbering.xml")?.root,
          styles,
        ),
    ) ?? new Numbering(null, styles);
  const props: PropContext = {
    theme: safe(() => pkg.theme()) ?? { colours: new Map() },
    styleName: (id) => styles.name(id),
  };
  const r = new Renderer(pkg, styles, numbering, props);
  const shown = new Set<string>([main, "[Content_Types].xml"]);

  const section = (title: string | null, fn: () => string[]) => {
    let lines: string[];
    try {
      lines = fn();
    } catch (error) {
      lines = [
        comment(
          `error in ${title ?? "a section"}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ];
    }
    if (lines.length === 0) return;
    out.push("");
    if (title) out.push(banner(title), "");
    out.push(lines.join("\n\n"));
  };

  const marks = r.marks;
  section(null, () => properties(pkg, shown, marks));
  section(null, () => settings(pkg, main, shown, props, marks));

  // ---- body ----
  const doc = pkg.xml(main)!;
  const body = child(doc.root, "w:body");
  const sections: { sectPr: XElement | undefined }[] = [];
  section(null, () => {
    const lines: string[] = [];
    if (doc.problems.length)
      lines.push(
        comment(
          `the XML of ${main} is damaged: ${doc.problems.slice(0, 5).join("; ")}${doc.problems.length > 5 ? ` and ${doc.problems.length - 5} more` : ""}`,
        ),
      );
    if (!doc.root) {
      lines.push(comment(`${main} holds no XML element at all.`));
      return lines;
    }
    if (!body) {
      lines.push(comment(`${main} has no w:body.`));
      return lines;
    }
    const background = child(doc.root, "w:background");
    if (background)
      lines.push(
        comment(
          `page-background colour=${background.attrs["w:color"] ?? "?"}${background.attrs["w:themeColor"] ? ` theme=${background.attrs["w:themeColor"]}` : ""}`,
        ),
      );
    // Sections end with the sectPr in a paragraph's properties, the last with the body's own.
    const blocks = elements(body);
    for (const el of blocks) {
      const sp =
        el.name === "w:p"
          ? child(child(el, "w:pPr"), "w:sectPr")
          : el.name === "w:sectPr"
            ? el
            : undefined;
      if (sp) sections.push({ sectPr: sp });
    }
    if (sections.length === 0) sections.push({ sectPr: undefined });
    const restore = r.enter(main, doc);
    let index = 0;
    let started = false;
    for (const el of blocks) {
      if (!started) {
        lines.push(
          sectionLine(sections[index]?.sectPr, index, sections.length, pkg, main, props, marks),
        );
        started = true;
      }
      try {
        lines.push(...r.block(el, 0));
      } catch (error) {
        lines.push(errorPlaceholder(doc, el, error));
      }
      const ends = el.name === "w:p" && child(child(el, "w:pPr"), "w:sectPr");
      if (ends && index < sections.length - 1) {
        index++;
        started = false;
      }
    }
    if (!started && index < sections.length)
      lines.push(
        sectionLine(sections[index]?.sectPr, index, sections.length, pkg, main, props, marks),
      );
    if (r.unclosedFields())
      lines.push(
        comment(`${r.unclosedFields()} field(s) are not closed by the end of the document`),
      );
    restore();
    return lines;
  });

  // ---- notes, comments, headers and footers ----
  for (const [type, title, prefix, elName] of [
    ["footnotes", "Footnotes", "", "w:footnote"],
    ["endnotes", "Endnotes", "e", "w:endnote"],
  ] as const) {
    const part = pkg.related(main, type);
    if (!part) continue;
    shown.add(part);
    section(title, () => notes(r, pkg, part, prefix, elName));
  }
  const commentsPart = pkg.related(main, "comments");
  if (commentsPart) {
    shown.add(commentsPart);
    section("Comments", () => comments(r, pkg, commentsPart, main, shown));
  }
  section("Headers and footers", () => headersFooters(r, pkg, main, sections, shown));

  // ---- definitions ----
  const stylesPart = pkg.related(main, "styles");
  if (stylesPart) shown.add(stylesPart);
  section("Styles", () =>
    stylesAppendix(styles, r.usedStyles, props, marks, stylesPart ?? "word/styles.xml"),
  );
  const numberingPart = pkg.related(main, "numbering");
  if (numberingPart) shown.add(numberingPart);
  section("Lists", () =>
    listsAppendix(numbering, props, marks, numberingPart ?? "word/numbering.xml"),
  );

  section("Other parts", () => {
    const theme = pkg.related(main, "theme");
    if (theme) shown.add(theme);
    const rest =
      safe(() => source.names())?.filter(
        (n) => !shown.has(n) && !n.endsWith(".rels") && !n.endsWith("/") && !r.usedMedia.has(n),
      ) ?? [];
    const lines: string[] = [];
    if (theme) {
      const t = props.theme;
      const colours = [...t.colours].map(([k, v]) => `${k}=${v}`).join(" ");
      lines.push(
        comment(
          `theme ${theme}: headings-font=${JSON.stringify(t.majorFont ?? "")} body-font=${JSON.stringify(t.minorFont ?? "")} ${colours}`,
        ),
      );
    }
    if (rest.length)
      lines.push(
        comment(`not shown in this view (open them in the Parts pane): ${rest.join(", ")}`),
      );
    return lines;
  });
  return marks.finish(out.join("\n") + "\n");
}

/** Private-use characters (Symbol and Wingdings bullets) as `U+F0B7`. */
function visibleChars(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/g, (c) => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `lastModifiedBy` and `TotalTime` as `last-modified-by` and `total-time`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/* ---------------- properties and settings ---------------- */

function properties(pkg: Package, shown: Set<string>, marks: SourceMarks): string[] {
  const lines: string[] = [];
  const simple = (part: string, label: string) => {
    const root = pkg.xml(part)?.root;
    if (!root) return;
    shown.add(part);
    const attrs: Attr[] = [];
    for (const el of elements(root)) {
      const kids = elements(el);
      if (kids.length === 0) {
        const text = textOf(el).trim();
        if (text !== "") attrs.push([kebab(localName(el.name)), text]);
      } else {
        // Vectors (HeadingPairs, TitlesOfParts): the values in order.
        const values = kids
          .flatMap((k) => (elements(k).length ? elements(k).map((v) => textOf(v)) : [textOf(k)]))
          .filter(Boolean);
        attrs.push([kebab(localName(el.name)), values.join(" | ")]);
      }
    }
    if (attrs.length)
      lines.push(marks.wrap(part, root, comment(`${label} ${commentAttrs(attrs)}`), label));
  };
  simple("docProps/core.xml", "properties");
  simple("docProps/app.xml", "application");
  const custom = pkg.xml("docProps/custom.xml")?.root;
  if (custom) {
    shown.add("docProps/custom.xml");
    const attrs: Attr[] = elements(custom).map((p) => [p.attrs.name ?? "?", textOf(p).trim()]);
    if (attrs.length)
      lines.push(
        marks.wrap(
          "docProps/custom.xml",
          custom,
          comment(`custom-properties ${commentAttrs(attrs)}`),
          "custom properties",
        ),
      );
  }
  return lines;
}

const SETTING_NAMES: Record<string, string> = {
  "w:trackRevisions": "track-revisions",
  "w:doNotTrackMoves": "do-not-track-moves",
  "w:doNotTrackFormatting": "do-not-track-formatting",
  "w:evenAndOddHeaders": "even-and-odd-headers",
  "w:mirrorMargins": "mirror-margins",
  "w:gutterAtTop": "gutter-at-top",
  "w:bookFoldPrinting": "book-fold",
  "w:updateFields": "update-fields-on-open",
  "w:autoHyphenation": "auto-hyphenation",
  "w:doNotHyphenateCaps": "do-not-hyphenate-caps",
  "w:displayBackgroundShape": "show-background",
  "w:embedTrueTypeFonts": "embed-fonts",
  "w:hideSpellingErrors": "hide-spelling-errors",
  "w:hideGrammaticalErrors": "hide-grammar-errors",
  "w:removePersonalInformation": "remove-personal-information",
  "w:alwaysShowPlaceholderText": "always-show-placeholder-text",
  "w:printFormsData": "print-form-data-only",
  "w:linkStyles": "link-styles",
};

function settings(
  pkg: Package,
  main: string,
  shown: Set<string>,
  props: PropContext,
  marks: SourceMarks,
): string[] {
  const part = pkg.related(main, "settings") ?? "word/settings.xml";
  const root = pkg.xml(part)?.root;
  if (!root) return [];
  shown.add(part);
  const attrs: Attr[] = [];
  const other: string[] = [];
  for (const el of elements(root)) {
    const name = SETTING_NAMES[el.name];
    const val = el.attrs["w:val"];
    if (name) attrs.push(val === "0" || val === "false" ? [name, "off"] : [name, true]);
    else if (el.name === "w:defaultTabStop") attrs.push(["default-tab", twips(val) ?? "?"]);
    else if (el.name === "w:documentProtection" || el.name === "w:writeProtection") {
      const edit = el.attrs["w:edit"];
      const enforced = el.attrs["w:enforcement"];
      attrs.push([
        el.name === "w:writeProtection" ? "write-protection" : "protection",
        [
          edit ?? "on",
          enforced === "1" || enforced === "true"
            ? "enforced"
            : enforced !== undefined
              ? "not enforced"
              : "",
        ]
          .filter(Boolean)
          .join(" "),
      ]);
    } else if (el.name === "w:zoom") attrs.push(["zoom", `${el.attrs["w:percent"] ?? "100"}%`]);
    else if (el.name === "w:view") attrs.push(["view", val ?? "?"]);
    else if (el.name === "w:revisionView") attrs.push(["revision-view", genericValue(el)]);
    else if (el.name === "w:compat") {
      for (const c of elements(el)) {
        if (c.name === "w:compatSetting" && c.attrs["w:name"] === "compatibilityMode")
          attrs.push(["compatibility-mode", c.attrs["w:val"] ?? "?"]);
      }
    } else if (el.name === "w:attachedTemplate") {
      const rel = pkg.relsOf(part).get(el.attrs["r:id"] ?? "");
      attrs.push(["template", rel?.target ?? "?"]);
    } else if (el.name === "w:mailMerge") attrs.push(["mail-merge", genericValue(el)]);
    else if (el.name === "w:footnotePr" || el.name === "w:endnotePr")
      attrs.push([
        localName(el.name) === "footnotePr" ? "footnotes" : "endnotes",
        genericValue(el),
      ]);
    else if (el.name === "w:documentType") attrs.push(["document-type", val ?? "?"]);
    else other.push(el.name);
  }
  void props;
  const lines = [marks.wrap(part, root, comment(`settings ${commentAttrs(attrs)}`), "settings")];
  if (other.length)
    lines.push(comment(`other settings (no effect on content): ${[...new Set(other)].join(" ")}`));
  return lines;
}

/* ---------------- sections ---------------- */

function sectionLine(
  sectPr: XElement | undefined,
  index: number,
  count: number,
  pkg: Package,
  main: string,
  props: PropContext,
  marks: SourceMarks,
): string {
  const head = `section ${index + 1} of ${count}`;
  if (!sectPr) return comment(`${head}: no section properties, so Word's defaults apply`);
  return marks.wrap(
    main,
    sectPr,
    comment(`${head} ${commentAttrs(sectionAttrs(sectPr, pkg, main, props))}`),
    `section ${index + 1}`,
  );
}

export function sectionAttrs(
  sectPr: XElement,
  pkg: Package,
  part: string,
  props: PropContext,
): Attr[] {
  const attrs: Attr[] = [];
  for (const el of elements(sectPr)) {
    const a = el.attrs;
    switch (el.name) {
      case "w:pgSz": {
        const w = a["w:w"] ?? "?";
        const h = a["w:h"] ?? "?";
        const paper = PAPER[`${w}x${h}`] ?? PAPER[`${h}x${w}`];
        const orient = a["w:orient"] ?? (Number(w) > Number(h) ? "landscape" : "portrait");
        attrs.push(["page", `${twips(w)} x ${twips(h)}${paper ? ` ${paper}` : ""} ${orient}`]);
        break;
      }
      case "w:pgMar": {
        const m = (k: string) => twips(a[k]) ?? "?";
        attrs.push(["margins", `${m("w:top")} ${m("w:right")} ${m("w:bottom")} ${m("w:left")}`]);
        if (a["w:header"] !== undefined) attrs.push(["header-distance", m("w:header")]);
        if (a["w:footer"] !== undefined) attrs.push(["footer-distance", m("w:footer")]);
        if (a["w:gutter"] !== undefined && a["w:gutter"] !== "0")
          attrs.push(["gutter", m("w:gutter")]);
        break;
      }
      case "w:cols": {
        const num = a["w:num"] ?? "1";
        attrs.push(["columns", num]);
        if (a["w:space"] !== undefined && num !== "1")
          attrs.push(["column-gap", twips(a["w:space"])!]);
        if (a["w:sep"] === "1" || a["w:sep"] === "true") attrs.push(["column-separator", true]);
        const cols = elements(el).map(
          (c) =>
            `${twips(c.attrs["w:w"])}${c.attrs["w:space"] ? `+${twips(c.attrs["w:space"])}` : ""}`,
        );
        if (cols.length) attrs.push(["column-widths", cols.join(" ")]);
        break;
      }
      case "w:type":
        attrs.push(["starts", a["w:val"] ?? "nextPage"]);
        break;
      case "w:headerReference":
      case "w:footerReference": {
        const rel = pkg.relsOf(part).get(a["r:id"] ?? "");
        attrs.push([
          `${el.name === "w:headerReference" ? "header" : "footer"}-${a["w:type"] ?? "default"}`,
          rel?.target ?? `${a["r:id"]} (missing relationship)`,
        ]);
        break;
      }
      case "w:pgNumType": {
        const parts = [
          a["w:fmt"],
          a["w:start"] !== undefined ? `start ${a["w:start"]}` : undefined,
          a["w:chapStyle"] ? `chapter style ${a["w:chapStyle"]}` : undefined,
        ].filter(Boolean);
        attrs.push(["page-numbers", parts.join(" ") || "default"]);
        break;
      }
      case "w:vAlign":
        attrs.push(["vertical-align", a["w:val"] ?? "?"]);
        break;
      case "w:pgBorders":
        for (const side of elements(el))
          attrs.push([`page-border-${localName(side.name)}`, describeBorder(side, props.theme)]);
        break;
      case "w:lnNumType":
        attrs.push(["line-numbers", genericValue(el)]);
        break;
      case "w:docGrid":
        attrs.push(["grid", genericValue(el)]);
        break;
      case "w:titlePg":
        attrs.push(["title-page", a["w:val"] === "0" || a["w:val"] === "false" ? "off" : true]);
        break;
      case "w:sectPrChange":
        attrs.push(["changed-by", revisionLabel(el)]);
        break;
      case "w:bidi":
        attrs.push(["rtl", true]);
        break;
      case "w:textDirection":
        attrs.push(["text-direction", a["w:val"] ?? "?"]);
        break;
      default:
        attrs.push([el.name, genericValue(el)]);
    }
  }
  return attrs;
}

/* ---------------- notes and comments ---------------- */

function indentBlocks(blocks: string[], first: string): string {
  return blocks
    .map((b, i) =>
      i === 0
        ? `${first}${b}`
        : b
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
    )
    .join("\n\n");
}

function notes(r: Renderer, pkg: Package, part: string, prefix: string, elName: string): string[] {
  const doc = pkg.xml(part);
  if (!doc?.root) return [comment(`${part} is missing or holds no XML`)];
  const restore = r.enter(part, doc, "notes");
  const lines: string[] = [];
  for (const note of elements(doc.root)) {
    if (note.name !== elName) {
      lines.push(errorFree(() => r.block(note, 0).join("\n\n")));
      continue;
    }
    const id = note.attrs["w:id"] ?? "?";
    const type = note.attrs["w:type"];
    try {
      const blocks = r.blocks(note);
      if (type && type !== "normal")
        lines.push(
          r.marks.wrap(
            part,
            note,
            [
              comment(
                `${elName === "w:footnote" ? "footnote" : "endnote"} ${id} type=${type} (Word's separator line, not a note)`,
              ),
              ...blocks,
            ].join("\n"),
            `${elName === "w:footnote" ? "footnote" : "endnote"} ${id}`,
          ),
        );
      else
        lines.push(
          r.marks.wrap(
            part,
            note,
            indentBlocks(blocks.length ? blocks : [""], `[^${prefix}${id}]: `),
            `${elName === "w:footnote" ? "footnote" : "endnote"} ${id}`,
          ),
        );
    } catch (error) {
      lines.push(errorPlaceholder(doc, note, error));
    }
  }
  restore();
  return lines;
}

function errorFree(fn: () => string): string {
  try {
    return fn();
  } catch (error) {
    return comment(`error: ${String(error)}`);
  }
}

function comments(
  r: Renderer,
  pkg: Package,
  part: string,
  main: string,
  shown: Set<string>,
): string[] {
  const doc = pkg.xml(part);
  if (!doc?.root) return [comment(`${part} is missing or holds no XML`)];
  // Replies and the resolved state live in commentsExtended.xml, keyed by paragraph id.
  const extendedPart = pkg.related(main, "commentsExtended");
  const extended = new Map<string, { parent?: string; done: boolean }>();
  if (extendedPart) {
    shown.add(extendedPart);
    for (const ex of elements(pkg.xml(extendedPart)?.root)) {
      const paraId = ex.attrs["w15:paraId"];
      if (paraId)
        extended.set(paraId, {
          parent: ex.attrs["w15:paraIdParent"],
          done: ex.attrs["w15:done"] === "1",
        });
    }
  }
  for (const extra of ["commentsIds", "commentsExtensible", "people"]) {
    const p = pkg.related(main, extra);
    if (p) shown.add(p);
  }
  const byParaId = new Map<string, string>();
  const restore = r.enter(part, doc, "comments");
  const lines: string[] = [];
  for (const c of elements(doc.root)) {
    if (c.name !== "w:comment") continue;
    const id = c.attrs["w:id"] ?? "?";
    const paras = elements(c).filter((p) => p.name === "w:p");
    const lastParaId = paras[paras.length - 1]?.attrs["w14:paraId"];
    if (lastParaId) byParaId.set(lastParaId, id);
    const attrs: Attr[] = [["id", id]];
    if (c.attrs["w:author"]) attrs.push(["author", c.attrs["w:author"]]);
    if (c.attrs["w:initials"]) attrs.push(["initials", c.attrs["w:initials"]]);
    if (c.attrs["w:date"]) attrs.push(["date", c.attrs["w:date"]]);
    const ex = lastParaId ? extended.get(lastParaId) : undefined;
    if (ex?.parent) attrs.push(["reply-to", byParaId.get(ex.parent) ?? ex.parent]);
    if (ex?.done) attrs.push(["resolved", true]);
    const anchor = r.commentAnchors.get(id);
    if (anchor !== undefined)
      attrs.push(["on", anchor.length > 120 ? anchor.slice(0, 120) + "…" : anchor]);
    try {
      lines.push(
        r.marks.wrap(
          part,
          c,
          [comment(`comment ${commentAttrs(attrs)}`), ...r.blocks(c)].join("\n\n"),
          `comment ${id}`,
        ),
      );
    } catch (error) {
      lines.push(errorPlaceholder(doc, c, error));
    }
  }
  restore();
  return lines;
}

function headersFooters(
  r: Renderer,
  pkg: Package,
  main: string,
  sections: { sectPr: XElement | undefined }[],
  shown: Set<string>,
): string[] {
  const uses = new Map<string, string[]>();
  sections.forEach((s, i) => {
    for (const ref of elements(s.sectPr)) {
      if (ref.name !== "w:headerReference" && ref.name !== "w:footerReference") continue;
      const rel = pkg.relsOf(main).get(ref.attrs["r:id"] ?? "");
      if (!rel) continue;
      const kind = ref.name === "w:headerReference" ? "header" : "footer";
      const list = uses.get(rel.target) ?? [];
      list.push(`section ${i + 1} ${kind} ${ref.attrs["w:type"] ?? "default"}`);
      uses.set(rel.target, list);
    }
  });
  // Parts related to the document but referenced by no section.
  for (const rel of pkg.relsOf(main).values()) {
    if ((rel.type === "header" || rel.type === "footer") && !uses.has(rel.target))
      uses.set(rel.target, [`${rel.type} not used by any section`]);
  }
  const lines: string[] = [];
  for (const [part, used] of uses) {
    shown.add(part);
    const doc = pkg.xml(part);
    if (!doc?.root) {
      lines.push(comment(`${part}: ${used.join(", ")}`));
      lines.push(comment(`${part} is missing or holds no XML`));
      continue;
    }
    lines.push(
      r.marks.wrap(
        part,
        doc.root,
        comment(`${part}: ${used.join(", ")}`),
        part.includes("footer") ? "footer" : "header",
      ),
    );
    const restore = r.enter(part, doc, "header-footer");
    try {
      lines.push(...r.blocks(doc.root));
    } finally {
      restore();
    }
  }
  return lines;
}

/* ---------------- styles and lists ---------------- */

function stylesAppendix(
  styles: Styles,
  used: Set<string>,
  props: PropContext,
  marks: SourceMarks,
  part: string,
): string[] {
  const include = new Set<string>();
  const add = (id: string | undefined) => {
    if (id === undefined || include.has(id) || !styles.byId.has(id)) return;
    include.add(id);
    const def = styles.byId.get(id)!;
    add(def.basedOn);
    add(def.link);
  };
  for (const id of used) add(id);
  for (const id of Object.values(styles.defaults)) add(id);
  const lines: string[] = [];
  const defaults: Attr[] = [];
  const dp = describeProps(styles.docDefaultsP, "p", props);
  const dr = describeProps(styles.docDefaultsR, "r", props);
  if (dp.length || dr.length) {
    lines.push(
      comment(
        `document defaults paragraph: ${attrsText(dp) || "none"} | text: ${attrsText(dr) || "none"}`,
      ),
    );
  }
  void defaults;
  const missing = [...used].filter((id) => !styles.byId.has(id));
  if (missing.length)
    lines.push(comment(`styles used but not defined in styles.xml: ${missing.join(", ")}`));
  for (const id of styles.order) {
    if (!include.has(id)) continue;
    const def = styles.byId.get(id)!;
    const head: Attr[] = [
      ["id", def.id],
      ["type", def.type],
    ];
    if (def.isDefault) head.push(["default", true]);
    if (def.basedOn) head.push(["based-on", styles.name(def.basedOn)]);
    if (def.next && def.next !== def.id) head.push(["next", styles.name(def.next)]);
    if (def.link) head.push(["linked", styles.name(def.link)]);
    for (const el of elements(def.el)) {
      if (
        [
          "w:qFormat",
          "w:hidden",
          "w:semiHidden",
          "w:unhideWhenUsed",
          "w:locked",
          "w:autoRedefine",
          "w:personal",
        ].includes(el.name)
      ) {
        head.push([
          localName(el.name).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
          el.attrs["w:val"] === "0" ? "off" : true,
        ]);
      } else if (el.name === "w:uiPriority") head.push(["ui-priority", el.attrs["w:val"] ?? "?"]);
      else if (el.name === "w:aliases") head.push(["aliases", el.attrs["w:val"] ?? ""]);
    }
    const block = [comment(`style ${JSON.stringify(def.name)} ${commentAttrs(head)}`)];
    const own = describeStyle(def.el, props, false);
    if (own) block.push(comment(`  defines ${own}`));
    const resolved = describeResolved(styles, def.id, def.type, props);
    if (resolved && resolved !== own) block.push(comment(`  resolved ${resolved}`));
    for (const cond of elements(def.el).filter((e) => e.name === "w:tblStylePr")) {
      block.push(
        comment(
          `  when ${cond.attrs["w:type"] ?? "?"}: ${describeStyle(cond, props, true) || "nothing"}`,
        ),
      );
    }
    lines.push(marks.wrap(part, def.el, block.join("\n"), `style ${def.name}`));
  }
  if (styles.latentCount)
    lines.push(
      comment(
        `${styles.latentCount} latent style ${styles.latentCount === 1 ? "entry" : "entries"} (Word's list of built-in styles not yet in use) are not listed`,
      ),
    );
  return lines;
}

function describeStyle(el: XElement, props: PropContext, conditional: boolean): string {
  const groups: string[] = [];
  const group = (label: string, name: string, kind: "p" | "r" | "tbl" | "tr" | "tc") => {
    const attrs = describeProps(child(el, name), kind, props);
    if (attrs.length) groups.push(`${label}: ${attrsText(attrs)}`);
  };
  group("paragraph", "w:pPr", "p");
  group("text", "w:rPr", "r");
  group("table", "w:tblPr", "tbl");
  group("row", "w:trPr", "tr");
  group("cell", "w:tcPr", "tc");
  const numPr = child(child(el, "w:pPr"), "w:numPr");
  if (numPr)
    groups.push(
      `list: ${child(numPr, "w:numId")?.attrs["w:val"] ?? "?"} level ${Number(child(numPr, "w:ilvl")?.attrs["w:val"] ?? 0) + 1}`,
    );
  void conditional;
  return groups.join(" | ");
}

function describeResolved(styles: Styles, id: string, type: string, props: PropContext): string {
  const groups: string[] = [];
  const group = (
    label: string,
    which: string,
    kind: "p" | "r" | "tbl" | "tr" | "tc",
    withDefaults: boolean,
  ) => {
    const attrs = describeProps(
      asContainer(which, styles.resolved(id, which, withDefaults)),
      kind,
      props,
    );
    if (attrs.length) groups.push(`${label}: ${attrsText(attrs)}`);
  };
  if (type === "paragraph" || type === "table")
    group("paragraph", "w:pPr", "p", type === "paragraph");
  if (type !== "numbering") group("text", "w:rPr", "r", true);
  if (type === "table") {
    group("table", "w:tblPr", "tbl", false);
    group("row", "w:trPr", "tr", false);
    group("cell", "w:tcPr", "tc", false);
  }
  return groups.join(" | ");
}

function listsAppendix(
  numbering: Numbering,
  props: PropContext,
  marks: SourceMarks,
  part: string,
): string[] {
  const lines: string[] = [];
  for (const numId of numbering.used) {
    const num = numbering.nums.get(numId);
    const abs = numbering.abstractOf(numId);
    if (!num || !abs) {
      lines.push(comment(`list ${numId}: not defined in numbering.xml`));
      continue;
    }
    const type = child(abs.el, "w:multiLevelType")?.attrs["w:val"];
    const name = child(abs.el, "w:name")?.attrs["w:val"];
    const block = [
      comment(
        `list ${numId} definition=${abs.id}${type ? ` type=${type}` : ""}${name ? ` name=${JSON.stringify(name)}` : ""}`,
      ),
    ];
    for (let ilvl = 0; ilvl < 9; ilvl++) {
      const level = numbering.level(numId, ilvl);
      if (!level) continue;
      const override = num.overrides.get(ilvl);
      const attrs: Attr[] = [
        ["format", level.numFmt],
        ["text", visibleChars(level.lvlText)],
        ["start", String(level.start)],
      ];
      if (override?.start !== undefined) attrs.push(["start-override", String(override.start)]);
      if (override?.level) attrs.push(["level-override", true]);
      if (level.restart !== undefined) attrs.push(["restart-after", String(level.restart)]);
      if (level.isLgl) attrs.push(["legal", true]);
      for (const el of elements(level.el)) {
        const val = el.attrs["w:val"];
        if (el.name === "w:suff") attrs.push(["after-number", val ?? "tab"]);
        else if (el.name === "w:lvlJc")
          attrs.push(["align", val === "center" ? "centre" : (val ?? "?")]);
        else if (el.name === "w:pStyle") attrs.push(["style", props.styleName(val ?? "")]);
        else if (el.name === "w:pPr") attrs.push(...describeProps(el, "p", props));
        else if (el.name === "w:rPr") {
          const r = describeProps(el, "r", props);
          if (r.length) attrs.push(["number-format", attrsText(r)]);
        } else if (el.name === "w:lvlPicBulletId") attrs.push(["picture-bullet", val ?? "?"]);
      }
      block.push(comment(`  level ${ilvl + 1} ${commentAttrs(attrs)}`));
    }
    lines.push(marks.wrap(part, num.el, block.join("\n"), `list ${numId}`));
  }
  return lines;
}

export type { XDocument };
