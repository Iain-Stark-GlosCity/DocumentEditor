/**
 * Shared helpers for the Markdown editing commands: syntax-tree access, line parsing and the
 * small plumbing for applying a change as one undoable transaction.
 *
 * Everything here works on the buffer (which always uses `\n`) and never on decorations, so it
 * behaves the same in source and live modes.
 */
import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Line, Transaction, TransactionSpec } from "@codemirror/state";

export type Tree = ReturnType<typeof syntaxTree>;
export type SyntaxNode = ReturnType<Tree["resolveInner"]>;

/** The part of an EditorView that commands need. Lets tests run them without a DOM. */
export interface Target {
  readonly state: EditorState;
  dispatch(transaction: Transaction): void;
}

export type EditCommand = (target: Target) => boolean;

/** The syntax tree, parsed far enough to cover the whole document where that is cheap. */
export function treeOf(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

export function findAncestor(node: SyntaxNode | null, names: readonly string[]): SyntaxNode | null {
  for (let n = node; n; n = n.parent) if (names.includes(n.name)) return n;
  return null;
}

const CODE_BLOCKS = ["FencedCode", "CodeBlock"];

/** Is `pos` inside a code block or strictly inside inline code? */
export function inCode(state: EditorState, pos: number, tree: Tree = treeOf(state)): boolean {
  for (const side of [-1, 1] as const) {
    const block = findAncestor(tree.resolveInner(pos, side), CODE_BLOCKS);
    if (block && block.from < pos && pos <= block.to) return true;
  }
  const inline = findAncestor(tree.resolveInner(pos, 1), ["InlineCode"]);
  return !!inline && inline.from < pos && pos < inline.to;
}

/** Applies a transaction as its own undo step. */
export function commit(target: Target, spec: TransactionSpec): true {
  target.dispatch(
    target.state.update({
      scrollIntoView: true,
      userEvent: "input.format",
      annotations: isolateHistory.of("full"),
      ...spec,
    }),
  );
  return true;
}

/** Lines touched by the selection, once each. A range ending at the start of a line excludes it. */
export function selectedLines(state: EditorState): Line[] {
  const { doc } = state;
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from);
    let last = doc.lineAt(range.to);
    if (!range.empty && range.to === last.from && last.number > first.number) {
      last = doc.line(last.number - 1);
    }
    for (let n = first.number; n <= last.number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(doc.line(n));
    }
  }
  return lines.sort((a, b) => a.number - b.number);
}

export function isBlank(text: string): boolean {
  return !/\S/.test(text);
}

const HORIZONTAL_RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)+/;
const LIST_MARKER = /^([ \t]*)(?:([-+*])|(\d{1,9})([.)]))([ \t]+|$)(\[([ xX])\](?:[ \t]+|$))?/;

export type LineKind = "none" | "bullet" | "ordered" | "task";

/** The block markers at the start of a line: blockquote levels, then one list marker. */
export interface ParsedLine {
  kind: LineKind;
  /** Index after any blockquote markers. */
  quoteEnd: number;
  /** Index of the list marker (or of the first character, for `none`). */
  markerStart: number;
  /** Index after the marker and the spaces following it, before any checkbox. */
  markerEnd: number;
  /** Index where the item's text starts, after any checkbox. */
  contentStart: number;
  bullet: string;
  number: number;
  /** Length of the digits of an ordered marker. */
  numberLength: number;
  delimiter: string;
  checked: boolean;
  /** Index of the `[` of a checkbox, or -1. */
  boxStart: number;
}

export function parseLine(text: string): ParsedLine {
  const quote = QUOTE_PREFIX.exec(text);
  const quoteEnd = quote ? quote[0].length : 0;
  const rest = text.slice(quoteEnd);
  const result: ParsedLine = {
    kind: "none",
    quoteEnd,
    markerStart: quoteEnd,
    markerEnd: quoteEnd,
    contentStart: quoteEnd,
    bullet: "",
    number: 0,
    numberLength: 0,
    delimiter: "",
    checked: false,
    boxStart: -1,
  };
  const match = HORIZONTAL_RULE.test(rest) ? null : LIST_MARKER.exec(rest);
  if (!match) {
    const indent = /^[ \t]*/.exec(rest)?.[0].length ?? 0;
    result.markerStart = result.markerEnd = result.contentStart = quoteEnd + indent;
    return result;
  }
  const [whole, indent = "", bullet, digits, delimiter, , box, mark] = match;
  result.markerStart = quoteEnd + indent.length;
  result.markerEnd = quoteEnd + whole.length - (box?.length ?? 0);
  result.contentStart = quoteEnd + whole.length;
  if (digits !== undefined) {
    result.kind = "ordered";
    result.number = Number(digits);
    result.numberLength = digits.length;
    result.delimiter = delimiter ?? ".";
  } else {
    result.kind = box ? "task" : "bullet";
    result.bullet = bullet ?? "-";
  }
  if (box) {
    result.boxStart = result.markerEnd;
    result.checked = mark !== " ";
  }
  return result;
}

const URL_PATTERN = /^(?:https?:\/\/|ftp:\/\/|mailto:|www\.)\S+$/i;

/** A single token that looks like a web or mail address. */
export function isUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

/** A destination safe to put between `(` and `)`: angle brackets if parentheses are unbalanced. */
export function linkDestination(url: string): string {
  let depth = 0;
  for (const ch of url) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return `<${url}>`;
  }
  return depth === 0 ? url : `<${url}>`;
}
