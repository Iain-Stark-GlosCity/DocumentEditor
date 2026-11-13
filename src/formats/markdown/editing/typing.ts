/**
 * Smart typing: auto-pairing and wrapping, pasting a URL over a selection, opening a code
 * fence with Enter, and Enter/Backspace that continue or remove list and quote markup (the
 * last two reuse `@codemirror/lang-markdown`).
 */
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
} from "@codemirror/lang-markdown";
import { Annotation, EditorSelection, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  commit,
  findAncestor,
  inCode,
  isUrl,
  linkDestination,
  treeOf,
  type EditCommand,
} from "./syntax";

type IsOn = (key: string) => boolean;

/** Characters that may be typed over a selection to wrap it, and what closes them. */
const WRAPPERS: Readonly<Record<string, string>> = {
  "*": "*",
  _: "_",
  "`": "`",
  "~": "~",
  "[": "]",
  "(": ")",
  '"': '"',
};

/** Characters that pair themselves when typed with nothing selected. */
const PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]", '"': '"', "`": "`" };
const CLOSERS = new Set(Object.values(PAIRS));

/** Positions of closing characters this extension inserted, so typing them again steps over. */
const autoClosed = Annotation.define<true>();
const closers = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = next.map((pos) => tr.changes.mapPos(pos, 1)).filter((p) => p <= tr.newDoc.length);
    }
    if (tr.annotation(autoClosed)) {
      next = [...next, ...tr.state.selection.ranges.filter((r) => r.empty).map((r) => r.head)];
    }
    // Moving the cursor elsewhere forgets older pairs; keep the list short.
    return next.length > 50 ? next.slice(-50) : next;
  },
});

const AFTER_OPEN = /^(?:$|[\s)\]}>,.;:!?"'`])/;

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/** Handles one typed character. Returns false to let the editor insert it normally. */
function typeCharacter(view: EditorView, text: string): boolean {
  const { state } = view;
  if (text.length !== 1) return false;
  const anySelected = state.selection.ranges.some((r) => !r.empty);
  const wraps = text in WRAPPERS;
  const pairs = text in PAIRS;
  if (!anySelected && !pairs && !CLOSERS.has(text)) return false;
  if (anySelected && !wraps) return false;

  const tree = treeOf(state);
  const tracked = state.field(closers, false) ?? [];
  let handled = false;
  let paired = false;

  const spec = state.changeByRange((range) => {
    const { doc } = state;
    if (!range.empty) {
      if (!wraps || inCode(state, range.from, tree)) return { range };
      handled = true;
      const close = WRAPPERS[text] ?? text;
      return {
        changes: [
          { from: range.from, insert: text },
          { from: range.to, insert: close },
        ],
        range: EditorSelection.range(range.from + 1, range.to + 1),
      };
    }
    const pos = range.head;
    const next = doc.sliceString(pos, pos + 1);
    const prev = pos > 0 ? doc.sliceString(pos - 1, pos) : "";
    if (CLOSERS.has(text) && next === text && tracked.includes(pos)) {
      handled = true;
      return { range: EditorSelection.cursor(pos + 1) };
    }
    if (!pairs || inCode(state, pos, tree)) return { range };
    if (!AFTER_OPEN.test(next) || prev === "\\") return { range };
    if ((text === '"' || text === "`") && (isWordChar(prev) || prev === text)) return { range };
    handled = true;
    paired = true;
    const close = PAIRS[text] ?? text;
    return {
      changes: { from: pos, insert: text + close },
      range: EditorSelection.cursor(pos + 1),
    };
  });
  if (!handled) return false;
  view.dispatch(
    state.update(spec, {
      userEvent: "input.type",
      scrollIntoView: true,
      annotations: paired ? autoClosed.of(true) : [],
    }),
  );
  return true;
}

/** Backspace between an empty pair such as `()` or `""` removes both characters. */
export const deleteEmptyPair: EditCommand = (target) => {
  const { state } = target;
  if (state.selection.ranges.some((r) => !r.empty)) return false;
  const pairOf = (pos: number): boolean => {
    if (pos === 0) return false;
    const open = state.sliceDoc(pos - 1, pos);
    return PAIRS[open] === state.sliceDoc(pos, pos + 1) && open in PAIRS;
  };
  if (!state.selection.ranges.every((r) => pairOf(r.head))) return false;
  target.dispatch(
    state.update({
      changes: state.selection.ranges.map((r) => ({ from: r.head - 1, to: r.head + 1 })),
      userEvent: "delete.backward",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** Backspace over auto-paired characters, then list and quote markup. */
export function backspace(isOn: IsOn): EditCommand {
  return (target) => {
    if (isOn("markdown.autoPair") && deleteEmptyPair(target)) return true;
    if (isOn("markdown.continueMarkup") && deleteMarkupBackward(target)) return true;
    return false;
  };
}

const OPENING_FENCE = /^([ \t]{0,3})(`{3,}[^`]*|~{3,}.*)$/;

/** Enter at the end of a lone opening fence adds the closing fence and puts the cursor between. */
export const closeFenceOnEnter: EditCommand = (target) => {
  const { state } = target;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return false;
  const match = OPENING_FENCE.exec(line.text);
  if (!match) return false;
  const indent = match[1] ?? "";
  const marks = /^(`{3,}|~{3,})/.exec(match[2] ?? "")?.[1];
  if (!marks) return false;
  const node = findAncestor(treeOf(state).resolveInner(line.from + indent.length, 1), [
    "FencedCode",
  ]);
  // Only an opening fence that nothing closes yet: one delimiter mark and nothing after it.
  if (
    node &&
    (node.from !== line.from + indent.length || node.getChildren("CodeMark").length > 1)
  ) {
    return false;
  }
  const insert = `\n${indent}\n${indent}${marks}`;
  return commit(target, {
    changes: { from: range.head, insert },
    selection: EditorSelection.cursor(range.head + 1 + indent.length),
    userEvent: "input",
  });
};

/**
 * lang-markdown's Enter, with one change: on the empty second item of a two-item list its
 * default turns the list "loose" (inserts a blank line) instead of ending it. Ending the list
 * is what people expect, so `nonTightLists: false` is passed.
 */
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

export function enter(isOn: IsOn): EditCommand {
  return (target) => {
    if (isOn("markdown.autoFence") && closeFenceOnEnter(target)) return true;
    if (isOn("markdown.continueMarkup") && continueMarkup(target)) return true;
    return false;
  };
}

/** Pasting a URL over selected text makes `[selection](url)`. */
export function pasteUrl(view: EditorView, text: string): boolean {
  const url = text.trim();
  const { state } = view;
  if (!isUrl(url)) return false;
  const tree = treeOf(state);
  const wrappable = state.selection.ranges.filter(
    (r) => !r.empty && !/\n/.test(state.sliceDoc(r.from, r.to)) && !inCode(state, r.from, tree),
  );
  if (wrappable.length === 0) return false;
  const destination = linkDestination(url);
  const spec = state.changeByRange((range) => {
    if (!wrappable.includes(range)) {
      const insert = state.toText(url).toString();
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    }
    const label = state.sliceDoc(range.from, range.to);
    const insert = `[${label}](${destination})`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  view.dispatch(state.update(spec, { userEvent: "input.paste", scrollIntoView: true }));
  return true;
}

/** The extensions for typing: input handler, paste handler and the closer tracking field. */
export function typingExtensions(isOn: IsOn): Extension {
  return [
    closers,
    EditorView.inputHandler.of((view, _from, _to, text) => {
      if (!isOn("markdown.autoPair") || view.composing || view.compositionStarted) return false;
      return typeCharacter(view, text);
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        if (!isOn("markdown.pasteUrlAsLink")) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !pasteUrl(view, text)) return false;
        event.preventDefault();
        return true;
      },
    }),
  ];
}
