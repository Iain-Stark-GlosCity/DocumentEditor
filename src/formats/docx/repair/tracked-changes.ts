/**
 * Repairs for tracked changes (revisions): accept all of them, or reject all of them, in every
 * story part (the main document, headers, footers, footnotes, endnotes and comments).
 *
 * Semantics follow ECMA-376 Part 1, 17.13. Every change is a surgical text edit of the original
 * part: a wrapper is unwrapped by replacing the whole element with its (transformed) content, a
 * change is removed by replacing the element with nothing, and old properties are restored by
 * replacing the property element's content. Nested revisions never give overlapping edits: the
 * walker returns edits for the outermost element it changes, and folds the edits of everything
 * inside it into that element's replacement text.
 *
 * What it does not do (listed in `skipped`, never guessed): paragraph mark deletions on accept and
 * paragraph mark insertions on reject (both join two paragraphs), cell-level changes, numbering
 * changes on reject, table rows with vertically merged cells, changes that cover part of a field,
 * and text boxes or drawings whose two copies (`mc:Choice`, `mc:Fallback`) do not change alike.
 * settings.xml is not touched, so track changes stays switched on.
 */
import { isOn } from "../notation";
import { child, elements, type XElement } from "../xml";
import { applyEdits, innerRange, type TextEdit } from "./splice";
import type { RepairContext, RepairDef, RepairResult } from "./types";

type Mode = "accept" | "reject";

/** What the summary and details count. `markers` are leftover move range markers. */
type Kind = "insertions" | "deletions" | "moves" | "formatting" | "markers";

type SkipKind =
  | "paraDel"
  | "paraIns"
  | "runMark"
  | "cell"
  | "numbering"
  | "props"
  | "alternate"
  | "vmerge"
  | "emptyTable"
  | "field"
  | "unusual"
  | "failed";

const SKIP_WORDS: Record<SkipKind, [one: string, many: string, why: string]> = {
  paraDel: [
    "paragraph mark deletion",
    "paragraph mark deletions",
    "accepting them would join paragraphs",
  ],
  paraIns: [
    "paragraph mark insertion",
    "paragraph mark insertions",
    "rejecting them would join paragraphs",
  ],
  runMark: [
    "change marked on run formatting",
    "changes marked on run formatting",
    "not a place Word puts them",
  ],
  cell: [
    "table cell change",
    "table cell changes",
    "inserted, deleted or merged cells are not handled",
  ],
  numbering: ["numbering change", "numbering changes", "the earlier numbering cannot be rebuilt"],
  props: [
    "formatting change",
    "formatting changes",
    "the earlier formatting could not be restored safely",
  ],
  alternate: [
    "change in a text box or drawing",
    "changes in text boxes or drawings",
    "its two stored copies do not change alike",
  ],
  vmerge: [
    "table row change",
    "table row changes",
    "the rows have vertically merged cells or hold part of a field",
  ],
  emptyTable: ["table row change", "table row changes", "removing them would leave an empty table"],
  field: ["change", "changes", "they cover only part of a field"],
  unusual: ["change", "changes", "they are written in an unusual way"],
  failed: ["change", "changes", "the edits could not be worked out safely"],
};

const KIND_WORDS: Record<Exclude<Kind, "markers">, [string, string]> = {
  insertions: ["insertion", "insertions"],
  deletions: ["deletion", "deletions"],
  moves: ["move", "moves"],
  formatting: ["formatting change", "formatting changes"],
};

/** Content wrappers; under `w:rPr` or `w:trPr` they are markers instead. */
const WRAPPERS = new Set(["w:ins", "w:del", "w:moveFrom", "w:moveTo"]);
const MOVE_RANGES = new Set([
  "w:moveFromRangeStart",
  "w:moveFromRangeEnd",
  "w:moveToRangeStart",
  "w:moveToRangeEnd",
]);
const CELL_CHANGES = new Set(["w:cellIns", "w:cellDel", "w:cellMerge"]);
const CHANGE_RECORDS = new Set([
  "w:rPrChange",
  "w:pPrChange",
  "w:sectPrChange",
  "w:tblPrChange",
  "w:tblPrExChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:tblGridChange",
  "w:numberingChange",
]);

/**
 * Property elements whose change record can be rejected: the record's name, and the children of
 * the property element that are not part of the record's old properties (they stay, in front of or
 * after the restored ones, as the schema orders them).
 */
const RESTORABLE: Record<string, { record: string; keep: string[]; keepFirst: boolean }> = {
  "w:rPr": {
    record: "w:rPrChange",
    keep: ["w:ins", "w:del", "w:moveFrom", "w:moveTo"],
    keepFirst: true,
  },
  "w:pPr": { record: "w:pPrChange", keep: ["w:rPr", "w:sectPr"], keepFirst: false },
  "w:sectPr": {
    record: "w:sectPrChange",
    keep: ["w:headerReference", "w:footerReference"],
    keepFirst: true,
  },
  "w:tblPr": { record: "w:tblPrChange", keep: [], keepFirst: false },
  "w:tblPrEx": { record: "w:tblPrExChange", keep: [], keepFirst: false },
  "w:trPr": { record: "w:trPrChange", keep: ["w:ins", "w:del"], keepFirst: false },
  "w:tcPr": { record: "w:tcPrChange", keep: [], keepFirst: false },
  "w:tblGrid": { record: "w:tblGridChange", keep: [], keepFirst: false },
};

/** Range markers that stay when the content around them is removed, as Word keeps them. */
const KEPT_MARKERS = new Set([
  "w:bookmarkStart",
  "w:bookmarkEnd",
  "w:commentRangeStart",
  "w:commentRangeEnd",
  "w:permStart",
  "w:permEnd",
]);

/** Children a table may have when it is removed whole because every row goes. */
const PLAIN_TABLE_CHILDREN = new Set(["w:tblPr", "w:tblGrid", "w:tr"]);

interface Tally {
  counts: Record<Kind, number>;
  /** Table rows removed. */
  rows: number;
  skips: Map<SkipKind, number>;
  /** What happened, in order, to compare the two copies of alternate content. */
  sig: string[];
}

function newTally(): Tally {
  return {
    counts: { insertions: 0, deletions: 0, moves: 0, formatting: 0, markers: 0 },
    rows: 0,
    skips: new Map(),
    sig: [],
  };
}

function addTally(into: Tally, from: Tally): void {
  for (const k of Object.keys(from.counts) as Kind[]) into.counts[k] += from.counts[k];
  into.rows += from.rows;
  for (const [k, n] of from.skips) into.skips.set(k, (into.skips.get(k) ?? 0) + n);
  into.sig.push(...from.sig);
}

function kindOf(name: string): Kind {
  if (name === "w:moveFrom" || name === "w:moveTo") return "moves";
  return name === "w:ins" ? "insertions" : "deletions";
}

/** Walks one part and returns the edits for one mode. Never edits anything itself. */
class Walker {
  constructor(
    private readonly source: string,
    private readonly mode: Mode,
  ) {}

  private count(t: Tally, kind: Kind, label: string): void {
    t.counts[kind]++;
    t.sig.push(label);
  }

  private skip(t: Tally, kind: SkipKind, n = 1): void {
    t.skips.set(kind, (t.skips.get(kind) ?? 0) + n);
    t.sig.push(`skip:${kind}`);
  }

  private remove(el: XElement, insert = ""): TextEdit {
    return { from: el.start, to: el.end, insert };
  }

  /** The text of `from..to` with `edits` (all inside the range) applied. */
  private materialise(from: number, to: number, edits: TextEdit[]): string {
    return applyEdits(
      this.source.slice(from, to),
      edits.map((e) => ({ from: e.from - from, to: e.to - from, insert: e.insert })),
    );
  }

  /** Whether the element's start tag declares a namespace (its content would lose it if moved). */
  private declaresNamespace(el: XElement): boolean {
    const gt = this.source.indexOf(">", el.start);
    const tag = this.source.slice(el.start, gt < 0 || gt > el.end ? el.end : gt + 1);
    return /\sxmlns[:=]/.test(tag);
  }

  visit(el: XElement, deleted: boolean, t: Tally): TextEdit[] {
    const name = el.name;
    if (name === "mc:AlternateContent") return this.alternate(el, deleted, t);
    if (CHANGE_RECORDS.has(name)) return this.record(el, t);
    if (WRAPPERS.has(name)) return this.wrapper(el, deleted, t);
    if (MOVE_RANGES.has(name)) {
      this.count(t, "markers", "marker");
      return [this.remove(el)];
    }
    if (CELL_CHANGES.has(name)) {
      this.skip(t, "cell");
      return [];
    }
    if (name === "w:tbl") return this.table(el, deleted, t);
    if (name === "w:tr") return this.row(el, this.rowDecision(el), deleted, t);
    if (deleted && (name === "w:delText" || name === "w:delInstrText")) return this.rename(el);
    if (this.mode === "reject" && RESTORABLE[name]) {
      const restored = this.restore(el, deleted, t);
      if (restored) return restored;
    }
    return this.children(el, deleted, t);
  }

  private children(el: XElement, deleted: boolean, t: Tally): TextEdit[] {
    const out: TextEdit[] = [];
    for (const c of el.children) if (typeof c !== "string") out.push(...this.visit(c, deleted, t));
    return out;
  }

  /** `w:delText` becomes `w:t` and `w:delInstrText` becomes `w:instrText`: only the tag names change. */
  private rename(el: XElement): TextEdit[] {
    const raw = el.rawName;
    const colon = raw.indexOf(":");
    const target =
      (colon < 0 ? "" : raw.slice(0, colon + 1)) + (el.name === "w:delText" ? "t" : "instrText");
    if (!this.source.startsWith(raw, el.start + 1)) return [];
    const out: TextEdit[] = [{ from: el.start + 1, to: el.start + 1 + raw.length, insert: target }];
    if (innerRange(this.source, el)) {
      const close = this.source.lastIndexOf("</", el.end - 1);
      if (close > el.start && this.source.startsWith(raw, close + 2)) {
        out.push({ from: close + 2, to: close + 2 + raw.length, insert: target });
      } else return [];
    }
    return out;
  }

  /** A change record met on its own: removed on accept; on reject its parent restores it, or it is skipped. */
  private record(el: XElement, t: Tally): TextEdit[] {
    if (this.mode === "accept") {
      this.count(t, "formatting", "formatting");
      return [this.remove(el)];
    }
    this.skip(t, el.name === "w:numberingChange" ? "numbering" : "props");
    return [];
  }

  /** Reject: replaces a property element's content with the old properties from its record. */
  private restore(el: XElement, deleted: boolean, t: Tally): TextEdit[] | null {
    const spec = RESTORABLE[el.name];
    if (!spec) return null;
    const records = elements(el).filter((c) => c.name === spec.record);
    if (records.length !== 1) return null;
    const record = records[0]!;
    const old = child(record, el.name);
    if (!old || this.declaresNamespace(record) || this.declaresNamespace(old)) return null;
    if (el.name === "w:tcPr" && elements(el).some((c) => CELL_CHANGES.has(c.name))) return null;
    const inner = innerRange(this.source, el);
    if (!inner) return null;
    const oldRange = innerRange(this.source, old);
    const oldText = oldRange ? this.source.slice(oldRange.from, oldRange.to) : "";
    let kept = "";
    for (const c of elements(el)) {
      if (!spec.keep.includes(c.name)) continue;
      kept += this.materialise(c.start, c.end, this.visit(c, deleted, t));
    }
    this.count(t, "formatting", "formatting");
    return [
      { from: inner.from, to: inner.to, insert: spec.keepFirst ? kept + oldText : oldText + kept },
    ];
  }

  private wrapper(el: XElement, deleted: boolean, t: Tally): TextEdit[] {
    const name = el.name;
    const insertLike = name === "w:ins" || name === "w:moveTo";
    const kind = kindOf(name);
    const parent = el.parent?.name;
    // Content of the change survives: accept an insertion, reject a deletion.
    const survives = (this.mode === "accept") === insertLike;

    if (parent === "w:trPr") {
      // Row markers whose row is removed never get here (see `row`).
      if (survives && (name === "w:ins" || name === "w:del")) {
        this.count(t, kind, `row-${kind}`);
        return [this.remove(el)];
      }
      this.skip(t, "unusual");
      return [];
    }
    if (parent === "w:rPr") {
      // A paragraph mark change (w:pPr/w:rPr/w:ins and friends).
      if (survives) {
        this.count(t, kind, `mark-${kind}`);
        return [this.remove(el)];
      }
      const paragraph = el.parent?.parent?.name === "w:pPr";
      this.skip(t, !paragraph ? "runMark" : insertLike ? "paraIns" : "paraDel");
      return [];
    }

    if (survives) {
      if (this.declaresNamespace(el)) {
        this.skip(t, "unusual");
        return [];
      }
      const nowDeleted = deleted || !insertLike;
      const inside = this.children(el, nowDeleted, t);
      const inner = innerRange(this.source, el);
      this.count(t, kind, `${kind}-keep`);
      return [this.remove(el, inner ? this.materialise(inner.from, inner.to, inside) : "")];
    }
    if (!this.fieldsBalanced(el)) {
      this.skip(t, "field");
      return [];
    }
    this.count(t, kind, `${kind}-drop`);
    let kept = "";
    for (const c of elements(el))
      if (KEPT_MARKERS.has(c.name)) kept += this.source.slice(c.start, c.end);
    return [this.remove(el, kept)];
  }

  /** True when removing the element cannot leave half a complex field behind. */
  private fieldsBalanced(el: XElement): boolean {
    let begin = 0;
    let separate = 0;
    let end = 0;
    const walk = (e: XElement): void => {
      for (const c of e.children) {
        if (typeof c === "string") continue;
        if (c.name === "w:fldChar") {
          const type = c.attrs["w:fldCharType"];
          if (type === "begin") begin++;
          else if (type === "separate") separate++;
          else if (type === "end") end++;
        }
        walk(c);
      }
    };
    walk(el);
    return begin === end && separate <= begin;
  }

  private rowDecision(tr: XElement): "keep" | "remove" | "skip" {
    const trPr = child(tr, "w:trPr");
    const marker = child(trPr, this.mode === "accept" ? "w:del" : "w:ins");
    if (!marker) return "keep";
    const merged = elements(tr).some(
      (tc) => tc.name === "w:tc" && child(child(tc, "w:tcPr"), "w:vMerge") !== undefined,
    );
    if (merged || !this.fieldsBalanced(tr)) return "skip";
    return "remove";
  }

  private row(
    tr: XElement,
    decision: "keep" | "remove" | "skip",
    deleted: boolean,
    t: Tally,
  ): TextEdit[] {
    if (decision === "keep") return this.children(tr, deleted, t);
    if (decision === "skip") {
      this.skip(t, "vmerge");
      return [];
    }
    this.countRow(t);
    return [this.remove(tr)];
  }

  private countRow(t: Tally): void {
    const kind: Kind = this.mode === "accept" ? "deletions" : "insertions";
    this.count(t, kind, `row-drop-${kind}`);
    t.rows++;
  }

  private table(tbl: XElement, deleted: boolean, t: Tally): TextEdit[] {
    const kids = elements(tbl);
    const rows = kids.filter((c) => c.name === "w:tr");
    const decisions = new Map(rows.map((r) => [r, this.rowDecision(r)] as const));
    const allGo = rows.length > 0 && rows.every((r) => decisions.get(r) === "remove");
    if (allGo) {
      if (kids.every((c) => PLAIN_TABLE_CHILDREN.has(c.name))) {
        for (let i = 0; i < rows.length; i++) this.countRow(t);
        return [this.remove(tbl)];
      }
      // Rows would go but something else stays: an empty table is not safe. Keep the rows.
      this.skip(t, "emptyTable", rows.length);
      const out: TextEdit[] = [];
      for (const c of kids) if (c.name !== "w:tr") out.push(...this.visit(c, deleted, t));
      return out;
    }
    const out: TextEdit[] = [];
    for (const c of kids) {
      const decision = decisions.get(c);
      out.push(...(decision ? this.row(c, decision, deleted, t) : this.visit(c, deleted, t)));
    }
    return out;
  }

  /**
   * `mc:AlternateContent` holds the same content more than once (`mc:Choice`, `mc:Fallback`).
   * Each copy is changed by the same rules; if the copies would not change alike, none is changed.
   * Only the first copy is counted.
   */
  private alternate(el: XElement, deleted: boolean, t: Tally): TextEdit[] {
    const branches = elements(el).filter((c) => c.name === "mc:Choice" || c.name === "mc:Fallback");
    if (branches.length === 0) return this.children(el, deleted, t);
    const results = branches.map((b) => {
      const bt = newTally();
      return { edits: this.visit(b, deleted, bt), tally: bt };
    });
    const sigs = results.map((r) => r.tally.sig.join("|"));
    if (sigs.every((s) => s === "")) return [];
    if (sigs.every((s) => s === sigs[0])) {
      addTally(t, results[0]!.tally);
      return results.flatMap((r) => r.edits);
    }
    const changes = Math.max(...results.map((r) => r.tally.sig.length));
    this.skip(t, "alternate", changes);
    return [];
  }
}

interface PartResult {
  part: string;
  edits: TextEdit[];
  tally: Tally;
  /** The part could not be read, but looks as if it holds tracked changes. */
  damaged: boolean;
}

const LOOKS_TRACKED =
  /<(?:[\w.-]+:)?(?:ins|del|moveFrom|moveTo|[a-zA-Z]+PrChange|tblGridChange)[\s/>]/;

/** The edits and counts for one parsed part; a part the walker cannot handle is left alone. */
function walkPart(source: string, root: XElement, mode: Mode): { edits: TextEdit[]; tally: Tally } {
  const tally = newTally();
  try {
    const edits = new Walker(source, mode).visit(root, false, tally);
    applyEdits(source, edits); // Proves the edits do not overlap before any is used.
    return { edits, tally };
  } catch {
    const failed = newTally();
    failed.skips.set("failed", 1);
    return { edits: [], tally: failed };
  }
}

function analyse(ctx: RepairContext, mode: Mode): PartResult[] {
  const out: PartResult[] = [];
  let parts: string[];
  try {
    parts = ctx.stories();
  } catch {
    return out;
  }
  for (const part of parts) {
    const editor = ctx.editor(part);
    const root = editor?.doc.root;
    if (!editor || !root) {
      const text = ctx.text(part);
      if (text !== undefined && LOOKS_TRACKED.test(text))
        out.push({ part, edits: [], tally: newTally(), damaged: true });
      continue;
    }
    out.push({ part, ...walkPart(editor.source, root, mode), damaged: false });
  }
  return out;
}

function plural(n: number, [one, many]: readonly [string, string, ...string[]]): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "3 insertions, 2 deletions and 1 formatting change" (leftover move markers only if alone). */
function countWords(counts: Record<Kind, number>): string {
  const items: string[] = [];
  for (const k of Object.keys(KIND_WORDS) as (keyof typeof KIND_WORDS)[])
    if (counts[k] > 0) items.push(plural(counts[k], KIND_WORDS[k]));
  if (items.length === 0 && counts.markers > 0)
    items.push(plural(counts.markers, ["leftover move marker", "leftover move markers"]));
  return listWords(items);
}

function actionable(t: Tally): number {
  return Object.values(t.counts).reduce((a, b) => a + b, 0);
}

function skippedTotal(t: Tally): number {
  let n = 0;
  for (const v of t.skips.values()) n += v;
  return n;
}

function offer(ctx: RepairContext, mode: Mode): string | null {
  try {
    const total = newTally();
    let damaged = 0;
    for (const r of analyse(ctx, mode)) {
      addTally(total, r.tally);
      if (r.damaged) damaged++;
    }
    if (actionable(total) === 0) return null;
    const left = skippedTotal(total);
    const notes: string[] = [];
    if (left > 0) notes.push(`${left} left as ${left === 1 ? "it is" : "they are"}`);
    if (damaged > 0) notes.push(`${plural(damaged, ["part", "parts"])} could not be read`);
    return countWords(total.counts) + (notes.length > 0 ? ` (${notes.join(", ")})` : "");
  } catch {
    return null;
  }
}

function trackingOn(ctx: RepairContext): boolean {
  try {
    const settings = ctx.pkg.related(ctx.pkg.mainPart, "settings");
    const root = settings ? ctx.pkg.xml(settings)?.root : null;
    return isOn(child(root ?? undefined, "w:trackRevisions")) === true;
  } catch {
    return false;
  }
}

function plan(ctx: RepairContext, mode: Mode): RepairResult {
  const details: string[] = [];
  const skipped: string[] = [];
  const verb = mode === "accept" ? "accepts" : "rejects";
  for (const r of analyse(ctx, mode)) {
    if (r.damaged) {
      skipped.push(`${r.part}: could not be read, so its tracked changes are left as they are`);
      continue;
    }
    const editor = ctx.editor(r.part);
    if (editor && r.edits.length > 0) {
      for (const e of r.edits) editor.splice(e.from, e.to, e.insert);
      const rows =
        r.tally.rows > 0 ? `, removing ${plural(r.tally.rows, ["table row", "table rows"])}` : "";
      details.push(`${r.part}: ${verb} ${countWords(r.tally.counts)}${rows}`);
    }
    for (const [kind, n] of r.tally.skips) {
      const [one, many, why] = SKIP_WORDS[kind];
      skipped.push(
        `${r.part}: ${n} ${n === 1 ? one : many} left as ${n === 1 ? "it is" : "they are"} (${why})`,
      );
    }
  }
  if (trackingOn(ctx))
    details.push(
      "Track changes stays switched on (settings.xml is not changed), so new edits will still be tracked",
    );
  return { details, skipped };
}

export const acceptTrackedChanges: RepairDef = {
  id: "docx.accept-tracked-changes",
  title: "Accept all tracked changes",
  offer: (ctx) => offer(ctx, "accept"),
  plan: (ctx) => plan(ctx, "accept"),
};

export const rejectTrackedChanges: RepairDef = {
  id: "docx.reject-tracked-changes",
  title: "Reject all tracked changes",
  offer: (ctx) => offer(ctx, "reject"),
  plan: (ctx) => plan(ctx, "reject"),
};

/** Repairs for tracked changes (revisions). */
export const trackedChangeRepairs: RepairDef[] = [acceptTrackedChanges, rejectTrackedChanges];
