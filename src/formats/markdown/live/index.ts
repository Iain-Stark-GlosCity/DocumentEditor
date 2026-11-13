/**
 * Live preview: the Markdown source rendered in place. Syntax markers are hidden and formatting
 * is shown where the selection is not; the raw Markdown is revealed where it is. The document
 * text is never changed by this mode: everything here is CodeMirror decorations.
 *
 * Two passes share one tree walk (`builder.ts`) and one set of renderers (`renderers/`):
 *
 * - The inline pass is a view plugin over the visible ranges. It rebuilds on edits, scrolling,
 *   selection changes and when the incremental parser extends the tree. While an IME is
 *   composing, it only maps its decorations through the edit, so the composition is never
 *   disturbed, and rebuilds once the composition ends.
 * - The block pass is a state field (CodeMirror only accepts block widgets from state) over a
 *   window around the viewport. The view plugin moves the window when the viewport leaves it.
 */
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { buildDecorations } from "./builder";
import { ctrlClickLinks, openLinkAtCursor } from "./links";
import type { EditorContext, FormatCommand } from "../../../core/format";
import { liveOptions } from "./types";

export { liveOptions, liveRenderers } from "./types";
export type { LiveBuilder, LiveOptions, LiveRenderer } from "./types";
export { followLink, linkAt, openLinkAtCursor } from "./links";
export { toggleTaskAt } from "./widgets";

/** Extra text on each side of the viewport that the block pass covers. */
const WINDOW_MARGIN = 20_000;
/** Block-pass window before the view has reported a viewport. */
const INITIAL_WINDOW = 40_000;

interface Window {
  from: number;
  to: number;
}

const setWindow = StateEffect.define<Window>();

interface BlockState {
  window: Window;
  decorations: DecorationSet;
}

function blockDecorations(state: EditorState, window: Window): DecorationSet {
  return buildDecorations(state, "block", window);
}

export const blockField = StateField.define<BlockState>({
  create(state) {
    const window = { from: 0, to: Math.min(state.doc.length, INITIAL_WINDOW) };
    return { window, decorations: blockDecorations(state, window) };
  },
  update(value, tr) {
    let window = value.window;
    let changed = false;
    if (tr.docChanged) {
      window = { from: tr.changes.mapPos(window.from, -1), to: tr.changes.mapPos(window.to, 1) };
      changed = true;
    }
    for (const effect of tr.effects) {
      if (effect.is(setWindow)) {
        window = effect.value;
        changed = true;
      }
    }
    if (
      changed ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.startState.facet(liveOptions) !== tr.state.facet(liveOptions)
    ) {
      return { window, decorations: blockDecorations(tr.state, window) };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** The line under an active IME composition, which is never hidden or replaced. */
function composingLine(view: EditorView): { from: number; to: number } | null {
  if (!view.composing) return null;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return { from: line.from, to: line.to };
}

/**
 * One span covering the visible ranges. They differ from the viewport only where content is
 * folded or hidden, which this editor does not do, so a single span is simplest and correct.
 */
function visibleSpan(view: EditorView): { from: number; to: number } {
  const ranges = view.visibleRanges;
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  return first && last ? { from: first.from, to: last.to } : view.viewport;
}

export function buildInline(view: EditorView): DecorationSet {
  return buildDecorations(view.state, "inline", {
    ...visibleSpan(view),
    protect: composingLine(view),
  });
}

class LivePlugin {
  decorations: DecorationSet;
  /** Set while decorations were only mapped (during composition) and need a rebuild. */
  private stale = false;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.decorations = buildInline(view);
    this.followViewport();
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
    if (update.view.composing) {
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.stale = true;
        return;
      }
      if (update.viewportChanged) this.decorations = buildInline(update.view);
      this.stale = true;
    } else if (
      this.stale ||
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      treeChanged ||
      update.startState.facet(liveOptions) !== update.state.facet(liveOptions)
    ) {
      this.stale = false;
      this.decorations = buildInline(update.view);
    }
    if (update.viewportChanged || update.docChanged) this.followViewport();
  }

  /** Called when an IME composition ends, so the line gets its decorations back. */
  compositionEnded(): void {
    if (!this.stale || this.destroyed) return;
    setTimeout(() => {
      if (this.stale && !this.destroyed && !this.view.composing) this.view.dispatch({});
    }, 0);
  }

  /** Moves the block pass window when the viewport is no longer inside it. */
  private followViewport(): void {
    const { from, to } = this.view.viewport;
    const window = this.view.state.field(blockField, false)?.window;
    if (!window || (from >= window.from && to <= window.to)) return;
    const next = {
      from: Math.max(0, from - WINDOW_MARGIN),
      to: Math.min(this.view.state.doc.length, to + WINDOW_MARGIN),
    };
    // Updates cannot dispatch; do it as soon as this one has finished.
    queueMicrotask(() => {
      if (this.destroyed) return;
      const current = this.view.state.field(blockField, false)?.window;
      const vp = this.view.viewport;
      if (current && vp.from >= current.from && vp.to <= current.to) return;
      this.view.dispatch({ effects: setWindow.of(next) });
    });
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export const inlinePlugin = ViewPlugin.fromClass(LivePlugin, {
  decorations: (plugin) => plugin.decorations,
  eventHandlers: {
    compositionend() {
      this.compositionEnded();
    },
  },
});

/** Classes on the editor so the stylesheet can scope live-only rules. */
const liveClass = EditorView.editorAttributes.of({ class: "cm-live" });

/**
 * The extensions for live preview. The host's callbacks (link opening, image URLs, the remote
 * image setting) are given separately with `liveOptions.of(...)`, in every mode, so that the
 * "open link" command works in source mode too.
 */
export function liveExtensions(): Extension[] {
  return [blockField, inlinePlugin, ctrlClickLinks, liveClass];
}

/**
 * What the Markdown provider adds to its editor for `context`: the host callbacks in every mode,
 * and the live preview machinery in live mode.
 */
export function markdownViewExtensions(context: EditorContext): Extension[] {
  return [
    liveOptions.of({
      openLink: context.openLink,
      resolveAsset: context.resolveAsset,
      loadRemoteImages: () => context.setting("preview.loadRemoteImages", true),
    }),
    context.mode === "live" ? liveExtensions() : [],
  ];
}

/** Provider commands that belong to links and live preview. */
export const liveCommands: readonly FormatCommand[] = [
  {
    id: "markdown.openLink",
    title: "Open link at cursor",
    defaultKey: "Alt-Enter",
    run: openLinkAtCursor,
  },
];
