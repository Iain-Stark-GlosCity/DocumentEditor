/**
 * Inline output: a paragraph's content is collected as items (text or tokens, each with the
 * stack of wrappers it sits in), then written out with the fewest open and close tags, choosing
 * Markdown emphasis where it parses and `<b>`, `<i>`, `<s>` where it would not.
 */
import { escapeLineStart, escapeText } from "./notation";

export interface Wrapper {
  /** Identity: two runs with the same key share one open tag. */
  readonly key: string;
  readonly open: string;
  readonly close: string;
  /** For Markdown emphasis: the HTML tags to use where the Markdown would not parse. */
  readonly html?: readonly [string, string];
}

export interface Item {
  wrappers: readonly Wrapper[];
  /** Document text (escaped on output) or a token (written as is). */
  text: string;
  token: boolean;
}

export const BOLD: Wrapper = { key: "**", open: "**", close: "**", html: ["<b>", "</b>"] };
export const ITALIC: Wrapper = { key: "*", open: "*", close: "*", html: ["<i>", "</i>"] };
export const STRIKE: Wrapper = { key: "~~", open: "~~", close: "~~", html: ["<s>", "</s>"] };

function isEmphasis(w: Wrapper): boolean {
  return w.html !== undefined;
}

/** Splits leading and trailing white space of emphasised text out of the emphasis. */
function prepare(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    if (item.token || !item.wrappers.some(isEmphasis)) {
      out.push(item);
      continue;
    }
    const plain = item.wrappers.filter((w) => !isEmphasis(w));
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(item.text)!;
    if (m[1]) out.push({ wrappers: plain, text: m[1], token: false });
    if (m[2]) out.push({ wrappers: item.wrappers, text: m[2], token: false });
    if (m[3]) out.push({ wrappers: plain, text: m[3], token: false });
  }
  return out;
}

function spaces(n: number): string {
  return n === 1 ? "<sp/>" : `<sp n="${n}"/>`;
}

/** Makes leading and trailing spaces of the paragraph visible. */
function visibleEdges(items: Item[]): Item[] {
  const out = items.slice();
  for (let i = 0; i < out.length; i++) {
    const item = out[i]!;
    if (item.token) break;
    const m = /^ +/.exec(item.text);
    if (!m) break;
    const rest = item.text.slice(m[0].length);
    out.splice(i, 1, { ...item, text: spaces(m[0].length), token: true });
    if (rest) {
      out.splice(i + 1, 0, { ...item, text: rest });
      break;
    }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const item = out[i]!;
    if (item.token) break;
    const m = / +$/.exec(item.text);
    if (!m) break;
    const rest = item.text.slice(0, -m[0].length);
    out.splice(i, 1, { ...item, text: spaces(m[0].length), token: true });
    if (rest) {
      out.splice(i, 0, { ...item, text: rest });
      break;
    }
  }
  return out;
}

interface Marker {
  w: Wrapper;
  opening: boolean;
  partner?: Marker;
  html?: boolean;
}

type Part = string | Marker;

/** Writes items as one line of the view. */
export function writeInline(items: Item[], options: { inTable?: boolean } = {}): string {
  const list = visibleEdges(prepare(items.filter((i) => i.text !== "")));
  const parts: Part[] = [];
  const stack: { w: Wrapper; marker?: Marker }[] = [];
  let wroteText = false;

  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const top = stack.pop()!;
      if (top.marker) {
        const close: Marker = { w: top.w, opening: false, partner: top.marker };
        top.marker.partner = close;
        parts.push(close);
      } else parts.push(top.w.close);
    }
  };

  for (let n = 0; n < list.length; n++) {
    const item = list[n]!;
    const blank = !item.token && /^\s*$/.test(item.text);
    let wrappers =
      item.token || blank ? item.wrappers.filter((w) => !isEmphasis(w)) : item.wrappers;
    // Emphasis open on both sides of a space stays open across it: `**a b**`, not `**a** **b**`.
    if (blank)
      wrappers = acrossSpace(
        wrappers,
        stack.map((s) => s.w),
        nextText(list, n),
      );
    let common = 0;
    while (
      common < stack.length &&
      common < wrappers.length &&
      stack[common]!.w.key === wrappers[common]!.key
    )
      common++;
    closeTo(common);
    for (let i = common; i < wrappers.length; i++) {
      const w = wrappers[i]!;
      if (isEmphasis(w)) {
        const marker: Marker = { w, opening: true };
        parts.push(marker);
        stack.push({ w, marker });
      } else {
        parts.push(w.open);
        stack.push({ w });
      }
    }
    if (item.token) parts.push(item.text);
    else {
      let text = escapeText(item.text, options.inTable);
      if (!wroteText && !options.inTable && parts.every((p) => typeof p !== "string" || p === ""))
        text = escapeLineStart(text);
      parts.push(text);
    }
    wroteText = true;
  }
  closeTo(0);
  resolveEmphasis(parts);
  let out = "";
  for (const p of parts) {
    if (typeof p === "string") out += p;
    else out += p.html ? p.w.html![p.opening ? 0 : 1] : p.opening ? p.w.open : p.w.close;
  }
  return out;
}

const PUNCT = /[\p{P}\p{S}]/u;

function charAt(parts: Part[], index: number, step: 1 | -1): string | undefined {
  for (let i = index + step; i >= 0 && i < parts.length; i += step) {
    const p = parts[i]!;
    if (typeof p !== "string") return "*"; // Another marker: punctuation.
    if (p === "") continue;
    return step === 1 ? p[0] : p[p.length - 1];
  }
  return undefined;
}

function isWs(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

function isPunct(c: string | undefined): boolean {
  return c !== undefined && PUNCT.test(c);
}

/** CommonMark's flanking rules decide whether `**` can open or close here. */
function resolveEmphasis(parts: Part[]): void {
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i]!;
    if (typeof m === "string" || !m.opening || !m.partner) continue;
    const j = parts.indexOf(m.partner);
    const prevO = charAt(parts, i, -1);
    const nextO = charAt(parts, i, 1);
    const prevC = charAt(parts, j, -1);
    const nextC = charAt(parts, j, 1);
    const leftFlanking = !isWs(nextO) && (!isPunct(nextO) || isWs(prevO) || isPunct(prevO));
    const rightFlanking = !isWs(prevC) && (!isPunct(prevC) || isWs(nextC) || isPunct(nextC));
    // A close marker straight before this open of the same character would merge with it.
    const before = parts[i - 1];
    const touching =
      before !== undefined &&
      typeof before !== "string" &&
      !before.opening &&
      !before.html &&
      before.w.open[0] === m.w.open[0];
    if (!leftFlanking || !rightFlanking || touching) {
      m.html = true;
      m.partner.html = true;
    }
  }
}

/** The next item with visible text, unless a token comes first. */
function nextText(list: Item[], n: number): Item | undefined {
  for (let i = n + 1; i < list.length; i++) {
    const item = list[i]!;
    if (item.token) return undefined;
    if (!/^\s*$/.test(item.text)) return item;
  }
  return undefined;
}

function acrossSpace(
  base: readonly Wrapper[],
  open: Wrapper[],
  next: Item | undefined,
): readonly Wrapper[] {
  if (!next) return base;
  for (let i = 0; i < base.length; i++) if (open[i]?.key !== base[i]!.key) return base;
  const out = [...base];
  for (let i = base.length; i < open.length; i++) {
    const w = open[i]!;
    if (!isEmphasis(w) || next.wrappers[i]?.key !== w.key) break;
    out.push(w);
  }
  return out;
}
