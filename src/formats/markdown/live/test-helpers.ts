/**
 * Test helpers for live preview: build the decorations for a document and selection, and
 * describe them as plain strings that tests can compare. Not part of the app.
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { buildDecorations, type Pass } from "./builder";
import { liveOptions, type LiveOptions } from "./types";

/** Marks a caret in test documents. Several give several carets; a pair `‸…‸` is NOT a range. */
export const CARET = "‸";

export interface LiveTestOptions {
  options?: Partial<LiveOptions>;
  extensions?: Extension;
  /** Explicit selection, instead of carets in the text. */
  selection?: EditorSelection;
}

/**
 * A state with the Markdown language, fully parsed, and carets from `‸` in `text`. With no
 * caret, two newlines are appended and the caret goes at the very end, touching nothing.
 */
export function liveState(text: string, test: LiveTestOptions = {}): EditorState {
  const parts = text.split(CARET);
  let doc = parts[0] ?? "";
  const carets: number[] = [];
  for (const part of parts.slice(1)) {
    carets.push(doc.length);
    doc += part;
  }
  if (carets.length === 0 && !test.selection) {
    doc += "\n\n";
    carets.push(doc.length);
  }
  const state = EditorState.create({
    doc,
    selection:
      test.selection ?? EditorSelection.create(carets.map((c) => EditorSelection.cursor(c))),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage }),
      liveOptions.of(test.options ?? {}),
      test.extensions ?? [],
    ],
  });
  return fullyParsed(state);
}

/** The state with its syntax tree parsed to the end (the parser normally stops early). */
export function fullyParsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 60_000);
  // The language field only picks up the extended tree on its next update.
  return state.update({}).state;
}

function widgetName(deco: Decoration): string | null {
  const widget = deco.spec.widget as object | undefined;
  return widget ? widget.constructor.name : null;
}

/** Normalised description of a DecorationSet: one string per decoration, in document order. */
export function describe(state: EditorState, set: DecorationSet): string[] {
  const out: string[] = [];
  const iter = set.iter();
  for (; iter.value; iter.next()) {
    const { from, to } = iter;
    const deco = iter.value;
    const spec = deco.spec as {
      class?: string;
      widget?: unknown;
      block?: boolean;
      attributes?: Record<string, string>;
    };
    const text = JSON.stringify(state.doc.sliceString(from, to));
    const widget = widgetName(deco);
    if (deco.point && from === to && !widget) {
      out.push(`line ${state.doc.lineAt(from).number} ${spec.class ?? ""}`);
    } else if (widget) {
      out.push(`${spec.block ? "block" : "widget"} ${widget} ${text}`);
    } else if (deco.point) {
      out.push(`hide ${text}`);
    } else {
      out.push(`mark ${spec.class ?? ""} ${text}`);
    }
  }
  return out;
}

/** Decorations of one pass over the whole document (or `range`), described. */
export function decorations(
  state: EditorState,
  pass: Pass = "inline",
  range: { from: number; to: number } = { from: 0, to: state.doc.length },
): string[] {
  return describe(state, buildDecorations(state, pass, range));
}

/** Only the `hide` and widget entries: what the reader no longer sees as source. */
export function hidden(state: EditorState, pass: Pass = "inline"): string[] {
  return decorations(state, pass).filter((d) => /^(hide|widget|block)/.test(d));
}
