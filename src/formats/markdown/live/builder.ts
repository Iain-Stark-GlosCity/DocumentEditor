/**
 * The core loop of live preview: walk the syntax tree over a range, call the renderers, and
 * collect what they ask for into one DecorationSet. Shared by the inline pass (view plugin) and
 * the block pass (state field).
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type WidgetType } from "@codemirror/view";
import { builtinRenderers } from "./renderers";
import { frontMatterEnd } from "./frontmatter";
import { liveOptions, liveRenderers, type LiveBuilder, type LiveRenderer } from "./types";

export type Pass = "inline" | "block";

export interface BuildRange {
  from: number;
  to: number;
  /** Text in this range is never hidden or replaced (the line being composed by an IME). */
  protect?: { from: number; to: number } | null;
}

const hidden = Decoration.replace({});
const markCache = new Map<string, Decoration>();

function markDecoration(className: string, attributes?: Record<string, string>): Decoration {
  if (attributes) return Decoration.mark({ class: className, attributes });
  let mark = markCache.get(className);
  if (!mark) markCache.set(className, (mark = Decoration.mark({ class: className })));
  return mark;
}

const lineCache = new Map<string, Decoration>();
function lineDecoration(className: string): Decoration {
  let line = lineCache.get(className);
  if (!line) lineCache.set(className, (line = Decoration.line({ class: className })));
  return line;
}

interface LineInfo {
  classes: Set<string>;
  counters: Map<string, number>;
}

class Collector implements LiveBuilder {
  readonly items: Range<Decoration>[] = [];
  private readonly lines = new Map<number, LineInfo>();
  readonly options;
  private readonly firstLine: number;

  constructor(
    readonly state: EditorState,
    readonly from: number,
    readonly to: number,
    private readonly protect: { from: number; to: number } | null,
  ) {
    this.options = state.facet(liveOptions);
    this.firstLine = state.doc.lineAt(from).from;
  }

  touches(from: number, to: number): boolean {
    for (const r of this.state.selection.ranges) if (r.from <= to && r.to >= from) return true;
    return false;
  }

  linesTouched(from: number, to: number): boolean {
    const doc = this.state.doc;
    return this.touches(doc.lineAt(from).from, doc.lineAt(Math.max(from, to)).to);
  }

  private protectedRange(from: number, to: number): boolean {
    const p = this.protect;
    return !!p && from <= p.to && to >= p.from;
  }

  hide(from: number, to: number): void {
    if (to <= from || this.protectedRange(from, to)) return;
    this.items.push(hidden.range(from, to));
  }

  replace(from: number, to: number, widget: WidgetType): void {
    if (to < from || this.protectedRange(from, to)) return;
    this.items.push(Decoration.replace({ widget }).range(from, to));
  }

  mark(from: number, to: number, className: string, attributes?: Record<string, string>): void {
    if (to <= from) return;
    this.items.push(markDecoration(className, attributes).range(from, to));
  }

  /** Line decorations are only made for lines that overlap the range being decorated. */
  private inRange(pos: number): boolean {
    return pos >= this.firstLine && pos <= this.to;
  }

  private line(pos: number): LineInfo {
    const start = this.state.doc.lineAt(pos).from;
    let info = this.lines.get(start);
    if (!info) this.lines.set(start, (info = { classes: new Set(), counters: new Map() }));
    return info;
  }

  lineClass(pos: number, className: string): void {
    if (this.inRange(pos)) this.line(pos).classes.add(className);
  }

  linesClass(from: number, to: number, className: string): void {
    const doc = this.state.doc;
    const first = doc.lineAt(Math.max(from, this.from)).number;
    const last = doc.lineAt(Math.min(to, this.to)).number;
    for (let n = first; n <= last; n++) this.lineClass(doc.line(n).from, className);
  }

  lineCount(pos: number, name: string): void {
    if (!this.inRange(pos)) return;
    const counters = this.line(pos).counters;
    counters.set(name, (counters.get(name) ?? 0) + 1);
  }

  add(from: number, to: number, decoration: Decoration): void {
    this.items.push(decoration.range(from, to));
  }

  finish(): DecorationSet {
    for (const [pos, info] of this.lines) {
      const classes = [...info.classes];
      for (const [name, count] of info.counters) classes.push(`${name}-${Math.min(count, 6)}`);
      if (classes.length > 0) this.items.push(lineDecoration(classes.sort().join(" ")).range(pos));
    }
    return Decoration.set(this.items, true);
  }
}

/** Renderers by node name, extension renderers first. Cached per facet value. */
const tables = new WeakMap<readonly LiveRenderer[], Map<string, LiveRenderer[]>>();
function renderersByNode(state: EditorState): Map<string, LiveRenderer[]> {
  const extra = state.facet(liveRenderers);
  let table = tables.get(extra);
  if (!table) {
    table = new Map();
    for (const renderer of [...extra, ...builtinRenderers]) {
      for (const name of renderer.nodes) {
        const list = table.get(name) ?? [];
        list.push(renderer);
        table.set(name, list);
      }
    }
    tables.set(extra, table);
  }
  return table;
}

/** Decorations for one pass over `range` of the current syntax tree. */
export function buildDecorations(state: EditorState, pass: Pass, range: BuildRange): DecorationSet {
  const from = Math.max(0, Math.min(range.from, state.doc.length));
  const to = Math.max(from, Math.min(range.to, state.doc.length));
  const out = new Collector(state, from, to, range.protect ?? null);
  const table = renderersByNode(state);

  const fmEnd = frontMatterEnd(state.doc);
  if (fmEnd > 0 && pass === "inline" && from <= fmEnd) {
    out.linesClass(0, fmEnd, "cm-live-frontmatter");
  }

  const bodyStart = fmEnd > 0 ? fmEnd + 1 : 0;
  if (Math.max(from, bodyStart) > to) return out.finish();
  syntaxTree(state).iterate({
    from: Math.max(from, bodyStart),
    to,
    enter(ref) {
      // Front matter is never rendered; the grammar mistakes it for a rule and a heading.
      if (ref.from < bodyStart) return ref.to > bodyStart ? undefined : false;
      const list = table.get(ref.name);
      if (!list) return undefined;
      const node = ref.node;
      for (const renderer of list) {
        const run = pass === "inline" ? renderer.decorate : renderer.decorateBlock;
        if (run && run.call(renderer, node, out) === false) return false;
      }
      return undefined;
    },
  });
  return out.finish();
}
