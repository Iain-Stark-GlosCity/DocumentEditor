/**
 * The small vocabulary the Formatting view is written in: escaping of the document's own text,
 * attribute lists for tags and comments, units and visible placeholders. See docs/docx-view.md.
 */
import { pathOf, sourceOf, type XDocument, type XElement } from "./xml";

/** A property: `[key, value]`, where `true` means a flag with no value (`keep-next`). */
export type Attr = readonly [string, string | true];

/** Characters that would read as Markdown or HTML if left alone. */
const ALWAYS = /[\\`*[\]<~]/g;

/**
 * Escapes the document's own text so that it reads literally. Invisible characters become named
 * tokens. `inTable` also escapes `|`.
 */
export function escapeText(text: string, inTable = false): string {
  let out = text.replace(ALWAYS, (c) => "\\" + c);
  // `_` only where it could start or end emphasis (snake_case stays readable).
  out = out.replace(/(^|[^\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, (m) => m.replace("_", "\\_"));
  // `&` only where it would read as an entity.
  out = out.replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;");
  // `#` where it could start a heading or close one.
  out = out.replace(/(^|\s)#/g, "$1\\#");
  if (inTable) out = out.replace(/\|/g, "\\|");
  out = out.replace(INVISIBLE, (c) => {
    if (c === "\u00a0") return "<nbsp/>";
    if (c === "\u00ad") return "<shy/>";
    return `<char code="${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}"/>`;
  });
  return out;
}

/** Characters that would be invisible or ambiguous: control characters, NBSP, zero widths. */
// Control characters are exactly what must be found here.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u00a0\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff\u0000-\u0008\u000b-\u001f]/g;

/** Escapes what only matters at the start of a line: `>`, `-`, `+`, `=`, `1.`, `1)`. */
export function escapeLineStart(text: string): string {
  if (/^[>+=-]/.test(text)) return "\\" + text;
  const m = /^(\d{1,9})([.)])/.exec(text);
  if (m) return `${m[1]}\\${m[2]}${text.slice(m[0].length)}`;
  return text;
}

/** Quotes a value for a tag attribute: double quotes, or single if the value holds `"`. */
function quoteAlways(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/"/g, "&quot;")}"`;
}

function quoteIfNeeded(value: string): string {
  if (value !== "" && /^[^\s"'=<>`]+$/.test(value)) return value;
  return quoteAlways(value);
}

/** Attributes for an HTML-like tag: ` key="value" flag`. */
export function tagAttrs(attrs: readonly Attr[]): string {
  let out = "";
  for (const [k, v] of attrs) out += v === true ? ` ${k}` : ` ${k}=${quoteAlways(cleanValue(v))}`;
  return out;
}

/** Attributes for a comment: `key=value key="two words" flag`. */
export function commentAttrs(attrs: readonly Attr[]): string {
  const out: string[] = [];
  for (const [k, v] of attrs) out.push(v === true ? k : `${k}=${quoteIfNeeded(cleanValue(v))}`);
  return out.join(" ");
}

/** Keeps a value on one line and from ending an HTML comment or a tag. */
function cleanValue(value: string): string {
  return value
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/--/g, "-\u2010")
    .replace(/>/g, "&gt;");
}

/** An HTML comment that is safe to emit: one line, and `--` never closes it early. */
export function comment(body: string): string {
  return `<!-- ${body.replace(/\s*[\r\n]+\s*/g, " ").replace(/--/g, "-\u2010")} -->`;
}

export function tag(name: string, attrs: readonly Attr[] = [], selfClosing = false): string {
  return `<${name}${tagAttrs(attrs)}${selfClosing ? "/" : ""}>`;
}

/* ---------- units ---------- */

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Twentieths of a point (twips), as written in most WordprocessingML lengths. */
export function twips(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const universal = universalMeasure(value);
  if (universal) return universal;
  const n = Number(value);
  return Number.isFinite(n) ? `${round(n / 20)}pt` : value;
}

/** Half-points, as in font sizes. */
export function halfPoints(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const universal = universalMeasure(value);
  if (universal) return universal;
  const n = Number(value);
  return Number.isFinite(n) ? `${round(n / 2)}pt` : value;
}

/** Eighths of a point, as in border widths. */
export function eighthPoints(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? `${round(n / 8)}pt` : value;
}

/** English Metric Units, as in DrawingML sizes (12700 per point). */
export function emu(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? `${round(n / 12700)}pt` : value;
}

/** Strict OOXML and newer files may write `12pt`, `1.5in`, `2cm` directly. */
function universalMeasure(value: string): string | undefined {
  const m = /^(-?[\d.]+)(mm|cm|in|pt|pc|pi)$/.exec(value);
  if (!m) return undefined;
  if (m[2] === "pt") return value;
  const n = Number(m[1]);
  const factor = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pc: 12, pi: 12 }[m[2] as "mm"];
  return `${round(n * factor)}pt`;
}

/** A table width: `dxa` twips, `pct` fiftieths of a percent (or `50%`), `auto`, `nil`. */
export function tableWidth(el: XElement | undefined): string | undefined {
  if (!el) return undefined;
  const w = el.attrs["w:w"];
  const type = el.attrs["w:type"] ?? "dxa";
  if (type === "auto") return "auto";
  if (type === "nil") return "0";
  if (type === "pct") {
    if (w?.endsWith("%")) return w;
    const n = Number(w);
    return Number.isFinite(n) ? `${round(n / 50)}%` : w;
  }
  return twips(w);
}

/* ---------- placeholders ---------- */

export const RAW_LIMIT = 600;

/** The element's XML, on one line, truncated with a note when long. */
export function rawXml(doc: XDocument, el: XElement, limit = RAW_LIMIT): string {
  const text = sourceOf(doc, el).replace(/\s*[\r\n]+\s*/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… (truncated: ${text.length.toLocaleString("en-GB")} characters in all)`;
}

/** A visible placeholder for markup the view does not interpret. */
export function rawPlaceholder(doc: XDocument, el: XElement, limit = RAW_LIMIT): string {
  return comment(`raw path="${pathOf(el)}" ${rawXml(doc, el, limit)}`);
}

export function errorPlaceholder(doc: XDocument, el: XElement, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${comment(`error path="${pathOf(el)}" ${message}`)} ${rawPlaceholder(doc, el)}`;
}

/** Title-cases a style name written all in lower case, as Word's UI shows built-in names. */
export function displayStyleName(name: string): string {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|\s)(\p{L})/gu, (_m, space: string, c: string) => space + c.toUpperCase());
}

/** Whether an on/off property is on. `<w:b/>` is on; `w:val="0"`, `false`, `off` are off. */
export function isOn(el: XElement | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = el.attrs["w:val"];
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}
