/**
 * The body renderer: blocks (paragraphs, tables, content controls) and their inline content, for
 * the main document and for headers, footers, notes and comments.
 */
import { BOLD, ITALIC, STRIKE, writeInline, type Item, type Wrapper } from "./inline";
import { linearMath } from "./math";
import {
  comment,
  commentAttrs,
  emu,
  errorPlaceholder,
  escapeText,
  rawPlaceholder,
  tag,
  tagAttrs,
  twips,
  type Attr,
} from "./notation";
import type { Numbering } from "./numbering";
import type { Package } from "./package";
import { describeProps, genericValue, revisionLabel, type PropContext } from "./props";
import type { Styles } from "./styles";
import { child, elements, localName, textOf, type XDocument, type XElement } from "./xml";

/** How deep tables, text boxes and content controls may nest before the view stops descending. */
export const MAX_DEPTH = 40;

interface Field {
  instr: string;
  phase: "instr" | "result";
  attrs: Attr[];
  /** Whether the opening tag has been written. */
  opened: boolean;
}

export interface CommentAnchor {
  text: string;
}

export class Renderer {
  /** The part being rendered, for relationships and raw placeholders. */
  part = "";
  doc: XDocument = { root: null, source: "", problems: [] };
  readonly usedStyles = new Set<string>();
  readonly commentAnchors = new Map<string, string>();
  private readonly openComments = new Set<string>();
  private readonly fields: Field[] = [];
  private readonly bookmarkNames = new Map<string, string>();
  private listWidths: number[] = [];
  readonly usedMedia = new Set<string>();

  constructor(
    readonly pkg: Package,
    readonly styles: Styles,
    readonly numbering: Numbering,
    readonly props: PropContext,
  ) {}

  /** Switches to another part; returns a function that switches back. */
  enter(part: string, doc: XDocument): () => void {
    const prev = { part: this.part, doc: this.doc, list: this.listWidths };
    this.part = part;
    this.doc = doc;
    this.listWidths = [];
    return () => {
      this.part = prev.part;
      this.doc = prev.doc;
      this.listWidths = prev.list;
    };
  }

  /* ================= blocks ================= */

  /** Renders block-level content. Each returned string is one block (one or more lines). */
  blocks(container: XElement, depth = 0): string[] {
    const out: string[] = [];
    for (const el of elements(container)) {
      try {
        out.push(...this.block(el, depth));
      } catch (error) {
        out.push(errorPlaceholder(this.doc, el, error));
      }
    }
    return out;
  }

  block(el: XElement, depth: number): string[] {
    if (el.name !== "w:p") this.listWidths = [];
    switch (el.name) {
      case "w:p":
        return [this.paragraphLine(el)];
      case "w:tbl":
        return [this.table(el, depth)];
      case "w:sdt":
      case "w:customXml": {
        if (depth > MAX_DEPTH) return [rawPlaceholder(this.doc, el, 200)];
        const head =
          el.name === "w:sdt"
            ? `sdt ${commentAttrs(this.sdtAttrs(child(el, "w:sdtPr")))}`
            : `custom-xml ${commentAttrs(customXmlAttrs(el))}`;
        const content = el.name === "w:sdt" ? child(el, "w:sdtContent") : el;
        const inner = content ? this.blocks(content, depth + 1) : [];
        const close = el.name === "w:sdt" ? "/sdt" : "/custom-xml";
        return [comment(head.trim()), ...inner, comment(close)];
      }
      case "w:sectPr":
      case "w:proofErr":
        return [];
      case "mc:AlternateContent": {
        const { chosen, note } = chooseBranch(el);
        return [comment(note), ...(chosen ? this.blocks(chosen, depth + 1) : [])];
      }
      case "w:altChunk": {
        const rel = this.pkg.relsOf(this.part).get(el.attrs["r:id"] ?? "");
        return [
          comment(
            `alt-chunk target=${JSON.stringify(rel?.target ?? el.attrs["r:id"] ?? "?")} (imported content, open the part to see it)`,
          ),
        ];
      }
      case "w:ins":
      case "w:del":
      case "w:moveFrom":
      case "w:moveTo": {
        const name = revisionTag(el.name);
        return [
          comment(`${name} ${commentAttrs(revisionAttrs(el))}`),
          ...this.blocks(el, depth + 1),
          comment(`/${name}`),
        ];
      }
      default: {
        // Point markers (bookmarks, comment ranges, permissions) can sit between paragraphs.
        const items: Item[] = [];
        if (this.inlineElement(el, [], items, depth)) return [writeInline(items)];
        return [rawPlaceholder(this.doc, el)];
      }
    }
  }

  /* ================= paragraphs ================= */

  /** A paragraph as one line: prefix, content and the trailing paragraph comment. */
  paragraphLine(p: XElement, options: { inTable?: boolean; noPrefix?: boolean } = {}): string {
    const { prefix, attrs, items } = this.paragraph(p, options.noPrefix === true);
    const text = writeInline(items, { inTable: options.inTable });
    if (text === "")
      return `${prefix}${comment(commentAttrs([["p", true], ["empty", true], ...attrs]))}`;
    return attrs.length
      ? `${prefix}${text} ${comment(commentAttrs([["p", true], ...attrs]))}`
      : `${prefix}${text}`;
  }

  paragraph(p: XElement, noPrefix: boolean): { prefix: string; attrs: Attr[]; items: Item[] } {
    const pPr = child(p, "w:pPr");
    const styleId = child(pPr, "w:pStyle")?.attrs["w:val"] ?? this.styles.defaults.paragraph;
    const attrs: Attr[] = [];
    if (styleId !== undefined) {
      this.usedStyles.add(styleId);
      if (styleId !== this.styles.defaults.paragraph)
        attrs.push(["style", this.styles.name(styleId)]);
    }
    // Numbering: direct, else from the style.
    const numPr = child(pPr, "w:numPr");
    let numId = child(numPr, "w:numId")?.attrs["w:val"];
    let ilvl = Number(child(numPr, "w:ilvl")?.attrs["w:val"] ?? NaN);
    const fromStyle = this.styles.numbering(styleId);
    if (numId === undefined && fromStyle) numId = fromStyle.numId;
    if (!Number.isFinite(ilvl))
      ilvl = numPr && numId !== fromStyle?.numId ? 0 : (fromStyle?.ilvl ?? 0);
    if (numPr && child(numPr, "w:ins"))
      attrs.push(["numbering-inserted", revisionLabel(child(numPr, "w:ins")!)]);

    const direct = pPr ? describeProps(pPr, "p", this.props) : [];
    const outline = child(pPr, "w:outlineLvl")?.attrs["w:val"];
    let heading =
      outline !== undefined
        ? Number(outline) < 9
          ? Number(outline) + 1
          : undefined
        : this.styles.headingLevel(styleId);
    if (heading !== undefined && !Number.isFinite(heading)) heading = undefined;

    let prefix = "";
    if (!noPrefix && heading !== undefined) {
      prefix = "#".repeat(Math.min(6, heading)) + " ";
      if (heading > 6) attrs.push(["heading-level", String(heading)]);
    }
    if (numId !== undefined && numId !== "0") {
      const label = this.numbering.next(numId, ilvl);
      attrs.push(["list", numId], ["level", String(ilvl + 1)]);
      if (!label.level) {
        attrs.push(["numbering", "not defined"]);
      } else if (heading !== undefined || noPrefix) {
        if (label.label) attrs.push(["numbering", label.label]);
      } else {
        const marker = label.bullet
          ? "-"
          : label.label === ""
            ? ""
            : label.markdownOrdered
              ? label.label
              : escapeText(label.label);
        if (marker === "") attrs.push(["numbering", "none"]);
        else {
          const indent = this.listIndent(ilvl, marker.length + 1);
          prefix = " ".repeat(indent) + marker + " ";
        }
        if (!label.bullet && !label.markdownOrdered && label.label !== "")
          attrs.push(["numbering", label.label]);
      }
    } else if (!noPrefix) this.listWidths = [];
    if (!noPrefix && this.styles.isQuote(styleId) && heading === undefined) prefix = "> " + prefix;

    attrs.push(...direct);
    // The paragraph mark's own run formatting and revisions.
    const markRPr = child(pPr, "w:rPr");
    if (markRPr) {
      const mark = this.runAttrs(markRPr);
      if (mark.length) attrs.push(["mark", commentAttrs(mark)]);
      for (const rev of ["w:ins", "w:del", "w:moveFrom", "w:moveTo"]) {
        const r = child(markRPr, rev);
        if (r) attrs.push([`mark-${revisionTag(rev)}`, revisionLabel(r)]);
      }
    }
    const change = child(pPr, "w:pPrChange");
    if (change) {
      const was = child(change, "w:pPr");
      const wasStyle = child(was, "w:pStyle")?.attrs["w:val"];
      const wasAttrs: Attr[] = [
        ...(wasStyle ? ([["style", this.styles.name(wasStyle)]] as Attr[]) : []),
        ...describeProps(was, "p", this.props),
      ];
      attrs.push(
        ["changed-by", revisionLabel(change)],
        ["was", commentAttrs(wasAttrs) || "no formatting"],
      );
    }
    const sectPr = child(pPr, "w:sectPr");
    if (sectPr) attrs.push(["section-ends", true]);

    const items: Item[] = [];
    for (const el of elements(p)) {
      if (el.name === "w:pPr") continue;
      try {
        if (!this.inlineElement(el, [], items, 0)) items.push(this.rawToken(el));
      } catch (error) {
        items.push({ wrappers: [], text: errorPlaceholder(this.doc, el, error), token: true });
      }
    }
    return { prefix, attrs, items };
  }

  private listIndent(ilvl: number, width: number): number {
    this.listWidths.length = Math.min(this.listWidths.length, ilvl + 1);
    let indent = 0;
    for (let i = 0; i < ilvl; i++) indent += this.listWidths[i] ?? 2;
    this.listWidths[ilvl] = width;
    return indent;
  }

  private rawToken(el: XElement, limit?: number): Item {
    return { wrappers: [], text: rawPlaceholder(this.doc, el, limit), token: true };
  }

  /* ================= inline ================= */

  private emit(items: Item[], item: Item): void {
    const sink = this.instrSink();
    if (sink !== undefined) {
      if (sink && !item.token) sink.instr += item.text;
      return;
    }
    if (!item.token && this.openComments.size) {
      for (const id of this.openComments) {
        const prev = this.commentAnchors.get(id) ?? "";
        if (prev.length < 200) this.commentAnchors.set(id, prev + item.text);
      }
    }
    items.push(item);
  }

  private token(items: Item[], wrappers: readonly Wrapper[], text: string): void {
    this.emit(items, { wrappers, text, token: true });
  }

  /**
   * Where inline content goes while fields are open: the innermost field when it is reading its
   * instruction; null (dropped) inside the cached result of a field that is itself part of another
   * field's instruction; undefined for normal output.
   */
  private instrSink(): Field | null | undefined {
    const top = this.fields[this.fields.length - 1];
    if (!top) return undefined;
    if (top.phase === "instr") return top;
    return this.fields.some((f) => f.phase === "instr") ? null : undefined;
  }

  /** Renders one inline element. Returns false if it is not something the view understands. */
  inlineElement(el: XElement, wrappers: readonly Wrapper[], items: Item[], depth: number): boolean {
    const a = el.attrs;
    switch (el.name) {
      case "w:r":
        this.run(el, wrappers, items, depth);
        return true;
      case "w:hyperlink": {
        const rel = a["r:id"] ? this.pkg.relsOf(this.part).get(a["r:id"]) : undefined;
        let url = rel ? rel.target : a["r:id"] ? `${a["r:id"]} (missing relationship)` : "";
        if (a["w:anchor"]) url += `#${a["w:anchor"]}`;
        const title = a["w:tooltip"] ? ` ${JSON.stringify(a["w:tooltip"])}` : "";
        const extra: Attr[] = [];
        if (a["w:tgtFrame"]) extra.push(["target-frame", a["w:tgtFrame"]]);
        if (a["w:docLocation"]) extra.push(["doc-location", a["w:docLocation"]]);
        const inner: Wrapper[] = [...wrappers];
        if (extra.length)
          inner.push({
            key: `hl-extra${tagAttrs(extra)}${el.start}`,
            open: tag("hyperlink", extra),
            close: "</hyperlink>",
          });
        inner.push({ key: `link${el.start}`, open: "[", close: `](${linkTarget(url)}${title})` });
        this.inlineChildren(el, inner, items, depth);
        return true;
      }
      case "w:ins":
      case "w:del":
      case "w:moveFrom":
      case "w:moveTo": {
        const name = revisionTag(el.name);
        const attrs = revisionAttrs(el);
        this.inlineChildren(
          el,
          [...wrappers, { key: `${name}${el.start}`, open: tag(name, attrs), close: `</${name}>` }],
          items,
          depth,
        );
        return true;
      }
      case "w:fldSimple": {
        const attrs: Attr[] = [["code", normaliseInstr(a["w:instr"] ?? "")]];
        if (a["w:fldLock"] === "1" || a["w:fldLock"] === "true") attrs.push(["locked", true]);
        if (a["w:dirty"] === "1" || a["w:dirty"] === "true") attrs.push(["dirty", true]);
        const hasContent = elements(el).some((c) => c.name !== "w:fldData");
        if (!hasContent) this.token(items, wrappers, tag("field", attrs, true));
        else
          this.inlineChildren(
            el,
            [
              ...wrappers,
              { key: `field${el.start}`, open: tag("field", attrs), close: "</field>" },
            ],
            items,
            depth,
          );
        return true;
      }
      case "w:sdt": {
        if (depth > MAX_DEPTH) return false;
        const attrs = this.sdtAttrs(child(el, "w:sdtPr"));
        const content = child(el, "w:sdtContent");
        const w: Wrapper = { key: `sdt${el.start}`, open: tag("sdt", attrs), close: "</sdt>" };
        if (content && elements(content).length)
          this.inlineChildren(content, [...wrappers, w], items, depth + 1);
        else this.token(items, wrappers, tag("sdt", attrs, true));
        return true;
      }
      case "w:smartTag": {
        const attrs: Attr[] = [["element", a["w:element"] ?? "?"]];
        if (a["w:uri"]) attrs.push(["uri", a["w:uri"]]);
        for (const attr of elements(child(el, "w:smartTagPr"))) {
          attrs.push([`prop-${attr.attrs["w:name"] ?? "?"}`, attr.attrs["w:val"] ?? ""]);
        }
        this.inlineChildren(
          el,
          [
            ...wrappers,
            { key: `smart${el.start}`, open: tag("smart-tag", attrs), close: "</smart-tag>" },
          ],
          items,
          depth,
        );
        return true;
      }
      case "w:customXml":
        this.inlineChildren(
          el,
          [
            ...wrappers,
            {
              key: `cx${el.start}`,
              open: tag("custom-xml", customXmlAttrs(el)),
              close: "</custom-xml>",
            },
          ],
          items,
          depth,
        );
        return true;
      case "w:dir":
      case "w:bdo":
        this.inlineChildren(
          el,
          [
            ...wrappers,
            {
              key: `${el.name}${el.start}`,
              open: tag(localName(el.name), [["val", a["w:val"] ?? "?"]]),
              close: `</${localName(el.name)}>`,
            },
          ],
          items,
          depth,
        );
        return true;
      case "w:smartTagPr":
      case "w:customXmlPr":
      case "w:sdtPr":
      case "w:sdtEndPr":
      case "w:proofErr":
      case "w:fldData":
        return true;
      case "w:bookmarkStart": {
        const id = a["w:id"] ?? "";
        const name = a["w:name"] ?? id;
        this.bookmarkNames.set(id, name);
        const next = nextElement(el);
        const extra: Attr[] = [];
        if (a["w:colFirst"] !== undefined)
          extra.push(["columns", `${a["w:colFirst"]}-${a["w:colLast"] ?? "?"}`]);
        if (next?.name === "w:bookmarkEnd" && next.attrs["w:id"] === id) {
          this.token(items, wrappers, tag("bookmark", [["name", name], ...extra], true));
          skipped.add(next);
        } else this.token(items, wrappers, tag("bookmark-start", [["name", name], ...extra], true));
        return true;
      }
      case "w:bookmarkEnd":
        if (skipped.has(el)) return true;
        this.token(
          items,
          wrappers,
          tag(
            "bookmark-end",
            [["name", this.bookmarkNames.get(a["w:id"] ?? "") ?? a["w:id"] ?? "?"]],
            true,
          ),
        );
        return true;
      case "w:commentRangeStart":
        this.token(items, wrappers, tag("comment", [["id", a["w:id"] ?? "?"]]));
        this.openComments.add(a["w:id"] ?? "");
        return true;
      case "w:commentRangeEnd":
        this.openComments.delete(a["w:id"] ?? "");
        this.token(items, wrappers, "</comment>");
        return true;
      case "w:moveFromRangeStart":
      case "w:moveToRangeStart":
        this.token(
          items,
          wrappers,
          tag(el.name === "w:moveFromRangeStart" ? "move-from-range" : "move-to-range", [
            ["name", a["w:name"] ?? "?"],
            ...revisionAttrs(el),
          ]),
        );
        return true;
      case "w:moveFromRangeEnd":
        this.token(items, wrappers, "</move-from-range>");
        return true;
      case "w:moveToRangeEnd":
        this.token(items, wrappers, "</move-to-range>");
        return true;
      case "w:permStart":
      case "w:permEnd": {
        const attrs: Attr[] = [["id", a["w:id"] ?? "?"]];
        if (a["w:ed"]) attrs.push(["editor", a["w:ed"]]);
        if (a["w:edGrp"]) attrs.push(["group", a["w:edGrp"]]);
        this.token(
          items,
          wrappers,
          tag(el.name === "w:permStart" ? "permission-start" : "permission-end", attrs, true),
        );
        return true;
      }
      case "m:oMath":
      case "m:oMathPara":
        this.token(items, wrappers, this.math(el));
        return true;
      case "mc:AlternateContent": {
        const { chosen, note } = chooseBranch(el);
        this.token(items, wrappers, comment(note));
        if (chosen) this.inlineChildren(chosen, wrappers, items, depth);
        return true;
      }
      case "w:subDoc": {
        const rel = this.pkg.relsOf(this.part).get(a["r:id"] ?? "");
        this.token(
          items,
          wrappers,
          tag("subdocument", [["target", rel?.target ?? a["r:id"] ?? "?"]], true),
        );
        return true;
      }
    }
    return false;
  }

  private inlineChildren(
    el: XElement,
    wrappers: readonly Wrapper[],
    items: Item[],
    depth: number,
  ): void {
    for (const c of elements(el)) {
      if (!this.inlineElement(c, wrappers, items, depth)) this.emit(items, this.rawToken(c));
    }
  }

  /** Attributes for a run's formatting (character style first). */
  runAttrs(rPr: XElement | undefined): Attr[] {
    if (!rPr) return [];
    const out: Attr[] = [];
    const style = child(rPr, "w:rStyle")?.attrs["w:val"];
    if (style) {
      this.usedStyles.add(style);
      out.push(["style", this.styles.name(style)]);
    }
    out.push(...describeProps(rPr, "r", this.props));
    return out;
  }

  /** The wrappers a run's own formatting adds, outermost first. */
  runWrappers(rPr: XElement | undefined): Wrapper[] {
    const attrs = this.runAttrs(rPr);
    const span: Attr[] = [];
    let bold = false;
    let italic = false;
    let strike = false;
    let u: Attr[] | undefined;
    let vert: string | undefined;
    for (const attr of attrs) {
      const [k, v] = attr;
      if (k === "bold" && v === true) bold = true;
      else if (k === "italic" && v === true) italic = true;
      else if (k === "strike" && v === true) strike = true;
      else if (k === "underline" && v !== "none")
        u = [...(u ?? []), ...(v === "single" ? [] : ([["type", v]] as Attr[]))];
      else if (k === "underline-colour") u = [...(u ?? []), ["colour", v]];
      else if (k === "vertical" && (v === "superscript" || v === "subscript"))
        vert = v === "superscript" ? "sup" : "sub";
      else span.push(attr);
    }
    const out: Wrapper[] = [];
    const change = child(rPr, "w:rPrChange");
    if (change) {
      const was = this.runAttrs(child(change, "w:rPr"));
      const attrs: Attr[] = [
        ...revisionAttrs(change),
        ["was", commentAttrs(was) || "no formatting"],
      ];
      out.push({
        key: `fc${tagAttrs(attrs)}`,
        open: tag("format-change", attrs),
        close: "</format-change>",
      });
    }
    if (span.length) {
      const open = tag("span", span);
      out.push({ key: open, open, close: "</span>" });
    }
    if (u) {
      const open = tag("u", u);
      out.push({ key: open, open, close: "</u>" });
    }
    if (vert) out.push({ key: vert, open: `<${vert}>`, close: `</${vert}>` });
    if (strike) out.push(STRIKE);
    if (bold) out.push(BOLD);
    if (italic) out.push(ITALIC);
    return out;
  }

  private run(r: XElement, outer: readonly Wrapper[], items: Item[], depth: number): void {
    const rPr = child(r, "w:rPr");
    const wrappers = [...outer, ...this.runWrappers(rPr)];
    for (const el of elements(r)) {
      try {
        this.runChild(el, wrappers, items, depth);
      } catch (error) {
        this.emit(items, {
          wrappers: [],
          text: errorPlaceholder(this.doc, el, error),
          token: true,
        });
      }
    }
  }

  private runChild(el: XElement, wrappers: readonly Wrapper[], items: Item[], depth: number): void {
    const a = el.attrs;
    const tok = (text: string) => this.token(items, wrappers, text);
    switch (el.name) {
      case "w:rPr":
      case "w:lastRenderedPageBreak":
        return;
      case "w:t":
      case "w:delText": {
        const text = textOf(el);
        // Tabs and line feeds in w:t are not Word's way, but show them rather than lose them.
        const parts = text.split(/(\t|\r\n|\n|\r)/);
        for (const part of parts) {
          if (part === "") continue;
          if (part === "\t") tok("<tab/>");
          else if (/^[\r\n]+$/.test(part)) tok("<br/>");
          else this.emit(items, { wrappers, text: part, token: false });
        }
        return;
      }
      case "w:instrText":
      case "w:delInstrText": {
        const field = this.instrSink();
        if (field) field.instr += textOf(el);
        else if (field === undefined)
          tok(tag("field-code", [], false) + escapeText(textOf(el)) + "</field-code>");
        return;
      }
      case "w:fldChar":
        this.fieldChar(el, wrappers, items);
        return;
      case "w:tab":
        tok("<tab/>");
        return;
      case "w:br": {
        const attrs: Attr[] = [];
        if (a["w:type"] && a["w:type"] !== "textWrapping") attrs.push(["type", a["w:type"]]);
        if (a["w:clear"] && a["w:clear"] !== "none") attrs.push(["clear", a["w:clear"]]);
        tok(tag("br", attrs, true));
        return;
      }
      case "w:cr":
        tok("<br/>");
        return;
      case "w:sym":
        tok(
          tag(
            "sym",
            [
              ["font", a["w:font"] ?? "?"],
              ["char", a["w:char"] ?? "?"],
            ],
            true,
          ),
        );
        return;
      case "w:softHyphen":
        tok("<shy/>");
        return;
      case "w:noBreakHyphen":
        tok("<nbhy/>");
        return;
      case "w:ptab":
        tok(
          tag(
            "ptab",
            [
              ["align", a["w:alignment"] ?? "?"],
              ["relative-to", a["w:relativeTo"] ?? "?"],
              ["leader", a["w:leader"] ?? "none"],
            ],
            true,
          ),
        );
        return;
      case "w:footnoteReference":
      case "w:endnoteReference": {
        const id = a["w:id"] ?? "?";
        const ref = el.name === "w:footnoteReference" ? `[^${id}]` : `[^e${id}]`;
        tok(
          a["w:customMarkFollows"] === "1" || a["w:customMarkFollows"] === "true"
            ? `${ref}<custom-mark/>`
            : ref,
        );
        return;
      }
      case "w:commentReference": {
        const id = a["w:id"] ?? "?";
        tok(tag("comment-ref", [["id", id]], true));
        return;
      }
      case "w:footnoteRef":
      case "w:endnoteRef":
        tok("<note-number/>");
        return;
      case "w:annotationRef":
        tok("<comment-mark/>");
        return;
      case "w:separator":
        tok("<separator/>");
        return;
      case "w:continuationSeparator":
        tok("<continuation-separator/>");
        return;
      case "w:pgNum":
        tok("<page-number/>");
        return;
      case "w:dayShort":
      case "w:dayLong":
      case "w:monthShort":
      case "w:monthLong":
      case "w:yearShort":
      case "w:yearLong":
        tok(tag("date-part", [["kind", localName(el.name)]], true));
        return;
      case "w:drawing":
        tok(this.drawing(el, depth));
        return;
      case "w:pict":
      case "w:object":
        tok(this.vml(el, depth));
        return;
      case "mc:AlternateContent": {
        const { chosen, note } = chooseBranch(el);
        tok(comment(note));
        if (chosen) for (const c of elements(chosen)) this.runChild(c, wrappers, items, depth);
        return;
      }
      case "w:ruby": {
        const rt = child(el, "w:rt");
        const base = child(el, "w:rubyBase");
        const guide = elements(rt)
          .map((r) => textOf(r))
          .join("");
        this.inlineChildren(
          base ?? el,
          [
            ...wrappers,
            { key: `ruby${el.start}`, open: tag("ruby", [["guide", guide]]), close: "</ruby>" },
          ],
          items,
          depth,
        );
        return;
      }
      case "m:oMath":
        tok(this.math(el));
        return;
    }
    this.emit(items, this.rawToken(el));
  }

  private fieldChar(el: XElement, wrappers: readonly Wrapper[], items: Item[]): void {
    const type = el.attrs["w:fldCharType"];
    if (type === "begin") {
      const attrs: Attr[] = [];
      if (el.attrs["w:fldLock"] === "1" || el.attrs["w:fldLock"] === "true")
        attrs.push(["locked", true]);
      if (el.attrs["w:dirty"] === "1" || el.attrs["w:dirty"] === "true")
        attrs.push(["dirty", true]);
      const ff = child(el, "w:ffData");
      if (ff) attrs.push(["form-field", genericValue(ff)]);
      this.fields.push({ instr: "", phase: "instr", attrs, opened: false });
      return;
    }
    const field = this.fields[this.fields.length - 1];
    if (!field) {
      this.token(items, wrappers, tag("field-char", [["type", type ?? "?"]], true));
      return;
    }
    if (type === "separate") {
      field.phase = "result";
      const parent = this.instrSink();
      if (parent === null) return; // A nested field's cached result inside another field's code.
      field.opened = true;
      this.token(
        items,
        wrappers,
        tag("field", [["code", normaliseInstr(field.instr)], ...field.attrs]),
      );
      return;
    }
    if (type === "end") {
      this.fields.pop();
      const parent = this.instrSink();
      if (parent) {
        parent.instr += `{ ${normaliseInstr(field.instr)} }`;
        return;
      }
      if (parent === null) return;
      if (field.opened) this.token(items, wrappers, "</field>");
      else
        this.token(
          items,
          wrappers,
          tag("field", [["code", normaliseInstr(field.instr)], ...field.attrs], true),
        );
    }
  }

  /** Fields left open at the end of the document. */
  unclosedFields(): number {
    return this.fields.length;
  }

  /* ================= content controls ================= */

  sdtAttrs(sdtPr: XElement | undefined): Attr[] {
    const out: Attr[] = [];
    let type: string | undefined;
    for (const el of elements(sdtPr)) {
      const val = el.attrs["w:val"];
      switch (el.name) {
        case "w:alias":
          out.push(["alias", val ?? ""]);
          break;
        case "w:tag":
          out.push(["tag", val ?? ""]);
          break;
        case "w:id":
          out.push(["id", val ?? ""]);
          break;
        case "w:lock":
          out.push(["lock", val ?? ""]);
          break;
        case "w:showingPlcHdr":
          out.push(["placeholder-showing", true]);
          break;
        case "w:temporary":
          out.push(["temporary", true]);
          break;
        case "w:placeholder":
          out.push(["placeholder", child(el, "w:docPart")?.attrs["w:val"] ?? ""]);
          break;
        case "w:dataBinding":
          out.push(["binding", el.attrs["w:xpath"] ?? ""]);
          break;
        case "w:rPr": {
          const attrs = this.runAttrs(el);
          if (attrs.length) out.push(["run", commentAttrs(attrs)]);
          break;
        }
        case "w:text":
          type = el.attrs["w:multiLine"] === "1" ? "text multi-line" : "text";
          break;
        case "w:richText":
        case "w:picture":
        case "w:equation":
        case "w:citation":
        case "w:bibliography":
        case "w:group":
          type = localName(el.name).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
          break;
        case "w:date": {
          type = "date";
          const fmt = child(el, "w:dateFormat")?.attrs["w:val"];
          if (fmt) out.push(["date-format", fmt]);
          if (el.attrs["w:fullDate"]) out.push(["date", el.attrs["w:fullDate"]]);
          break;
        }
        case "w:dropDownList":
        case "w:comboBox": {
          type = el.name === "w:comboBox" ? "combo-box" : "drop-down";
          const options = elements(el)
            .filter((i) => i.name === "w:listItem")
            .map((i) => i.attrs["w:displayText"] ?? i.attrs["w:value"] ?? "");
          out.push(["options", options.join(" | ")]);
          break;
        }
        case "w:docPartObj":
        case "w:docPartList": {
          type = "building-block";
          const gallery = child(el, "w:docPartGallery")?.attrs["w:val"];
          if (gallery) out.push(["gallery", gallery]);
          break;
        }
        case "w14:checkbox": {
          type = "checkbox";
          const checked = child(el, "w14:checked")?.attrs["w14:val"];
          out.push(["checked", checked === "1" || checked === "true" ? "yes" : "no"]);
          break;
        }
        case "w15:repeatingSection":
          type = "repeating-section";
          break;
        case "w15:repeatingSectionItem":
          type = "repeating-section-item";
          break;
        case "w15:appearance":
          out.push(["appearance", el.attrs["w15:val"] ?? ""]);
          break;
        case "w15:color":
          out.push(["colour", el.attrs["w:val"] ?? ""]);
          break;
        default:
          out.push([el.name, genericValue(el)]);
      }
    }
    if (type) out.unshift(["type", type]);
    return out;
  }

  /* ================= tables ================= */

  table(tbl: XElement, depth: number): string {
    if (depth > MAX_DEPTH)
      return comment(
        `table nested deeper than ${MAX_DEPTH} levels, not shown: ${rawPlaceholder(this.doc, tbl, 200).slice(5, -4)}`,
      );
    const tblPr = child(tbl, "w:tblPr");
    const styleId = child(tblPr, "w:tblStyle")?.attrs["w:val"];
    const attrs: Attr[] = [];
    if (styleId) {
      this.usedStyles.add(styleId);
      attrs.push(["style", this.styles.name(styleId)]);
    }
    attrs.push(...describeProps(tblPr, "tbl", this.props));
    const grid = elements(child(tbl, "w:tblGrid"))
      .filter((g) => g.name === "w:gridCol")
      .map((g) => twips(g.attrs["w:w"]) ?? "?");
    if (grid.length) attrs.push(["grid", grid.join(" ")]);
    const change = child(tblPr, "w:tblPrChange");
    if (change) attrs.push(["changed-by", revisionLabel(change)]);

    interface Cell {
      el: XElement;
      col: number;
      span: number;
      rowspan: number;
      merge?: "restart" | "continue";
      attrs: Attr[];
      blocks: XElement[];
    }
    interface Row {
      attrs: Attr[];
      cells: Cell[];
      notes: string[];
    }
    const rows: Row[] = [];
    const flatten = (container: XElement, kind: "w:tr" | "w:tc", notes: string[]): XElement[] => {
      const out: XElement[] = [];
      for (const el of elements(container)) {
        if (el.name === kind) out.push(el);
        else if (el.name === "w:sdt") {
          notes.push(`sdt ${commentAttrs(this.sdtAttrs(child(el, "w:sdtPr")))}`);
          out.push(...flatten(child(el, "w:sdtContent") ?? el, kind, notes));
        } else if (el.name === "w:customXml") {
          notes.push(`custom-xml ${commentAttrs(customXmlAttrs(el))}`);
          out.push(...flatten(el, kind, notes));
        } else if (
          !["w:tblPr", "w:tblGrid", "w:trPr", "w:tblPrEx", "w:tcPr", "w:proofErr"].includes(el.name)
        ) {
          if (kind === "w:tr" || el.name !== "w:p")
            notes.push(rawPlaceholder(this.doc, el, 200).slice(5, -4));
        }
      }
      return out;
    };
    const tableNotes: string[] = [];
    const openMerges = new Map<number, Cell>();
    for (const tr of flatten(tbl, "w:tr", tableNotes)) {
      const trPr = child(tr, "w:trPr");
      const row: Row = { attrs: describeProps(trPr, "tr", this.props), cells: [], notes: [] };
      for (const rev of ["w:ins", "w:del"]) {
        const r = child(trPr, rev);
        if (r) row.attrs.push([rev === "w:ins" ? "row-inserted" : "row-deleted", revisionLabel(r)]);
      }
      const trChange = child(trPr, "w:trPrChange");
      if (trChange) row.attrs.push(["changed-by", revisionLabel(trChange)]);
      const ex = child(tr, "w:tblPrEx");
      if (ex)
        row.attrs.push(["table-exceptions", commentAttrs(describeProps(ex, "tbl", this.props))]);
      let col = Number(child(trPr, "w:gridBefore")?.attrs["w:val"] ?? 0) || 0;
      for (const tc of flatten(tr, "w:tc", row.notes)) {
        const tcPr = child(tc, "w:tcPr");
        const span = Number(child(tcPr, "w:gridSpan")?.attrs["w:val"] ?? 1) || 1;
        const vMerge = child(tcPr, "w:vMerge");
        const merge = vMerge
          ? vMerge.attrs["w:val"] === "restart"
            ? "restart"
            : "continue"
          : undefined;
        const cell: Cell = {
          el: tc,
          col,
          span,
          rowspan: 1,
          merge,
          attrs: describeProps(tcPr, "tc", this.props),
          blocks: elements(tc).filter((e) => e.name !== "w:tcPr"),
        };
        const tcChange = child(tcPr, "w:tcPrChange");
        if (tcChange) cell.attrs.push(["changed-by", revisionLabel(tcChange)]);
        if (merge === "continue" && openMerges.has(col)) openMerges.get(col)!.rowspan++;
        else if (merge === "restart") openMerges.set(col, cell);
        else openMerges.delete(col);
        row.cells.push(cell);
        col += span;
      }
      rows.push(row);
    }

    // Faithful as a pipe table?
    const firstHeader = rows[0]?.attrs.some(([k]) => k === "header") ?? false;
    const lookFirstRow = attrs.some(
      ([k, v]) => k === "look" && typeof v === "string" && v.includes("first-row"),
    );
    const width = rows[0]?.cells.length ?? 0;
    const simple =
      rows.length > 0 &&
      width > 0 &&
      tableNotes.length === 0 &&
      (firstHeader || lookFirstRow) &&
      rows.every(
        (row, i) =>
          row.notes.length === 0 &&
          row.cells.length === width &&
          row.attrs.every(([k]) => k === "header" && (i === 0 || firstHeader)) &&
          row.cells.every(
            (c) =>
              c.span === 1 &&
              !c.merge &&
              c.attrs.every(([k]) => k === "width") &&
              c.blocks.length === 1 &&
              c.blocks[0]!.name === "w:p",
          ),
      );
    // Render every cell once, in document order (counters, fields and bookmarks advance).
    const rendered = new Map<Cell, string[]>();
    for (const row of rows) {
      for (const cell of row.cells) {
        const blocks: string[] = [];
        for (const b of cell.blocks) {
          try {
            if (b.name === "w:p") blocks.push(this.paragraphLine(b, { inTable: true }));
            else blocks.push(...this.block(b, depth + 1));
          } catch (error) {
            blocks.push(errorPlaceholder(this.doc, b, error));
          }
        }
        rendered.set(cell, blocks);
      }
    }
    if (simple) {
      const lines: string[] = [];
      let ok = true;
      for (const row of rows) {
        const texts = row.cells.map((c) => {
          const text = rendered.get(c)![0]!;
          return text === "<!-- p empty -->" ? "" : text;
        });
        // A paragraph comment (style, direct formatting, list) cannot be said in a pipe table.
        if (texts.some((t) => t.includes("<!-- p "))) {
          ok = false;
          break;
        }
        lines.push(`| ${texts.map((t) => t.replace(/^$/, " ")).join(" | ")} |`);
        if (lines.length === 1) lines.push(`|${" --- |".repeat(width)}`);
      }
      if (ok) {
        const tableAttrs: Attr[] = [...attrs, ["header", firstHeader ? "repeat" : "style"]];
        const cellWidths = rows[0]!.cells.map((c) => c.attrs.find(([k]) => k === "width")?.[1]);
        if (cellWidths.some((w) => w !== undefined))
          tableAttrs.push([
            "cell-widths",
            cellWidths.map((w) => (typeof w === "string" ? w : "-")).join(" "),
          ]);
        return [comment(`table ${commentAttrs(tableAttrs)}`), ...lines].join("\n");
      }
    }

    // HTML table.
    const lines: string[] = [];
    const pad = "  ";
    for (const note of tableNotes) lines.push(comment(note));
    lines.push(`<table${tagAttrs(attrs)}>`);
    for (const row of rows) {
      lines.push(`${pad}<tr${tagAttrs(row.attrs)}>`);
      for (const note of row.notes) lines.push(`${pad}${pad}${comment(note)}`);
      for (const cell of row.cells) {
        if (cell.merge === "continue") {
          const text = cell.blocks
            .map((b) => textOf(b))
            .join("")
            .trim();
          lines.push(
            `${pad}${pad}${comment(`merged into the cell above${text ? `, holds: ${text.slice(0, 80)}` : ""}`)}`,
          );
          continue;
        }
        const tdAttrs: Attr[] = [];
        if (cell.span > 1) tdAttrs.push(["colspan", String(cell.span)]);
        if (cell.rowspan > 1) tdAttrs.push(["rowspan", String(cell.rowspan)]);
        tdAttrs.push(...cell.attrs);
        const blocks = rendered.get(cell)!;
        if (blocks.every((b) => !b.includes("\n"))) {
          lines.push(`${pad}${pad}<td${tagAttrs(tdAttrs)}>${blocks.join(" <p/> ")}</td>`);
        } else {
          lines.push(`${pad}${pad}<td${tagAttrs(tdAttrs)}>`);
          for (const b of blocks)
            for (const line of b.split("\n")) lines.push(`${pad}${pad}${pad}${line}`);
          lines.push(`${pad}${pad}</td>`);
        }
      }
      lines.push(`${pad}</tr>`);
    }
    lines.push("</table>");
    return lines.join("\n");
  }

  /* ================= drawings ================= */

  private relTarget(id: string | undefined): string {
    if (!id) return "";
    const rel = this.pkg.relsOf(this.part).get(id);
    if (!rel) return `${id} (missing relationship)`;
    if (!rel.external) this.usedMedia.add(rel.target);
    return rel.target;
  }

  drawing(el: XElement, depth: number): string {
    const frame = elements(el)[0];
    if (!frame || (frame.name !== "wp:inline" && frame.name !== "wp:anchor"))
      return rawPlaceholder(this.doc, el, 300);
    const attrs: Attr[] = [];
    const docPr = child(frame, "wp:docPr");
    const graphicData = child(child(frame, "a:graphic"), "a:graphicData");
    const content = elements(graphicData)[0];
    const kind =
      content?.name === "pic:pic"
        ? "picture"
        : content?.name === "wps:wsp"
          ? "shape"
          : content?.name === "wpg:wgp"
            ? "group"
            : content?.name === "wpc:wpc"
              ? "canvas"
              : localName(content?.name ?? "") === "chart"
                ? "chart"
                : localName(content?.name ?? "") === "relIds"
                  ? "smartart"
                  : "graphic";
    attrs.push(["kind", kind]);
    if (docPr?.attrs.name) attrs.push(["name", docPr.attrs.name]);
    if (docPr?.attrs.title) attrs.push(["title", docPr.attrs.title]);
    if (docPr?.attrs.hidden === "1" || docPr?.attrs.hidden === "true") attrs.push(["hidden", true]);
    const extent = child(frame, "wp:extent");
    if (extent)
      attrs.push(["width", emu(extent.attrs.cx) ?? "?"], ["height", emu(extent.attrs.cy) ?? "?"]);
    if (frame.name === "wp:inline") attrs.push(["placement", "inline"]);
    else {
      attrs.push(["placement", "anchored"]);
      const pos = (name: string) => {
        const p = child(frame, name);
        if (!p) return undefined;
        const offset = child(p, "wp:posOffset");
        const align = child(p, "wp:align");
        return `${p.attrs.relativeFrom ?? "?"} ${align ? textOf(align) : `+${emu(textOf(offset)) ?? "0pt"}`}`;
      };
      const h = pos("wp:positionH");
      const v = pos("wp:positionV");
      if (h) attrs.push(["horizontal", h]);
      if (v) attrs.push(["vertical", v]);
      const wrap = elements(frame).find((c) => c.name.startsWith("wp:wrap"));
      if (wrap) {
        const name = localName(wrap.name)
          .slice(4)
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .toLowerCase();
        attrs.push(["wrap", wrap.attrs.wrapText ? `${name} ${wrap.attrs.wrapText}` : name]);
      }
      if (frame.attrs.behindDoc === "1") attrs.push(["behind-text", true]);
      if (frame.attrs.allowOverlap === "0") attrs.push(["no-overlap", true]);
      if (frame.attrs.locked === "1") attrs.push(["locked", true]);
      if (frame.attrs.layoutInCell === "0") attrs.push(["outside-cell", true]);
    }
    const alt = docPr?.attrs.descr ?? "";
    let inner = "";
    let raw = false;
    if (kind === "picture") {
      const blip = child(child(content, "pic:blipFill"), "a:blip");
      const target = this.relTarget(blip?.attrs["r:embed"] ?? blip?.attrs["r:link"]);
      inner = `![${escapeText(alt)}](${linkTarget(target)})`;
    } else {
      if (alt) attrs.push(["alt", alt]);
      if (kind === "chart") attrs.push(["target", this.relTarget(content?.attrs["r:id"])]);
      else if (kind === "smartart") attrs.push(["target", this.relTarget(content?.attrs["r:dm"])]);
      else if (kind === "shape") {
        const geom = child(child(content, "wps:spPr"), "a:prstGeom")?.attrs.prst;
        if (geom) attrs.push(["geometry", geom]);
        const txbx = child(child(content, "wps:txbx"), "w:txbxContent");
        if (txbx) {
          attrs[0] = ["kind", "text box"];
          inner = this.textBox(txbx, depth);
        } else raw = true;
      } else raw = true;
    }
    return `${tag("drawing", attrs)}${inner}</drawing>${raw && content ? " " + rawPlaceholder(this.doc, content, 300) : ""}`;
  }

  private textBox(txbx: XElement, depth: number): string {
    if (depth > MAX_DEPTH) return rawPlaceholder(this.doc, txbx, 200);
    const saved = this.listWidths;
    const parts = this.blocks(txbx, depth + 1).map((b) => b.replace(/\n/g, " "));
    this.listWidths = saved;
    return parts.join(" <p/> ");
  }

  vml(el: XElement, depth: number): string {
    const attrs: Attr[] = [];
    let inner = "";
    const shapes = elements(el).filter((c) => c.name.startsWith("v:") || c.name === "o:OLEObject");
    if (el.name === "w:object") {
      const ole = child(el, "o:OLEObject");
      attrs.push(["kind", "embedded object"]);
      if (ole?.attrs.ProgID) attrs.push(["program", ole.attrs.ProgID]);
      if (ole?.attrs["r:id"]) attrs.push(["target", this.relTarget(ole.attrs["r:id"])]);
    } else attrs.push(["kind", "vml"]);
    const shape = shapes.find((s) => s.name !== "v:shapetype" && s.name !== "o:OLEObject");
    if (shape) {
      attrs.push(["shape", localName(shape.name)]);
      if (shape.attrs.id) attrs.push(["id", shape.attrs.id]);
      if (shape.attrs.alt) attrs.push(["alt", shape.attrs.alt]);
      if (shape.attrs.style) attrs.push(["style", shape.attrs.style]);
      const imagedata = child(shape, "v:imagedata");
      if (imagedata)
        inner += `![${escapeText(imagedata.attrs["o:title"] ?? "")}](${linkTarget(this.relTarget(imagedata.attrs["r:id"]))})`;
      const txbx = child(child(shape, "v:textbox"), "w:txbxContent");
      if (txbx) inner += this.textBox(txbx, depth);
    }
    return `${tag("vml", attrs)}${inner}</vml> ${rawPlaceholder(this.doc, el, 300)}`;
  }

  math(el: XElement): string {
    const block = el.name === "m:oMathPara";
    let linear: string;
    try {
      linear = linearMath(el);
    } catch {
      linear = "?";
    }
    return `${tag("math", block ? [["display", "block"]] : [])}${escapeText(linear)}</math> ${rawPlaceholder(this.doc, el, 300)}`;
  }
}

/* ================= helpers ================= */

const skipped = new WeakSet<XElement>();

function nextElement(el: XElement): XElement | undefined {
  const siblings = el.parent?.children ?? [];
  const i = siblings.indexOf(el);
  for (let j = i + 1; j < siblings.length; j++) {
    const s = siblings[j]!;
    if (typeof s !== "string") return s;
  }
  return undefined;
}

function revisionTag(name: string): string {
  return name === "w:ins"
    ? "ins"
    : name === "w:del"
      ? "del"
      : name === "w:moveFrom"
        ? "move-from"
        : "move-to";
}

function revisionAttrs(el: XElement): Attr[] {
  const out: Attr[] = [];
  if (el.attrs["w:id"] !== undefined) out.push(["id", el.attrs["w:id"]]);
  if (el.attrs["w:author"] !== undefined) out.push(["author", el.attrs["w:author"]]);
  if (el.attrs["w:date"] !== undefined) out.push(["date", el.attrs["w:date"]]);
  return out;
}

function customXmlAttrs(el: XElement): Attr[] {
  const out: Attr[] = [["element", el.attrs["w:element"] ?? "?"]];
  if (el.attrs["w:uri"]) out.push(["uri", el.attrs["w:uri"]]);
  for (const attr of elements(child(el, "w:customXmlPr"))) {
    if (attr.name === "w:attr")
      out.push([`attr-${attr.attrs["w:name"] ?? "?"}`, attr.attrs["w:val"] ?? ""]);
  }
  return out;
}

/** Markdown link destination: `<…>` when it holds spaces or brackets. */
function linkTarget(url: string): string {
  if (url === "") return "<>";
  if (/[\s()<>]/.test(url)) return `<${url.replace(/[<>]/g, (c) => encodeURIComponent(c))}>`;
  return url;
}

function normaliseInstr(instr: string): string {
  return instr.replace(/\s+/g, " ").trim();
}

/**
 * Which branch of `mc:AlternateContent` to show. Word picks the first `mc:Choice` whose required
 * namespaces it understands; every current Word understands the ones in practice (wps, wpg, w14,
 * w15...), so the view shows the first Choice and says what else is there.
 */
function chooseBranch(el: XElement): { chosen: XElement | undefined; note: string } {
  const choices = elements(el).filter((c) => c.name === "mc:Choice");
  const fallback = elements(el).find((c) => c.name === "mc:Fallback");
  const chosen = choices[0] ?? fallback;
  const describe = (b: XElement) =>
    b.name === "mc:Choice" ? `Choice Requires=${b.attrs.Requires ?? "?"}` : "Fallback";
  const others = [...choices.slice(1), ...(chosen === fallback ? [] : fallback ? [fallback] : [])];
  const contents = (b: XElement) =>
    elements(b)
      .map((c) => c.name)
      .join(", ") || "nothing";
  const note = `alternate-content showing ${chosen ? `${describe(chosen)} (${contents(chosen)})` : "nothing"}${others.length ? `; also ${others.map((o) => `${describe(o)} (${contents(o)})`).join("; ")}` : ""}`;
  return { chosen, note };
}
