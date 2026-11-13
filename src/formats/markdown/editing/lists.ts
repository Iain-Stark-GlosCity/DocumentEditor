/**
 * List behaviour beyond Enter and Backspace (which come from `@codemirror/lang-markdown`):
 * indenting and outdenting items, moving items, and keeping ordered numbering right.
 */
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type ChangeSpec,
  type Extension,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  commit,
  findAncestor,
  isBlank,
  parseLine,
  selectedLines,
  treeOf,
  type EditCommand,
  type SyntaxNode,
} from "./syntax";

function listItemAt(node: SyntaxNode): SyntaxNode | null {
  return findAncestor(node, ["ListItem"]);
}

/** Number written in the item's marker, or null if it is not an ordered item. */
function itemNumber(state: EditorState, item: SyntaxNode): number | null {
  const mark = item.getChild("ListMark");
  if (!mark) return null;
  const n = /^\d+/.exec(state.sliceDoc(mark.from, mark.to));
  return n ? Number(n[0]) : null;
}

/** Width of an item's marker and the spaces after it: how far its children are indented. */
function markerWidth(state: EditorState, item: SyntaxNode): number {
  const line = state.doc.lineAt(item.from);
  const p = parseLine(line.text);
  return Math.max(2, p.markerEnd - p.markerStart);
}

/** Column of an item's marker within its line (an item's own `from` can include indentation). */
function markerColumn(state: EditorState, item: SyntaxNode): number {
  const mark = item.getChild("ListMark");
  return (mark?.from ?? item.from) - state.doc.lineAt(item.from).from;
}

interface Context {
  /** The items to move, outermost only. */
  roots: SyntaxNode[];
}

/** The list items the selection touches, or null when a Table (or no list) is in the way. */
function itemsTouched(state: EditorState): Context | null {
  const tree = treeOf(state);
  const found = new Map<number, SyntaxNode>();
  for (const line of selectedLines(state)) {
    if (isBlank(line.text)) continue;
    const pos = line.from + parseLine(line.text).markerStart;
    const node = tree.resolveInner(pos, 1);
    if (findAncestor(node, ["Table"])) return null;
    const item = listItemAt(node);
    if (item) found.set(item.from, item);
  }
  const sorted = [...found.values()].sort((a, b) => a.from - b.from);
  const roots: SyntaxNode[] = [];
  for (const item of sorted) {
    const last = roots[roots.length - 1];
    if (!last || item.from >= last.to) roots.push(item);
  }
  return roots.length > 0 ? { roots } : null;
}

/** Indents or outdents whole items (with their children). Declines outside lists and in tables. */
function shiftItems(direction: 1 | -1): EditCommand {
  return (target) => {
    const { state } = target;
    const context = itemsTouched(state);
    if (!context) return false;
    const changes: ChangeSpec[] = [];

    for (const root of context.roots) {
      const first = state.doc.lineAt(root.from);
      const last = state.doc.lineAt(root.to);
      const rootParsed = parseLine(first.text);

      let amount: number;
      let newNumber: number | null = null;
      if (direction > 0) {
        const prev = root.prevSibling;
        amount = prev ? markerWidth(state, prev) : markerWidth(state, root);
        if (rootParsed.kind === "ordered" && prev) {
          const nested = prev.getChildren("OrderedList").pop();
          const lastItem = nested?.getChildren("ListItem").pop();
          const lastNumber = lastItem ? itemNumber(state, lastItem) : null;
          newNumber = lastNumber === null ? 1 : lastNumber + 1;
        }
      } else {
        const parentItem = root.parent?.parent;
        const column = markerColumn(state, root) - rootParsed.quoteEnd;
        if (parentItem && parentItem.name === "ListItem") {
          amount = markerColumn(state, root) - markerColumn(state, parentItem);
          const parentNumber = itemNumber(state, parentItem);
          if (rootParsed.kind === "ordered" && parentNumber !== null) newNumber = parentNumber + 1;
        } else {
          amount = Math.min(column, 4);
        }
        if (amount <= 0) continue;
      }

      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        if (isBlank(line.text)) continue;
        const p = parseLine(line.text);
        const wsStart = line.from + p.quoteEnd;
        const ws = /^[ \t]*/.exec(line.text.slice(p.quoteEnd))?.[0] ?? "";
        let newWs: string;
        if (direction > 0) newWs = ws + " ".repeat(amount);
        else {
          let remove = 0;
          let cut = 0;
          while (cut < ws.length && remove < amount) {
            remove += ws[cut] === "\t" ? 4 : 1;
            cut++;
          }
          newWs = ws.slice(cut);
        }
        if (n === first.number && newNumber !== null) {
          const numberEnd = line.from + p.markerStart + p.numberLength;
          changes.push({ from: wsStart, to: numberEnd, insert: newWs + String(newNumber) });
        } else if (newWs !== ws) {
          changes.push({ from: wsStart, to: wsStart + ws.length, insert: newWs });
        }
      }
    }
    if (changes.length === 0) return false;
    const cs = state.changes(changes);
    return commit(target, { changes: cs, selection: state.selection.map(cs, 1) });
  };
}

export const indentListItem = shiftItems(1);
export const outdentListItem = shiftItems(-1);

/** Moves the list item under the cursor past its sibling, keeping its children and numbering. */
function moveItem(direction: 1 | -1): EditCommand {
  const fallback = direction < 0 ? moveLineUp : moveLineDown;
  return (target) => {
    const { state } = target;
    if (state.selection.ranges.length !== 1) return fallback(target);
    const range = state.selection.main;
    const tree = treeOf(state);
    const line = state.doc.lineAt(range.from);
    // Probe the first character of the line: at the very end of the document a position
    // resolves to the Document node, not to the item.
    const probe = tree.resolveInner(line.from + parseLine(line.text).markerStart, 1);
    const item = isBlank(line.text) ? null : listItemAt(probe);
    if (!item || range.to > item.to || findAncestor(probe, ["Table"])) return fallback(target);
    const sibling = direction < 0 ? item.prevSibling : item.nextSibling;
    if (!sibling || sibling.name !== "ListItem") return true;

    const [a, b] = direction < 0 ? [sibling, item] : [item, sibling];
    const textA = state.sliceDoc(a.from, a.to);
    const textB = state.sliceDoc(b.from, b.to);
    const separator = state.sliceDoc(a.to, b.from);
    const insert = textB + separator + textA;
    const newStart = direction < 0 ? a.from : a.from + textB.length + separator.length;
    const delta = newStart - item.from;
    return commit(target, {
      changes: { from: a.from, to: b.to, insert },
      selection: EditorSelection.range(range.anchor + delta, range.head + delta),
      userEvent: "move.line",
    });
  };
}

export const moveListItemUp = moveItem(-1);
export const moveListItemDown = moveItem(1);

// Renumbering --------------------------------------------------------------------------------

function sequential(state: EditorState, list: SyntaxNode): boolean {
  const numbers = list.getChildren("ListItem").map((item) => itemNumber(state, item));
  const start = numbers[0];
  if (start === null || start === undefined) return false;
  return numbers.every((n, i) => n === start + i);
}

function orderedListsAround(
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
  into: Map<number, SyntaxNode>,
): void {
  for (const pos of from === to ? [from] : [from, to]) {
    for (const side of [-1, 1] as const) {
      for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
        if (n.name === "OrderedList") into.set(n.from, n);
      }
    }
  }
}

/**
 * Keeps ordered lists numbered after an edit that adds, removes or moves items. It only acts on
 * lists the edit touched, only when their numbers ran in sequence before the edit, and never on
 * undo or redo (history restores the exact text).
 */
export function listRenumbering(enabled: () => boolean): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !enabled()) return tr;
    if (!tr.annotation(Transaction.userEvent)) return tr;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;

    const oldLists = new Map<number, SyntaxNode>();
    const oldTree = syntaxTree(tr.startState);
    tr.changes.iterChangedRanges((fromA, toA) => orderedListsAround(oldTree, fromA, toA, oldLists));
    if (oldLists.size === 0) return tr;
    for (const list of oldLists.values()) if (!sequential(tr.startState, list)) return tr;

    const state = tr.state;
    // A list keeps the number it started with, even if its first item moved.
    const starts = new Map<number, number>();
    for (const list of oldLists.values()) {
      const first = list.getChild("ListItem");
      const n = first ? itemNumber(tr.startState, first) : null;
      if (n !== null) starts.set(tr.changes.mapPos(list.from, -1), n);
    }
    const newTree = syntaxTree(state);
    const newLists = new Map<number, SyntaxNode>();
    const edited: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_a, _b, fromB, toB) => {
      edited.push({ from: fromB, to: toB });
      orderedListsAround(newTree, fromB, toB, newLists);
    });
    const typing =
      tr.isUserEvent("input.type") ||
      tr.isUserEvent("delete.backward") ||
      tr.isUserEvent("delete.forward");

    const changes: ChangeSpec[] = [];
    for (const list of newLists.values()) {
      const items = list.getChildren("ListItem");
      const marks = items.map((item) => item.getChild("ListMark"));
      if (typing && marks.some((m) => m && edited.some((e) => e.from <= m.to && e.to >= m.from))) {
        continue; // the user is typing a number: leave it alone
      }
      const start = starts.get(list.from) ?? (items[0] ? itemNumber(state, items[0]) : null);
      if (start === null) continue;
      items.forEach((item, i) => {
        const mark = marks[i];
        const current = itemNumber(state, item);
        if (!mark || current === null || current === start + i) return;
        changes.push({ from: mark.from, to: mark.to - 1, insert: String(start + i) });
      });
    }
    if (changes.length === 0) return tr;
    return [tr, { changes, sequential: true }];
  });
}
