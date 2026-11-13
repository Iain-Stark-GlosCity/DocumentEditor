/**
 * Keeps the editor and the preview scrolled to the same place, in both directions. The maths is
 * in `scrollMap.ts`; this file measures the two panes and applies the result.
 */
import type { EditorView } from "@codemirror/view";
import type { Workbench } from "../workbench";
import {
  buildScrollMap,
  lineToOffset,
  offsetToLine,
  type Anchor,
  type ScrollMap,
} from "./scrollMap";
import { SyncGate } from "./syncGate";

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Within a pixel of the end counts as the end, so rounding never leaves the last line out of view. */
const atEnd = (el: HTMLElement) =>
  el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
const maxScroll = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);

export class PreviewScrollSync {
  private map: ScrollMap | null = null;
  private view: EditorView | null = null;
  private readonly gate = new SyncGate();

  constructor(
    private readonly workbench: Workbench,
    /** The element that scrolls. */
    private readonly scroller: HTMLElement,
    /** The rendered blocks, inside `scroller`. */
    private readonly content: HTMLElement,
    private readonly enabled: () => boolean,
  ) {}

  /** Starts listening. Returns a function that stops. */
  start(): () => void {
    const onPreviewScroll = () => {
      if (this.enabled() && this.gate.claim("preview")) this.syncFromPreview();
    };
    this.scroller.addEventListener("scroll", onPreviewScroll, { passive: true });
    // Images finishing loading change block heights, which invalidates the measured offsets.
    const onLoad = () => this.invalidate();
    this.content.addEventListener("load", onLoad, true);
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.invalidate());
    resize?.observe(this.content);

    this.attachEditor();
    const offEditor = this.workbench.onEditorUpdate(() => this.attachEditor());

    return () => {
      this.scroller.removeEventListener("scroll", onPreviewScroll);
      this.content.removeEventListener("load", onLoad, true);
      resize?.disconnect();
      offEditor();
      this.detachEditor();
    };
  }

  /** The rendered content changed size or shape: measure again next time. */
  invalidate(): void {
    this.map = null;
  }

  /** After a render: put the preview back where the editor is, unless the reader is scrolling it. */
  followEditor(): void {
    this.invalidate();
    if (!this.enabled() || this.gate.blocked("editor")) return;
    // Claim first, so the scroll event this causes in the preview is not taken for the user's.
    this.gate.claim("editor");
    this.syncFromEditor();
  }

  // Editor ---------------------------------------------------------------------------------

  private readonly onEditorScroll = () => {
    if (this.enabled() && this.gate.claim("editor")) this.syncFromEditor();
  };

  private attachEditor(): void {
    const view = this.workbench.activeView();
    if (view === this.view) return;
    this.detachEditor();
    this.view = view;
    view?.scrollDOM.addEventListener("scroll", this.onEditorScroll, { passive: true });
  }

  private detachEditor(): void {
    this.view?.scrollDOM.removeEventListener("scroll", this.onEditorScroll);
    this.view = null;
  }

  // Measuring ------------------------------------------------------------------------------

  private scrollMap(totalLines: number): ScrollMap {
    if (this.map) return this.map;
    const origin = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    const anchors: Anchor[] = [];
    for (const element of Array.from(this.content.querySelectorAll("[data-line]"))) {
      const line = Number(element.getAttribute("data-line"));
      anchors.push({ line, offset: element.getBoundingClientRect().top - origin });
    }
    this.map = buildScrollMap(anchors, totalLines, this.scroller.scrollHeight);
    return this.map;
  }

  /** The source line at the top of the editor, with the fraction of the line already scrolled. */
  private editorLine(view: EditorView): number {
    const top = Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top);
    const block = view.lineBlockAtHeight(top);
    const line = view.state.doc.lineAt(block.from).number;
    return line + (block.height > 0 ? clamp((top - block.top) / block.height, 0, 1) : 0);
  }

  private scrollEditorToLine(view: EditorView, line: number): void {
    const doc = view.state.doc;
    const whole = clamp(Math.floor(line), 1, doc.lines);
    const fraction = line >= doc.lines + 1 ? 1 : line - Math.floor(line);
    const block = view.lineBlockAt(doc.line(whole).from);
    view.scrollDOM.scrollTop = block.top + fraction * block.height + view.documentPadding.top;
  }

  private syncFromEditor(): void {
    const view = this.view;
    if (!view) return;
    const editor = view.scrollDOM;
    if (editor.scrollTop <= 0) this.scroller.scrollTop = 0;
    else if (atEnd(editor)) this.scroller.scrollTop = maxScroll(this.scroller);
    else {
      const map = this.scrollMap(view.state.doc.lines);
      this.scroller.scrollTop = lineToOffset(map, this.editorLine(view));
    }
  }

  private syncFromPreview(): void {
    const view = this.view;
    if (!view) return;
    if (this.scroller.scrollTop <= 0) view.scrollDOM.scrollTop = 0;
    else if (atEnd(this.scroller)) view.scrollDOM.scrollTop = maxScroll(view.scrollDOM);
    else {
      const map = this.scrollMap(view.state.doc.lines);
      this.scrollEditorToLine(view, offsetToLine(map, this.scroller.scrollTop));
    }
  }
}
