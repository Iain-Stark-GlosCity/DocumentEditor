/**
 * The outline of the active document as the workbench sees it: a small store the outline panel
 * reads, plus helpers the navigation commands share.
 *
 * Updates are debounced, and the published list only changes when the headings' levels or text
 * do, so typing in a paragraph never re-renders the panel. Positions are kept fresh privately.
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { OutlineItem } from "../core/format";
import type { EditorUpdate, Workbench } from "./workbench";

/** Quiet time after an edit before the outline is read again. */
export const OUTLINE_DEBOUNCE_MS = 150;
/** How often an unfinished parse is polled, and how many times. */
const RETRY_MS = 300;
const MAX_RETRIES = 20;

export interface OutlineSnapshot {
  /** Null when the active document has no outline (no document, or a format without one). */
  items: readonly OutlineItem[] | null;
  /** Index of the heading that contains the cursor, or -1. */
  active: number;
}

/** The headings of the active document, read now; null if its format has no outline. */
export function headingsOf(workbench: Workbench, state?: EditorState | null): OutlineItem[] | null {
  const doc = workbench.activeDocument();
  const current = state ?? workbench.activeEditorState();
  const provider = doc ? workbench.registry.byId(doc.providerId) : undefined;
  if (!current || !provider?.outline) return null;
  return provider.outline(current);
}

/** Index of the last heading that starts at or before `pos`, or -1. */
export function headingIndexAt(items: readonly OutlineItem[], pos: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((items[mid]?.from ?? Infinity) <= pos) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** The heading after (`1`) or before (`-1`) the cursor position, or undefined. */
export function adjacentHeading(
  items: readonly OutlineItem[],
  pos: number,
  direction: 1 | -1,
): OutlineItem | undefined {
  if (direction === 1) return items.find((item) => item.from > pos);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && item.from < pos) return item;
  }
  return undefined;
}

/** Moves the cursor to a heading, scrolls it near the top and focuses the editor. */
export function revealHeading(workbench: Workbench, item: OutlineItem): void {
  const view = workbench.activeView();
  if (!view) return;
  const at = Math.min(item.from, view.state.doc.length);
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 12 }),
    userEvent: "select.outline",
  });
  view.focus();
}

function sameHeadings(a: readonly OutlineItem[], b: readonly OutlineItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.level !== b[i]?.level || a[i]?.text !== b[i]?.text) return false;
  }
  return true;
}

export class OutlineModel {
  readonly store: StoreApi<OutlineSnapshot> = createStore<OutlineSnapshot>()(() => ({
    items: null,
    active: -1,
  }));
  private fresh: readonly OutlineItem[] = [];
  private docId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;

  constructor(private readonly workbench: Workbench) {}

  /** Starts following the active document. Returns a function that stops. */
  start(): () => void {
    this.docId = this.workbench.documents.getState().activeId;
    this.compute();
    const off = this.workbench.onEditorUpdate((update) => this.onUpdate(update));
    return () => {
      off();
      this.cancel();
    };
  }

  /** Reads the outline now, ahead of any pending debounce. */
  refresh(): void {
    this.cancel();
    this.compute();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.compute();
    }, delay);
  }

  private onUpdate(update: EditorUpdate): void {
    if (update.docId !== this.docId) {
      this.docId = update.docId;
      this.retries = 0;
      this.refresh();
      return;
    }
    if (update.docChanged) {
      this.retries = 0;
      this.schedule(OUTLINE_DEBOUNCE_MS);
      return;
    }
    if (update.state) this.setActive(update.state);
  }

  private compute(): void {
    const state = this.workbench.activeEditorState();
    const items = headingsOf(this.workbench, state);
    if (!state || !items) {
      this.fresh = [];
      this.store.setState({ items: null, active: -1 });
      return;
    }
    this.fresh = items;
    const previous = this.store.getState().items;
    if (!previous || !sameHeadings(previous, items)) this.store.setState({ items });
    this.setActive(state);

    // An unfinished parse yields a partial outline: look again shortly.
    const tree = syntaxTree(state);
    if (tree.length > 0 && tree.length < state.doc.length && this.retries < MAX_RETRIES) {
      this.retries++;
      this.schedule(RETRY_MS);
    }
  }

  private setActive(state: EditorState): void {
    const active = headingIndexAt(this.fresh, state.selection.main.head);
    if (active !== this.store.getState().active) this.store.setState({ active });
  }
}

const models = new WeakMap<Workbench, OutlineModel>();

/** The one outline model of a workbench. */
export function outlineModel(workbench: Workbench): OutlineModel {
  let model = models.get(workbench);
  if (!model) {
    model = new OutlineModel(workbench);
    models.set(workbench, model);
  }
  return model;
}
