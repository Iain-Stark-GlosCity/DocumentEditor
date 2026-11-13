/**
 * Test helpers: a document-with-selection notation and a tiny harness that runs a command
 * against an `EditorState` without a DOM.
 *
 * Notation: `|text|` is a selected range, `^` is a cursor (`\|` and `\^` are the literal characters). Several of either make a
 * multiple selection. The first marker is the main selection.
 *
 *     foo |bar| baz     one range
 *     foo^ bar          one cursor
 *     |a| ^ |b|         three selections
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditing, type EditingSettings } from "./index";
import type { EditCommand, Target } from "./syntax";

export interface Parsed {
  doc: string;
  ranges: { anchor: number; head: number }[];
}

export function parseNotation(text: string): Parsed {
  let doc = "";
  const ranges: Parsed["ranges"] = [];
  let open: number | null = null;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    if (ch === "\\" && (chars[i + 1] === "|" || chars[i + 1] === "^")) {
      doc += chars[++i];
    } else if (ch === "|") {
      if (open === null) open = doc.length;
      else {
        ranges.push({ anchor: open, head: doc.length });
        open = null;
      }
    } else if (ch === "^") {
      ranges.push({ anchor: doc.length, head: doc.length });
    } else doc += ch;
  }
  if (open !== null) throw new Error(`Unclosed | in ${JSON.stringify(text)}`);
  return { doc, ranges };
}

export function toNotation(state: EditorState): string {
  const marks: { pos: number; text: string; order: number }[] = [];
  for (const r of state.selection.ranges) {
    if (r.empty) marks.push({ pos: r.from, text: "^", order: 0 });
    else {
      marks.push({ pos: r.from, text: "|", order: 0 });
      marks.push({ pos: r.to, text: "|", order: 1 });
    }
  }
  marks.sort((a, b) => a.pos - b.pos || a.order - b.order);
  const doc = state.doc.toString();
  let out = "";
  let last = 0;
  for (const m of marks) {
    out += doc.slice(last, m.pos) + m.text;
    last = m.pos;
  }
  return out + doc.slice(last);
}

export type Settings = Partial<Record<string, boolean>>;

export function makeState(
  notation: string,
  settings: Settings = {},
  extra: Extension[] = [],
): EditorState {
  const { doc, ranges } = parseNotation(notation);
  const setting: EditingSettings = (key, fallback) => (settings[key] ?? fallback) as never;
  return EditorState.create({
    doc,
    selection: ranges.length
      ? EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head)))
      : EditorSelection.cursor(0),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage, addKeymap: false, pasteURLAsLink: false }),
      markdownEditing(setting),
      ...extra,
    ],
  });
}

/** A target that records the state after each dispatch, and keeps every state for undo checks. */
export class Harness implements Target {
  state: EditorState;
  readonly transactions: Transaction[] = [];

  constructor(state: EditorState) {
    this.state = state;
  }

  // An arrow property: CodeMirror's own commands call `dispatch` detached from the target.
  readonly dispatch = (tr: Transaction): void => {
    this.transactions.push(tr);
    this.state = tr.state;
  };

  get notation(): string {
    return toNotation(this.state);
  }
}

/** Runs a command on a document in notation and returns the resulting notation (or the input if it declined). */
export function run(
  command: EditCommand,
  input: string,
  settings: Settings = {},
): { out: string; handled: boolean; harness: Harness } {
  const harness = new Harness(makeState(input, settings));
  const handled = command(harness);
  return { out: harness.notation, handled, harness };
}

/** `[command, input, expected]` rows for `it.each`. */
export type Row = readonly [name: string, input: string, expected: string];

/** Reads settings the way the editing extension does: unknown keys are on. */
export function isOnFor(settings: Settings): (key: string) => boolean {
  return (key) => settings[key] ?? true;
}

/** A real EditorView (jsdom) for input handlers and DOM event handlers. */
export function makeView(notation: string, settings: Settings = {}): EditorView {
  return new EditorView({ state: makeState(notation, settings), parent: document.body });
}

/**
 * Types one character the way CodeMirror does: input handlers first, then the plain insertion.
 * Returns whether an input handler took it.
 */
export function typeChar(view: EditorView, text: string): boolean {
  const { from, to } = view.state.selection.main;
  const insert = () =>
    view.state.update(view.state.replaceSelection(text), { userEvent: "input.type" });
  for (const handler of view.state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, text, insert)) return true;
  }
  view.dispatch(insert());
  return false;
}

export function viewNotation(view: EditorView): string {
  return toNotation(view.state);
}
