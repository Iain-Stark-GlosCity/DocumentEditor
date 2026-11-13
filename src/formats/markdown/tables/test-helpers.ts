/**
 * Test helpers: build an editor from text with a `^` cursor (or `«selection»`), press keys and
 * show the result in the same notation.
 */
import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { tableExtensions } from "./index";

export interface Options {
  /** Use the Markdown parser (default true). False tests the text fallback. */
  parser?: boolean;
  autoFormat?: boolean;
}

export function makeView(marked: string, options: Options = {}): EditorView {
  let anchor: number;
  let head: number;
  let doc: string;
  const open = marked.indexOf("«");
  if (open !== -1) {
    const close = marked.indexOf("»");
    doc = marked.slice(0, open) + marked.slice(open + 1, close) + marked.slice(close + 1);
    anchor = open;
    head = close - 1;
  } else {
    anchor = head = marked.indexOf("^");
    if (anchor === -1) throw new Error("test document has no ^ cursor");
    doc = marked.slice(0, anchor) + marked.slice(anchor + 1);
  }
  const extensions: Extension[] = [history(), ...tableExtensions(() => options.autoFormat ?? true)];
  if (options.parser !== false) extensions.push(markdown({ base: markdownLanguage }));
  const state = EditorState.create({ doc, selection: { anchor, head }, extensions });
  return new EditorView({ state, parent: document.body });
}

/** The document with the selection marked, in the notation `makeView` accepts. */
export function show(view: EditorView): string {
  const text = view.state.doc.toString();
  const { from, to, empty } = view.state.selection.main;
  if (empty) return text.slice(0, from) + "^" + text.slice(from);
  return text.slice(0, from) + "«" + text.slice(from, to) + "»" + text.slice(to);
}

const KEYS: Record<string, KeyboardEventInit> = {
  Tab: { key: "Tab" },
  "Shift-Tab": { key: "Tab", shiftKey: true },
  Enter: { key: "Enter" },
  "Mod-Enter": { key: "Enter", ctrlKey: true },
  "Alt-ArrowUp": { key: "ArrowUp", altKey: true },
  "Alt-ArrowDown": { key: "ArrowDown", altKey: true },
  "Alt-ArrowLeft": { key: "ArrowLeft", altKey: true },
  "Alt-ArrowRight": { key: "ArrowRight", altKey: true },
  Escape: { key: "Escape" },
};

/** Presses a key; returns whether a handler took it. */
export function press(view: EditorView, name: keyof typeof KEYS | string): boolean {
  const init = KEYS[name];
  if (!init) throw new Error(`unknown key ${name}`);
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  return runScopeHandlers(view, event, "editor");
}

/** Marked document in, key pressed, marked document out. */
export function afterKey(
  marked: string,
  key: string,
  options: Options = {},
): { result: string; handled: boolean } {
  const view = makeView(marked, options);
  const handled = press(view, key);
  const result = show(view);
  view.destroy();
  return { result, handled };
}

/** Marked document in, function applied, marked document out. */
export function afterRun(
  marked: string,
  run: (view: EditorView) => boolean,
  options: Options = {},
): { result: string; handled: boolean } {
  const view = makeView(marked, options);
  const handled = run(view);
  const result = show(view);
  view.destroy();
  return { result, handled };
}
