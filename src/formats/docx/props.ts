/**
 * Turns property elements (`w:rPr`, `w:pPr`, `w:tblPr`, `w:trPr`, `w:tcPr`, `w:sectPr`) into the
 * view's attribute lists. Every child element becomes at least one attribute: known ones get a
 * readable name and units, unknown ones are listed under their XML name with their values, so
 * nothing is dropped.
 */
import {
  commentAttrs,
  eighthPoints,
  halfPoints,
  isOn,
  tableWidth,
  twips,
  type Attr,
} from "./notation";
import { tintShade, type Theme } from "./package";
import { elements, localName, type XElement } from "./xml";

export type PropKind = "r" | "p" | "tbl" | "tr" | "tc";

export interface PropContext {
  theme: Theme;
  /** Display name of a style by id. */
  styleName(id: string): string;
}

/** Elements described elsewhere (revisions, section properties, styles). */
const SKIP: Record<PropKind, Set<string>> = {
  r: new Set(["w:rStyle", "w:rPrChange", "w:ins", "w:del", "w:moveFrom", "w:moveTo"]),
  p: new Set(["w:pStyle", "w:pPrChange", "w:sectPr", "w:rPr", "w:numPr"]),
  tbl: new Set(["w:tblStyle", "w:tblPrChange"]),
  tr: new Set(["w:trPrChange", "w:ins", "w:del"]),
  tc: new Set(["w:tcPrChange", "w:gridSpan", "w:vMerge"]),
};

const FLAGS: Record<string, string> = {
  "w:b": "bold",
  "w:bCs": "bold-cs",
  "w:i": "italic",
  "w:iCs": "italic-cs",
  "w:strike": "strike",
  "w:dstrike": "double-strike",
  "w:caps": "caps",
  "w:smallCaps": "small-caps",
  "w:vanish": "hidden",
  "w:webHidden": "web-hidden",
  "w:specVanish": "spec-hidden",
  "w:emboss": "emboss",
  "w:imprint": "engrave",
  "w:outline": "outline",
  "w:shadow": "shadow",
  "w:noProof": "no-proof",
  "w:snapToGrid": "snap-to-grid",
  "w:rtl": "rtl",
  "w:cs": "complex-script",
  "w:oMath": "math",
  "w:keepNext": "keep-next",
  "w:keepLines": "keep-lines",
  "w:pageBreakBefore": "page-break-before",
  "w:widowControl": "widow-control",
  "w:suppressLineNumbers": "no-line-numbers",
  "w:suppressAutoHyphens": "no-hyphenation",
  "w:contextualSpacing": "contextual-spacing",
  "w:mirrorIndents": "mirror-indents",
  "w:bidi": "rtl",
  "w:adjustRightInd": "adjust-right-indent",
  "w:kinsoku": "kinsoku",
  "w:wordWrap": "word-wrap",
  "w:overflowPunct": "overflow-punctuation",
  "w:topLinePunct": "top-line-punctuation",
  "w:autoSpaceDE": "auto-space-de",
  "w:autoSpaceDN": "auto-space-dn",
  "w:suppressOverlap": "no-overlap",
  "w:tblHeader": "header",
  "w:cantSplit": "cant-split",
  "w:hidden": "hidden",
  "w:noWrap": "no-wrap",
  "w:tcFitText": "fit-text",
  "w:hideMark": "hide-mark",
  "w:bidiVisual": "rtl",
  "w:titlePg": "title-page",
  "w:formProt": "form-protection",
  "w:noEndnote": "no-endnote",
  "w:rtlGutter": "rtl-gutter",
};

const ALIGN: Record<string, string> = {
  both: "justify",
  center: "centre",
  start: "start",
  end: "end",
  left: "left",
  right: "right",
  distribute: "distribute",
  thaiDistribute: "thai-distribute",
  mediumKashida: "kashida-medium",
  highKashida: "kashida-high",
  lowKashida: "kashida-low",
  numTab: "num-tab",
};

/** A colour with its theme reference: `2F5496 (accent1, shade BF)`. */
export function describeColour(
  theme: Theme,
  val: string | undefined,
  themeColor: string | undefined,
  tint?: string,
  shade?: string,
): string | undefined {
  if (!themeColor)
    return val === undefined ? undefined : val === "auto" ? "auto" : val.toUpperCase();
  const key = THEME_ALIASES[themeColor] ?? themeColor;
  const base = theme.colours.get(key);
  const resolved =
    val && val !== "auto" ? val.toUpperCase() : base ? tintShade(base, tint, shade) : undefined;
  const mods = [themeColor, tint ? `tint ${tint}` : "", shade ? `shade ${shade}` : ""]
    .filter(Boolean)
    .join(", ");
  return resolved ? `${resolved} (${mods})` : `theme ${mods}`;
}

const THEME_ALIASES: Record<string, string> = {
  text1: "dk1",
  text2: "dk2",
  background1: "lt1",
  background2: "lt2",
  dark1: "dk1",
  dark2: "dk2",
  light1: "lt1",
  light2: "lt2",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};

function colourOf(el: XElement, theme: Theme): string | undefined {
  return describeColour(
    theme,
    el.attrs["w:val"],
    el.attrs["w:themeColor"],
    el.attrs["w:themeTint"],
    el.attrs["w:themeShade"],
  );
}

export function describeBorder(el: XElement, theme: Theme): string {
  const val = el.attrs["w:val"] ?? "single";
  if (val === "nil" || val === "none") return "none";
  const parts = [val];
  const sz = eighthPoints(el.attrs["w:sz"]);
  if (sz) parts.push(sz);
  const colour = describeColour(
    theme,
    el.attrs["w:color"],
    el.attrs["w:themeColor"],
    el.attrs["w:themeTint"],
    el.attrs["w:themeShade"],
  );
  if (colour) parts.push(colour);
  const space = el.attrs["w:space"];
  if (space && space !== "0") parts.push(`space ${space}pt`);
  if (isOn2(el.attrs["w:shadow"])) parts.push("shadow");
  if (isOn2(el.attrs["w:frame"])) parts.push("frame");
  return parts.join(" ");
}

function isOn2(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "on";
}

export function describeShading(el: XElement, theme: Theme): string {
  const val = el.attrs["w:val"] ?? "clear";
  const fill = describeColour(
    theme,
    el.attrs["w:fill"],
    el.attrs["w:themeFill"],
    el.attrs["w:themeFillTint"],
    el.attrs["w:themeFillShade"],
  );
  const colour = describeColour(
    theme,
    el.attrs["w:color"],
    el.attrs["w:themeColor"],
    el.attrs["w:themeTint"],
    el.attrs["w:themeShade"],
  );
  if (val === "clear") return fill ?? "clear";
  if (val === "nil") return "none";
  return [val, colour ? `colour ${colour}` : "", fill ? `fill ${fill}` : ""]
    .filter(Boolean)
    .join(" ");
}

/** `rFonts` as `font`, `font-east-asia`, `font-cs` and so on, with theme fonts resolved. */
function fonts(el: XElement, theme: Theme): Attr[] {
  const a = el.attrs;
  const themeFont = (ref: string | undefined): string | undefined => {
    if (!ref) return undefined;
    const major = ref.startsWith("major");
    const kind = ref.endsWith("EastAsia") ? "EastAsia" : ref.endsWith("Bidi") ? "Cs" : "";
    const face =
      kind === "EastAsia"
        ? major
          ? theme.majorEastAsia
          : theme.minorEastAsia
        : kind === "Cs"
          ? major
            ? theme.majorCs
            : theme.minorCs
          : major
            ? theme.majorFont
            : theme.minorFont;
    return `+${major ? "headings" : "body"}${face ? ` (${face})` : ""}`;
  };
  const ascii = themeFont(a["w:asciiTheme"]) ?? a["w:ascii"];
  const hAnsi = themeFont(a["w:hAnsiTheme"]) ?? a["w:hAnsi"];
  const eastAsia = themeFont(a["w:eastAsiaTheme"]) ?? a["w:eastAsia"];
  const cs = themeFont(a["w:cstheme"]) ?? a["w:cs"];
  const out: Attr[] = [];
  if (ascii !== undefined) out.push(["font", ascii]);
  if (hAnsi !== undefined && hAnsi !== ascii) out.push(["font-hansi", hAnsi]);
  // The east Asian and complex-script fonts are shown only where they differ from `font`.
  if (eastAsia !== undefined && eastAsia !== ascii) out.push(["font-east-asia", eastAsia]);
  if (cs !== undefined && cs !== ascii) out.push(["font-cs", cs]);
  if (a["w:hint"]) out.push(["font-hint", a["w:hint"]]);
  return out;
}

/** Any element, compactly: `val=x other=y [child …]`. Used for what has no dedicated reading. */
export function genericValue(el: XElement): string | true {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(el.attrs)) parts.push(`${localName(k)}=${v}`);
  for (const c of elements(el)) {
    const inner = genericValue(c);
    parts.push(inner === true ? `[${c.name}]` : `[${c.name} ${inner}]`);
  }
  const text = el.children
    .filter((c) => typeof c === "string")
    .join("")
    .trim();
  if (text) parts.push(JSON.stringify(text));
  if (parts.length === 0) return true;
  if (parts.length === 1 && el.attrs["w:val"] !== undefined) return el.attrs["w:val"]!;
  return parts.join(" ");
}

function sideBorders(el: XElement, prefix: string, theme: Theme): Attr[] {
  const described = elements(el).map((s) => [localName(s.name), describeBorder(s, theme)] as const);
  const sides = described.filter(([n]) => !n.startsWith("inside"));
  const inside = described.filter(([n]) => n.startsWith("inside"));
  const out: Attr[] = [];
  // The same border on all four sides is one attribute; so are the inside borders.
  const names = sides
    .map((d) => d[0])
    .sort()
    .join(",");
  if (
    new Set(sides.map((d) => d[1])).size === 1 &&
    (names === "bottom,left,right,top" || names === "bottom,end,start,top")
  ) {
    out.push([`${prefix}s`, sides[0]![1]]);
  } else for (const [side, value] of sides) out.push([`${prefix}-${side}`, value]);
  if (inside.length === 2 && inside[0]![1] === inside[1]![1])
    out.push([`${prefix}s-inside`, inside[0]![1]]);
  else
    for (const [side, value] of inside)
      out.push([
        `${prefix}-${side === "insideH" ? "inside-h" : side === "insideV" ? "inside-v" : side}`,
        value,
      ]);
  return out;
}

function margins(el: XElement, prefix: string): Attr[] {
  return elements(el).map((m) => [`${prefix}-${localName(m.name)}`, tableWidth(m) ?? "?"]);
}

/** Describes one property element. */
function describeOne(el: XElement, kind: PropKind, ctx: PropContext): Attr[] {
  const a = el.attrs;
  const flag = FLAGS[el.name];
  if (flag) return [isOn(el) ? [flag, true] : [flag, "off"]];
  switch (el.name) {
    case "w:jc":
      return [["align", ALIGN[a["w:val"] ?? ""] ?? a["w:val"] ?? "?"]];
    case "w:u": {
      const out: Attr[] = [["underline", a["w:val"] ?? "single"]];
      const colour = describeColour(
        ctx.theme,
        a["w:color"],
        a["w:themeColor"],
        a["w:themeTint"],
        a["w:themeShade"],
      );
      if (colour) out.push(["underline-colour", colour]);
      return out;
    }
    case "w:vertAlign":
      return [["vertical", a["w:val"] ?? "baseline"]];
    case "w:rFonts":
      return fonts(el, ctx.theme);
    case "w:sz":
      return [["size", halfPoints(a["w:val"]) ?? "?"]];
    case "w:szCs":
      return [["size-cs", halfPoints(a["w:val"]) ?? "?"]];
    case "w:color":
      return [["colour", colourOf(el, ctx.theme) ?? "?"]];
    case "w:highlight":
      return [["highlight", a["w:val"] ?? "?"]];
    case "w:shd":
      return [["shading", describeShading(el, ctx.theme)]];
    case "w:lang": {
      const out: Attr[] = [];
      if (a["w:val"]) out.push(["lang", a["w:val"]]);
      if (a["w:eastAsia"]) out.push(["lang-east-asia", a["w:eastAsia"]]);
      if (a["w:bidi"]) out.push(["lang-cs", a["w:bidi"]]);
      return out;
    }
    case "w:w":
      return [["scale", `${a["w:val"] ?? "100"}%`]];
    case "w:kern":
      return [["kern", `from ${halfPoints(a["w:val"]) ?? "?"}`]];
    case "w:position":
      return [["raise", halfPoints(a["w:val"]) ?? "?"]];
    case "w:effect":
      return [["animation", a["w:val"] ?? "?"]];
    case "w:em":
      return [["emphasis-mark", a["w:val"] ?? "?"]];
    case "w:bdr":
      return [["border", describeBorder(el, ctx.theme)]];
    case "w:fitText":
      return [["fit-text", twips(a["w:val"]) ?? "?"]];
    case "w:spacing":
      if (kind === "r") return [["letter-spacing", twips(a["w:val"]) ?? "?"]];
      return paragraphSpacing(el);
    case "w:ind":
      return indents(el);
    case "w:outlineLvl": {
      const n = Number(a["w:val"]);
      return [["outline-level", Number.isFinite(n) ? (n >= 9 ? "body" : String(n + 1)) : "?"]];
    }
    case "w:pBdr":
      return sideBorders(el, "border", ctx.theme);
    case "w:tabs":
      return [["tabs", tabs(el)]];
    case "w:textDirection":
      return [["text-direction", a["w:val"] ?? "?"]];
    case "w:textAlignment":
      return [["vertical-text-align", a["w:val"] ?? "?"]];
    case "w:framePr":
      return [["frame", genericValue(el)]];
    case "w:cnfStyle":
      return [["conditional", conditional(a)]];
    case "w:tblW":
    case "w:tcW":
      return [["width", tableWidth(el) ?? "?"]];
    case "w:tblInd":
      return [["indent", tableWidth(el) ?? "?"]];
    case "w:tblBorders":
    case "w:tcBorders":
      return sideBorders(el, "border", ctx.theme);
    case "w:tblLayout":
      return [["layout", a["w:type"] ?? "autofit"]];
    case "w:tblCellMar":
    case "w:tcMar":
      return margins(el, "cell-margin");
    case "w:tblCellSpacing":
      return [["cell-spacing", tableWidth(el) ?? "?"]];
    case "w:tblLook":
      return [["look", look(a)]];
    case "w:tblCaption":
      return [["caption", a["w:val"] ?? ""]];
    case "w:tblDescription":
      return [["description", a["w:val"] ?? ""]];
    case "w:tblpPr":
      return [["float", genericValue(el)]];
    case "w:tblOverlap":
      return [["overlap", a["w:val"] ?? "?"]];
    case "w:tblStyleRowBandSize":
      return [["row-band", a["w:val"] ?? "?"]];
    case "w:tblStyleColBandSize":
      return [["column-band", a["w:val"] ?? "?"]];
    case "w:trHeight": {
      const rule = a["w:hRule"] ?? "atLeast";
      return [
        [
          "height",
          `${rule === "exact" ? "exactly" : rule === "auto" ? "auto" : "at-least"} ${twips(a["w:val"]) ?? "0pt"}`,
        ],
      ];
    }
    case "w:gridBefore":
      return [["grid-before", a["w:val"] ?? "?"]];
    case "w:gridAfter":
      return [["grid-after", a["w:val"] ?? "?"]];
    case "w:wBefore":
      return [["width-before", tableWidth(el) ?? "?"]];
    case "w:wAfter":
      return [["width-after", tableWidth(el) ?? "?"]];
    case "w:vAlign":
      return [["valign", a["w:val"] === "center" ? "centre" : (a["w:val"] ?? "?")]];
    case "w:hMerge":
      return [["hmerge", a["w:val"] ?? "continue"]];
    case "w:cellIns":
      return [["cell-inserted", revisionLabel(el)]];
    case "w:cellDel":
      return [["cell-deleted", revisionLabel(el)]];
    case "w:divId":
      return [["div", a["w:val"] ?? "?"]];
  }
  return [[el.name, genericValue(el)]];
}

export function revisionLabel(el: XElement): string {
  return [el.attrs["w:author"] ?? "unknown author", el.attrs["w:date"]].filter(Boolean).join(", ");
}

function paragraphSpacing(el: XElement): Attr[] {
  const a = el.attrs;
  const out: Attr[] = [];
  if (a["w:before"] !== undefined) out.push(["spacing-before", twips(a["w:before"])!]);
  if (a["w:beforeLines"] !== undefined)
    out.push(["spacing-before-lines", String(Number(a["w:beforeLines"]) / 100)]);
  if (isOn2(a["w:beforeAutospacing"])) out.push(["spacing-before", "auto"]);
  if (a["w:after"] !== undefined) out.push(["spacing-after", twips(a["w:after"])!]);
  if (a["w:afterLines"] !== undefined)
    out.push(["spacing-after-lines", String(Number(a["w:afterLines"]) / 100)]);
  if (isOn2(a["w:afterAutospacing"])) out.push(["spacing-after", "auto"]);
  if (a["w:line"] !== undefined) {
    const rule = a["w:lineRule"] ?? "auto";
    if (rule === "auto") {
      const n = Number(a["w:line"]) / 240;
      out.push(["line-spacing", Number.isFinite(n) ? `${Math.round(n * 100) / 100}` : a["w:line"]]);
    } else
      out.push([
        "line-spacing",
        `${rule === "exact" ? "exactly" : "at-least"} ${twips(a["w:line"])}`,
      ]);
  }
  return out;
}

function indents(el: XElement): Attr[] {
  const a = el.attrs;
  const out: Attr[] = [];
  const pairs: [string, string][] = [
    ["w:left", "indent-left"],
    ["w:start", "indent-start"],
    ["w:right", "indent-right"],
    ["w:end", "indent-end"],
    ["w:firstLine", "first-line"],
    ["w:hanging", "hanging"],
  ];
  for (const [key, name] of pairs) if (a[key] !== undefined) out.push([name, twips(a[key])!]);
  for (const [key, name] of [
    ["w:leftChars", "indent-left-chars"],
    ["w:startChars", "indent-start-chars"],
    ["w:rightChars", "indent-right-chars"],
    ["w:endChars", "indent-end-chars"],
    ["w:firstLineChars", "first-line-chars"],
    ["w:hangingChars", "hanging-chars"],
  ] as const) {
    if (a[key] !== undefined) out.push([name, String(Number(a[key]) / 100)]);
  }
  return out;
}

function tabs(el: XElement): string {
  return elements(el)
    .map((t) => {
      const parts = [t.attrs["w:val"] ?? "left"];
      const leader = t.attrs["w:leader"];
      if (leader && leader !== "none") parts.push(leader);
      parts.push(twips(t.attrs["w:pos"]) ?? "?");
      return parts.join(" ");
    })
    .join(", ");
}

function look(a: Record<string, string>): string {
  const out: string[] = [];
  const val = a["w:val"] ? parseInt(a["w:val"], 16) : NaN;
  const on = (attr: string, bit: number) => {
    const v = a[attr];
    if (v !== undefined) return isOn2(v);
    return Number.isFinite(val) ? (val & bit) !== 0 : false;
  };
  if (on("w:firstRow", 0x20)) out.push("first-row");
  if (on("w:lastRow", 0x40)) out.push("last-row");
  if (on("w:firstColumn", 0x80)) out.push("first-column");
  if (on("w:lastColumn", 0x100)) out.push("last-column");
  if (!on("w:noHBand", 0x200)) out.push("banded-rows");
  if (!on("w:noVBand", 0x400)) out.push("banded-columns");
  return out.join(" ") || "none";
}

function conditional(a: Record<string, string>): string {
  const on = Object.entries(a)
    .filter(([k, v]) => k !== "w:val" && isOn2(v))
    .map(([k]) => localName(k));
  return on.length ? on.join(" ") : (a["w:val"] ?? "");
}

/** All properties of a property container, in file order. */
export function describeProps(
  container: XElement | undefined,
  kind: PropKind,
  ctx: PropContext,
): Attr[] {
  if (!container) return [];
  const out: Attr[] = [];
  const skip = SKIP[kind];
  for (const el of elements(container)) {
    if (skip.has(el.name)) continue;
    out.push(...describeOne(el, kind, ctx));
  }
  return kind === "r" ? foldTwins(out) : out;
}

/** A property list as text for a comment value: `bold size=12pt font="Arial"`. */
export function attrsText(attrs: readonly Attr[]): string {
  return commentAttrs(attrs);
}

/**
 * Word sets complex-script twins (`w:bCs`, `w:iCs`, `w:szCs`) together with the main property.
 * Where a twin says the same as its main property it adds nothing to read, so it is folded in.
 */
function foldTwins(attrs: Attr[]): Attr[] {
  const value = (key: string) => attrs.find(([k]) => k === key)?.[1];
  return attrs.filter(([k, v]) => {
    if (k === "bold-cs") return value("bold") !== v;
    if (k === "italic-cs") return value("italic") !== v;
    if (k === "size-cs") return value("size") !== v;
    return true;
  });
}
