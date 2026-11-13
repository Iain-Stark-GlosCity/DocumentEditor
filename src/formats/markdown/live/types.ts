/**
 * The extension point of live preview.
 *
 * Live preview walks the Lezer Markdown tree and hands each node to the renderers registered for
 * its type. A renderer only describes decorations through a `LiveBuilder`; it never touches the
 * document (the text is never changed by this mode, CLAUDE.md rule 1).
 *
 * There are two passes, because CodeMirror requires decorations that change the vertical layout
 * (block widgets, replacements of whole lines) to come from a state field rather than a plugin:
 *
 * - `decorate` runs in the inline pass (a view plugin), over the visible part of the document
 *   only, on every edit, scroll and selection change. Marks, hidden markers, inline widgets and
 *   line classes belong here.
 * - `decorateBlock` runs in the block pass (a state field), over a window around the viewport.
 *   Block widgets (images) belong here. Keep it cheap.
 *
 * To add a renderer (tables, maths, footnotes...), provide it through the `liveRenderers` facet
 * from the format's editor extensions. Renderers provided that way run before the built-in
 * ones, so a renderer returning `false` for a node takes it over completely.
 */
import { Facet, type EditorState } from "@codemirror/state";
import type { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export interface LiveOptions {
  /** Opens a link target that is not an in-document anchor (external URL or file). */
  openLink?(href: string): void;
  /** URL the webview can load for an image path relative to the document; "" if none. */
  resolveAsset?(relativePath: string): string;
  /** `preview.loadRemoteImages`. Read when images are drawn. */
  loadRemoteImages(): boolean;
}

export interface LiveBuilder {
  readonly state: EditorState;
  readonly options: LiveOptions;
  /** The range being decorated. Renderers should not emit decorations far outside it. */
  readonly from: number;
  readonly to: number;

  /** Inline reveal rule: some selection range touches `[from, to]`, edges included. */
  touches(from: number, to: number): boolean;
  /** Block reveal rule: some selection range is on a line that `[from, to]` spans. */
  linesTouched(from: number, to: number): boolean;

  /** Hides `[from, to)` with an empty replacement (ignored on the line being composed). */
  hide(from: number, to: number): void;
  /** Replaces `[from, to)` with an inline widget (ignored on the line being composed). */
  replace(from: number, to: number, widget: WidgetType): void;
  /** Adds a mark (a class, optionally attributes) over `[from, to)`. */
  mark(from: number, to: number, className: string, attributes?: Record<string, string>): void;
  /** Adds a class to the line that contains `pos`. */
  lineClass(pos: number, className: string): void;
  /** Adds a class to every line from `from` to `to`, clipped to the range being decorated. */
  linesClass(from: number, to: number, className: string): void;
  /** Adds one to a named counter of the line containing `pos` (for nesting depth). */
  lineCount(pos: number, name: string): void;
  /** Any other decoration (block pass: block widgets and block replacements). */
  add(from: number, to: number, decoration: Decoration): void;
}

export interface LiveRenderer {
  /** For debugging and tests. */
  readonly id: string;
  /** Lezer node names handled, for example `Emphasis`. */
  readonly nodes: readonly string[];
  /** Inline pass. Return `false` to skip the node's children and any later renderer. */
  decorate?(node: SyntaxNode, out: LiveBuilder): boolean | void;
  /** Block pass. Return `false` to skip the node's children and any later renderer. */
  decorateBlock?(node: SyntaxNode, out: LiveBuilder): boolean | void;
}

/** Extra renderers, run before the built-in ones. */
export const liveRenderers = Facet.define<LiveRenderer>();

const defaultOptions: LiveOptions = { loadRemoteImages: () => true };

/** Callbacks from the host (the workbench) for links and images. */
export const liveOptions = Facet.define<Partial<LiveOptions>, LiveOptions>({
  combine: (values) => Object.assign({}, defaultOptions, ...values) as LiveOptions,
});
