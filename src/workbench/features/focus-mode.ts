/**
 * Typewriter, focus and zen modes: editor extensions driven by settings, plus a session-only
 * zen flag that also hides the chrome (see `App.tsx` and `SidePanes.tsx`).
 */
import { EditorState, type Extension, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";
import { isZenMode, setZenMode } from "../zen";

/** Line width, in characters, that zen mode uses when no maximum is set. */
export const ZEN_LINE_WIDTH = 80;

const isBlank = (doc: Text, n: number) => /^\s*$/.test(doc.line(n).text);

/**
 * First and last line (1-based) of the paragraph around `line`: the run of non-blank lines, or
 * the blank line itself. The scan stops at `min` and `max`, so its cost is bounded by the
 * lines in view however long the paragraph is.
 */
export function paragraphLines(
  doc: Text,
  line: number,
  min = 1,
  max = doc.lines,
): { first: number; last: number } {
  if (isBlank(doc, line)) return { first: line, last: line };
  let first = line;
  while (first > min && !isBlank(doc, first - 1)) first--;
  let last = line;
  while (last < max && !isBlank(doc, last + 1)) last++;
  return { first, last };
}

/** Lines between `firstLine` and `lastLine` (inclusive) that focus mode dims. */
export function dimmedLines(
  doc: Text,
  head: number,
  firstLine: number,
  lastLine: number,
): number[] {
  const current = doc.lineAt(head).number;
  const { first, last } = paragraphLines(doc, current, firstLine, lastLine);
  const out: number[] = [];
  for (let n = firstLine; n <= lastLine; n++) if (n < first || n > last) out.push(n);
  return out;
}

const dim = Decoration.line({ class: "cm-focus-dim" });

function dimDecorations(view: EditorView): DecorationSet {
  const { state, viewport } = view;
  const firstLine = state.doc.lineAt(viewport.from).number;
  const lastLine = state.doc.lineAt(viewport.to).number;
  const ranges = dimmedLines(state.doc, state.selection.main.head, firstLine, lastLine).map((n) =>
    dim.range(state.doc.line(n).from),
  );
  return Decoration.set(ranges);
}

/** Dims every line outside the current paragraph, for the visible part of the document only. */
export function focusExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = dimDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = dimDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Keeps the cursor line vertically centred as the selection or text changes. Pointer
 * selections are left alone, so mouse scrolling and drag-selecting do not fight it. Padding
 * below the text lets the last lines reach the middle.
 */
export function typewriterExtension(): Extension {
  return [
    EditorState.transactionExtender.of((tr) => {
      if (!tr.docChanged && !tr.selection) return null;
      if (tr.isUserEvent("select.pointer")) return null;
      return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) };
    }),
    ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          this.measure();
        }
        update(update: ViewUpdate) {
          if (update.geometryChanged) this.measure();
        }
        measure() {
          this.view.requestMeasure({
            read: (view) => view.scrollDOM.clientHeight,
            write: (height, view) => {
              view.contentDOM.style.paddingBottom = `${Math.floor(height / 2)}px`;
            },
          });
        }
        destroy() {
          this.view.contentDOM.style.paddingBottom = "";
        }
      },
    ),
  ];
}

/** Centres the text column at a maximum width, in characters. */
export function lineWidthExtension(characters: number): Extension {
  return EditorView.theme({
    ".cm-content": { maxWidth: `${characters}ch`, marginInline: "auto" },
  });
}

function toggleSetting(wb: Workbench, key: "editor.typewriterMode" | "editor.focusMode"): void {
  wb.settings.set(key, !wb.settings.get(key));
}

function setZen(wb: Workbench, zen: boolean): void {
  if (isZenMode(wb) === zen) return;
  setZenMode(wb, zen);
  wb.reconfigureEditors("focus-mode");
  wb.focusEditor();
}

export const focusMode: Feature = {
  id: "focus-mode",
  reconfigureOn: ["editor.typewriterMode", "editor.focusMode", "editor.maxLineWidth"],

  editorExtensions: (_doc, wb) => {
    const extensions: Extension[] = [];
    if (wb.settings.get("editor.typewriterMode")) extensions.push(typewriterExtension());
    if (wb.settings.get("editor.focusMode")) extensions.push(focusExtension());
    const configured = wb.settings.get("editor.maxLineWidth");
    const width = isZenMode(wb) ? configured || ZEN_LINE_WIDTH : configured;
    if (width > 0) extensions.push(lineWidthExtension(width));
    return extensions;
  },

  commands: (wb) => [
    {
      id: "view.toggleTypewriterMode",
      title: "Toggle typewriter mode",
      run: () => toggleSetting(wb, "editor.typewriterMode"),
    },
    {
      id: "view.toggleFocusMode",
      title: "Toggle focus mode",
      run: () => toggleSetting(wb, "editor.focusMode"),
    },
    {
      id: "view.toggleZenMode",
      title: "Toggle zen mode",
      defaultKey: "Mod-Alt-z",
      run: () => setZen(wb, !isZenMode(wb)),
    },
    {
      id: "view.exitZenMode",
      title: "Exit zen mode",
      enabled: () => isZenMode(wb),
      run: () => setZen(wb, false),
    },
  ],

  menuItems: [
    { menu: "view", group: "5_focus", command: "view.toggleTypewriterMode", order: 1 },
    { menu: "view", group: "5_focus", command: "view.toggleFocusMode", order: 2 },
    { menu: "view", group: "5_focus", command: "view.toggleZenMode", order: 3 },
  ],

  activate(wb) {
    // Escape leaves zen mode, but only if nothing nearer has used it: a find panel, the
    // palette and dialogs handle (and consume) their own Escape first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !isZenMode(wb)) return;
      const ui = wb.ui.getState();
      if (ui.dialogs.length > 0 || ui.paletteOpen) return;
      event.preventDefault();
      void wb.runCommand("view.exitZenMode");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      setZenMode(wb, false);
    };
  },
};
