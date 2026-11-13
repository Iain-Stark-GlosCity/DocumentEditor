/**
 * Inline formatting toggles (bold, italic, strikethrough, inline code) and the link command.
 *
 * Each command decides per selection range, using the syntax tree, whether to wrap or to
 * un-wrap, collects every edit into one change set and applies it as a single transaction.
 */
import { ChangeSet, EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import {
  commit,
  findAncestor,
  isBlank,
  isUrl,
  linkDestination,
  parseLine,
  treeOf,
  type EditCommand,
  type SyntaxNode,
  type Tree,
} from "./syntax";

interface InlineSpec {
  /** Lezer node name of the construct. */
  node: string;
  /** Lezer node name of its delimiters. */
  mark: string;
  open: string;
  close: string;
}

interface Segment {
  from: number;
  to: number;
}

/** Characters at the start of a line's text that are markup, not content (list markers, `#`). */
function contentStartOf(text: string): number {
  const parsed = parseLine(text);
  const rest = text.slice(parsed.contentStart);
  const heading = /^#{1,6}(?:[ \t]+|$)/.exec(rest);
  return parsed.contentStart + (heading ? heading[0].length : 0);
}

/** Splits a range into one trimmed segment per line, leaving out block markers and blank lines. */
function segmentsOf(state: EditorState, from: number, to: number): Segment[] {
  const { doc } = state;
  const out: Segment[] = [];
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    let s = Math.max(from, line.from);
    let e = Math.min(to, line.to);
    if (first !== last || from === line.from)
      s = Math.max(s, line.from + contentStartOf(line.text));
    while (s < e && /\s/.test(doc.sliceString(s, s + 1))) s++;
    while (e > s && /\s/.test(doc.sliceString(e - 1, e))) e--;
    if (s < e) out.push({ from: s, to: e });
  }
  return out;
}

/** The smallest construct of the given type that contains `[from, to]`. */
function enclosing(tree: Tree, name: string, from: number, to: number): SyntaxNode | null {
  let best: SyntaxNode | null = null;
  const probes: [number, -1 | 1][] = [
    [from, 1],
    [to, -1],
    [from, -1],
    [to, 1],
  ];
  for (const [pos, side] of probes) {
    const node = findAncestor(tree.resolveInner(pos, side), [name]);
    if (
      node &&
      node.from <= from &&
      node.to >= to &&
      (!best || node.to - node.from < best.to - best.from)
    ) {
      best = node;
    }
  }
  return best;
}

/** Constructs of the given type wholly inside the range, if together they cover all its text. */
function coveredBy(
  state: EditorState,
  tree: Tree,
  name: string,
  from: number,
  to: number,
): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter: (ref) => {
      if (ref.name === name && ref.from >= from && ref.to <= to) {
        nodes.push(ref.node);
        return false;
      }
      return undefined;
    },
  });
  if (nodes.length === 0) return [];
  let rest = "";
  let at = from;
  for (const n of nodes) {
    rest += state.sliceDoc(at, n.from);
    at = n.to;
  }
  rest += state.sliceDoc(at, to);
  return isBlank(rest) ? nodes : [];
}

/** The delimiter children at the two ends of a construct. */
function delimiters(node: SyntaxNode, mark: string): { from: number; to: number }[] {
  const marks = node.getChildren(mark);
  const first = marks.find((m) => m.from === node.from);
  const last = [...marks].reverse().find((m) => m.to === node.to);
  const out: { from: number; to: number }[] = [];
  if (first) out.push({ from: first.from, to: first.to });
  if (last && last !== first) out.push({ from: last.from, to: last.to });
  return out;
}

function backtickFence(content: string): { open: string; close: string } {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(content) ? " " : "";
  return { open: ticks + pad, close: pad + ticks };
}

type Edit =
  | { kind: "delete"; from: number; to: number }
  | { kind: "wrap"; from: number; to: number; open: string; close: string }
  | { kind: "pair"; at: number; open: string; close: string };

/** Builds a toggle command for one kind of inline construct. */
function toggleInline(spec: InlineSpec): EditCommand {
  return (target) => {
    const { state } = target;
    const tree = treeOf(state);
    const edits = new Map<string, Edit>();
    const add = (key: string, edit: Edit) => edits.set(key, edit);

    // Pass 1: decide what each range needs.
    const plans = state.selection.ranges.map((range) => {
      let from = range.from;
      let to = range.to;
      let wordAt = false;
      if (range.empty) {
        const word = state.wordAt(range.head);
        if (word) {
          from = word.from;
          to = word.to;
          wordAt = true;
        }
      }
      const found = enclosing(tree, spec.node, from, to);
      const nodes = found
        ? [found]
        : range.empty
          ? []
          : coveredBy(state, tree, spec.node, from, to);
      if (nodes.length > 0) {
        for (const node of nodes) {
          for (const d of delimiters(node, spec.mark)) add(`d${d.from}`, { kind: "delete", ...d });
        }
        return { range, kind: "unwrap" as const };
      }
      if (range.empty && !wordAt) {
        const { open, close } =
          spec.node === "InlineCode" ? backtickFence("") : { open: spec.open, close: spec.close };
        add(`p${range.head}`, { kind: "pair", at: range.head, open, close });
        return { range, kind: "pair" as const, open };
      }
      const segments = segmentsOf(state, from, to);
      if (segments.length === 0) {
        add(`p${range.head}`, { kind: "pair", at: range.head, open: spec.open, close: spec.close });
        return { range, kind: "pair" as const, open: spec.open };
      }
      for (const s of segments) {
        const { open, close } =
          spec.node === "InlineCode"
            ? backtickFence(state.sliceDoc(s.from, s.to))
            : { open: spec.open, close: spec.close };
        add(`w${s.from}:${s.to}`, { kind: "wrap", ...s, open, close });
      }
      return { range, kind: "wrap" as const, wordAt, segments };
    });

    // Pass 2: one change set for everything.
    const specs: ChangeSpec[] = [];
    for (const edit of edits.values()) {
      if (edit.kind === "delete") specs.push({ from: edit.from, to: edit.to });
      else if (edit.kind === "pair") specs.push({ from: edit.at, insert: edit.open + edit.close });
      else {
        specs.push({ from: edit.from, insert: edit.open });
        specs.push({ from: edit.to, insert: edit.close });
      }
    }
    if (specs.length === 0) return false;
    const changes = ChangeSet.of(specs, state.doc.length);

    const selection = EditorSelection.create(
      plans.map((plan) => {
        const { range } = plan;
        if (plan.kind === "pair") {
          return EditorSelection.cursor(changes.mapPos(range.head, -1) + plan.open.length);
        }
        if (plan.kind === "wrap" && range.empty) {
          const seg = plan.segments[0];
          const atStart = seg !== undefined && range.head === seg.from;
          return EditorSelection.cursor(changes.mapPos(range.head, atStart ? 1 : -1));
        }
        let anchor = range.anchor;
        let head = range.head;
        if (plan.kind === "wrap") {
          // Select the text that was wrapped, not the whitespace trimmed off its ends.
          const first = plan.segments[0];
          const last = plan.segments[plan.segments.length - 1];
          if (first && last) {
            const forward = range.anchor <= range.head;
            anchor = forward ? first.from : last.to;
            head = forward ? last.to : first.from;
          }
        }
        return EditorSelection.range(
          changes.mapPos(anchor, anchor <= head ? 1 : -1),
          changes.mapPos(head, head < anchor ? 1 : -1),
        );
      }),
      state.selection.mainIndex,
    );
    return commit(target, { changes, selection });
  };
}

export const toggleBold = toggleInline({
  node: "StrongEmphasis",
  mark: "EmphasisMark",
  open: "**",
  close: "**",
});
export const toggleItalic = toggleInline({
  node: "Emphasis",
  mark: "EmphasisMark",
  open: "*",
  close: "*",
});
export const toggleStrikethrough = toggleInline({
  node: "Strikethrough",
  mark: "StrikethroughMark",
  open: "~~",
  close: "~~",
});
export const toggleInlineCode = toggleInline({
  node: "InlineCode",
  mark: "CodeMark",
  open: "`",
  close: "`",
});

/** The run of non-space characters around `pos`, for spotting a URL under the cursor. */
function tokenAt(state: EditorState, pos: number): Segment | null {
  const line = state.doc.lineAt(pos);
  let from = pos - line.from;
  let to = from;
  while (from > 0 && !/\s/.test(line.text.charAt(from - 1))) from--;
  while (to < line.text.length && !/\s/.test(line.text.charAt(to))) to++;
  return from < to ? { from: line.from + from, to: line.from + to } : null;
}

/**
 * Link: wraps the selection as `[text]()` with the cursor in the address, makes `[](url)` when
 * the selection is a URL, and removes the link when the cursor is already inside one.
 */
export const toggleLink: EditCommand = (target) => {
  const { state } = target;
  const tree = treeOf(state);
  const edits = new Map<string, ChangeSpec>();
  /** Where each resulting selection goes: a cursor `offset` after `start`, or the unwrapped range. */
  const results: (
    | { unwrap: true; anchor: number; head: number }
    | { unwrap: false; start: number; offset: number }
  )[] = [];

  for (const range of state.selection.ranges) {
    const link = enclosing(tree, "Link", range.from, range.to);
    const marks = link?.getChildren("LinkMark") ?? [];
    const open = marks[0];
    const close = marks[1];
    if (link && open && close) {
      edits.set(`l${open.from}`, { from: open.from, to: open.to });
      edits.set(`r${close.from}`, { from: close.from, to: link.to });
      results.push({ unwrap: true, anchor: range.anchor, head: range.head });
      continue;
    }
    let from = range.from;
    let to = range.to;
    if (range.empty) {
      const token = tokenAt(state, range.head);
      const word = state.wordAt(range.head);
      if (token && isUrl(state.sliceDoc(token.from, token.to))) ({ from, to } = token);
      else if (word) ({ from, to } = word);
    }
    const text = state.sliceDoc(from, to);
    if (from === to) {
      edits.set(`i${from}`, { from, insert: "[]()" });
      results.push({ unwrap: false, start: from, offset: 1 });
    } else if (isUrl(text.trim())) {
      edits.set(`u${from}`, { from, to, insert: `[](${linkDestination(text.trim())})` });
      results.push({ unwrap: false, start: from, offset: 1 });
    } else {
      edits.set(`a${from}`, { from, insert: "[" });
      edits.set(`b${to}`, { from: to, insert: "]()" });
      results.push({ unwrap: false, start: from, offset: to - from + 3 });
    }
  }
  if (edits.size === 0) return false;
  const changes = ChangeSet.of([...edits.values()], state.doc.length);
  const selection = EditorSelection.create(
    results.map((r) =>
      r.unwrap
        ? EditorSelection.range(changes.mapPos(r.anchor, 1), changes.mapPos(r.head, -1))
        : EditorSelection.cursor(changes.mapPos(r.start, -1) + r.offset),
    ),
    state.selection.mainIndex,
  );
  return commit(target, { changes, selection });
};
