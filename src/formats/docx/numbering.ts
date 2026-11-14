/**
 * Numbering (numbering.xml): list definitions and the counters that give each numbered paragraph
 * its label, as Word would draw it.
 */
import type { Styles } from "./styles";
import { child, elements, type XElement } from "./xml";

export interface Level {
  ilvl: number;
  start: number;
  numFmt: string;
  lvlText: string;
  restart?: number;
  isLgl: boolean;
  el: XElement;
}

interface AbstractNum {
  id: string;
  levels: Map<number, Level>;
  numStyleLink?: string;
  el: XElement;
}

interface Num {
  id: string;
  abstractId: string;
  overrides: Map<number, { start?: number; level?: Level }>;
  el: XElement;
}

export interface ListLabel {
  /** The label as Word draws it (`1.`, `a)`, `1.2.3`), or the bullet character. */
  label: string;
  bullet: boolean;
  /** True for a single-level decimal label that Markdown can write as `N.` or `N)`. */
  markdownOrdered: boolean;
  level: Level | undefined;
}

function readLevel(el: XElement): Level {
  const val = (name: string) => child(el, name)?.attrs["w:val"];
  const restart = val("w:lvlRestart");
  const isLgl = child(el, "w:isLgl");
  return {
    ilvl: Number(el.attrs["w:ilvl"] ?? 0) || 0,
    start: Number(val("w:start") ?? 1),
    numFmt: val("w:numFmt") ?? "decimal",
    lvlText: val("w:lvlText") ?? "",
    restart: restart === undefined ? undefined : Number(restart),
    isLgl: isLgl !== undefined && isLgl.attrs["w:val"] !== "0" && isLgl.attrs["w:val"] !== "false",
    el,
  };
}

export class Numbering {
  readonly abstracts = new Map<string, AbstractNum>();
  readonly nums = new Map<string, Num>();
  private readonly counters = new Map<string, number[]>();
  private readonly started = new Set<string>();
  /** numIds used in the document, in order of first use. */
  readonly used: string[] = [];

  constructor(
    root: XElement | null | undefined,
    private readonly styles: Styles,
  ) {
    for (const el of elements(root)) {
      if (el.name === "w:abstractNum") {
        const levels = new Map<number, Level>();
        for (const lvl of elements(el))
          if (lvl.name === "w:lvl") levels.set(readLevel(lvl).ilvl, readLevel(lvl));
        const id = el.attrs["w:abstractNumId"] ?? "";
        this.abstracts.set(id, {
          id,
          levels,
          numStyleLink: child(el, "w:numStyleLink")?.attrs["w:val"],
          el,
        });
      } else if (el.name === "w:num") {
        const overrides = new Map<number, { start?: number; level?: Level }>();
        for (const o of elements(el)) {
          if (o.name !== "w:lvlOverride") continue;
          const ilvl = Number(o.attrs["w:ilvl"] ?? 0) || 0;
          const start = child(o, "w:startOverride")?.attrs["w:val"];
          const lvl = child(o, "w:lvl");
          overrides.set(ilvl, {
            start: start === undefined ? undefined : Number(start),
            level: lvl ? readLevel(lvl) : undefined,
          });
        }
        const id = el.attrs["w:numId"] ?? "";
        this.nums.set(id, {
          id,
          abstractId: child(el, "w:abstractNumId")?.attrs["w:val"] ?? "",
          overrides,
          el,
        });
      }
    }
  }

  /** The abstract definition behind a num, following a `numStyleLink` to its numbering style. */
  abstractOf(numId: string, depth = 0): AbstractNum | undefined {
    const num = this.nums.get(numId);
    const abs = num ? this.abstracts.get(num.abstractId) : undefined;
    if (abs?.numStyleLink && depth < 5) {
      const linked = this.styles.numbering(abs.numStyleLink);
      if (linked && linked.numId !== numId) return this.abstractOf(linked.numId, depth + 1) ?? abs;
    }
    return abs;
  }

  level(numId: string, ilvl: number): Level | undefined {
    return (
      this.nums.get(numId)?.overrides.get(ilvl)?.level ?? this.abstractOf(numId)?.levels.get(ilvl)
    );
  }

  /** Advances the counters for a numbered paragraph and returns its label. */
  next(numId: string, ilvl: number): ListLabel {
    const num = this.nums.get(numId);
    const abs = this.abstractOf(numId);
    if (!this.used.includes(numId)) this.used.push(numId);
    const level = this.level(numId, ilvl);
    if (!num || !abs || !level) return { label: "?", bullet: false, markdownOrdered: false, level };
    const key = abs.id;
    let counters = this.counters.get(key);
    if (!counters) {
      counters = [];
      this.counters.set(key, counters);
    }
    if (!this.started.has(numId)) {
      this.started.add(numId);
      for (const [i, o] of num.overrides) {
        if (o.start !== undefined) counters[i] = o.start - 1;
        else if (o.level) counters[i] = o.level.start - 1;
      }
    }
    for (let i = 0; i <= ilvl; i++) {
      if (counters[i] === undefined) counters[i] = (this.level(numId, i)?.start ?? 1) - 1;
    }
    counters[ilvl]! += 1;
    // Deeper levels restart (unless a level says it restarts only after a higher one).
    for (let i = ilvl + 1; i < 9; i++) {
      const deeper = this.level(numId, i);
      const restartAfter = deeper?.restart;
      if (restartAfter === 0) continue;
      if (restartAfter === undefined || ilvl < restartAfter)
        counters[i] = undefined as unknown as number;
    }
    if (level.numFmt === "bullet")
      return { label: level.lvlText, bullet: true, markdownOrdered: false, level };
    const label = level.lvlText.replace(/%([1-9])/g, (_m, d: string) => {
      const i = Number(d) - 1;
      const lvl = this.level(numId, i);
      const value = counters![i] ?? lvl?.start ?? 1;
      return formatNumber(value, level.isLgl && i < ilvl ? "decimal" : (lvl?.numFmt ?? "decimal"));
    });
    const markdownOrdered =
      level.numFmt === "decimal" &&
      /^%[1-9][.)]$/.test(level.lvlText) &&
      level.lvlText[1] === String(ilvl + 1);
    return { label, bullet: false, markdownOrdered, level };
  }
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** Word's letter numbering: a…z, then aa…zz, aaa… */
function letters(n: number): string {
  if (n <= 0) return String(n);
  const c = String.fromCharCode(97 + ((n - 1) % 26));
  return c.repeat(Math.floor((n - 1) / 26) + 1);
}

export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "upperRoman":
      return roman(n);
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "upperLetter":
      return letters(n).toUpperCase();
    case "lowerLetter":
      return letters(n);
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    case "ordinal": {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
    }
    case "none":
      return "";
    default:
      return String(n);
  }
}
