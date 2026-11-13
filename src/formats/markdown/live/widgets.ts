/**
 * Widgets drawn in place of hidden source. None of them holds a document position: positions go
 * stale as the text changes, so event handlers ask the view where the widget is (`posAtDOM`).
 */
import { EditorView, WidgetType } from "@codemirror/view";

const BULLETS = ["•", "◦", "▪"];

/** A bullet glyph in place of `-`, `*` or `+`. The glyph depends on the nesting depth. */
export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = BULLETS[(this.depth - 1) % BULLETS.length] ?? "•";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

/**
 * A real checkbox in place of `- [ ]`. `offset` is the distance from the start of the replaced
 * range to the character inside the brackets, which is what a toggle changes.
 */
export class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly offset: number,
    readonly label: string,
  ) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return (
      other.checked === this.checked && other.offset === this.offset && other.label === this.label
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-live-task";
    this.apply(box);
    box.addEventListener("mousedown", (event) => {
      // Keep the editor selection where it is: a click toggles, it does not move the caret.
      event.preventDefault();
    });
    // Mouse clicks and Space on the focused box both arrive as `click`. The native toggle is left
    // to happen: the transaction below produces the same state, and `updateDOM` confirms it.
    box.addEventListener("click", () => {
      if (!toggleTaskAt(view, view.posAtDOM(box) + Number(box.dataset.offset ?? "0"))) {
        box.checked = !box.checked;
      }
    });
    return box;
  }
  /** Reuse the element (so it keeps focus) when only the state changed. */
  updateDOM(dom: HTMLElement): boolean {
    if (!(dom instanceof HTMLInputElement)) return false;
    this.apply(dom);
    return true;
  }
  private apply(box: HTMLInputElement): void {
    box.checked = this.checked;
    box.dataset.offset = String(this.offset);
    box.setAttribute("aria-label", this.label);
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Flips the task character at `pos` (`[ ]` <-> `[x]`) as one ordinary, undoable change. Returns
 * false if `pos` is not inside a task marker.
 */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const doc = view.state.doc;
  if (pos <= 0 || pos >= doc.length) return false;
  if (doc.sliceString(pos - 1, pos) !== "[" || doc.sliceString(pos + 1, pos + 2) !== "]") {
    return false;
  }
  const current = doc.sliceString(pos, pos + 1);
  if (current !== " " && current !== "x" && current !== "X") return false;
  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: current === " " ? "x" : " " },
    userEvent: "input.toggle",
  });
  return true;
}

/** A horizontal rule in place of `---`, `***` or `___`. */
export class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-hr";
    span.setAttribute("role", "separator");
    return span;
  }
}

/** The character an HTML entity such as `&amp;` stands for. */
export class EntityWidget extends WidgetType {
  constructor(readonly entity: string) {
    super();
  }
  eq(other: EntityWidget): boolean {
    return other.entity === this.entity;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-entity";
    span.textContent = decodeEntity(this.entity);
    return span;
  }
}

/** Decodes one entity. A textarea's content is never parsed as markup or run. */
export function decodeEntity(entity: string): string {
  const numeric = /^&#(x[0-9a-f]+|[0-9]+);$/i.exec(entity);
  if (numeric?.[1]) {
    const digits = numeric[1];
    const code =
      digits[0] === "x" || digits[0] === "X" ? parseInt(digits.slice(1), 16) : parseInt(digits, 10);
    try {
      return code > 0 ? String.fromCodePoint(code) : "�";
    } catch {
      return "�";
    }
  }
  const area = document.createElement("textarea");
  area.innerHTML = entity;
  return area.value;
}

/** Height reserved for an image before it has loaded, to limit layout jumps. */
export const IMAGE_ESTIMATED_HEIGHT = 200;

export type ImageSource = { kind: "url"; url: string } | { kind: "blocked"; reason: string };

/**
 * An image shown as a block below its line (or in place of a line holding only the image).
 * `back` is the distance from the widget's position back to the start of the image source,
 * used to put the caret there when the image is clicked.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly source: ImageSource,
    readonly alt: string,
    readonly title: string,
    readonly back: number,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return (
      other.alt === this.alt &&
      other.title === this.title &&
      other.back === this.back &&
      other.source.kind === this.source.kind &&
      (other.source.kind === "url"
        ? other.source.url === (this.source as { url: string }).url
        : other.source.reason === (this.source as { reason: string }).reason)
    );
  }
  get estimatedHeight(): number {
    return this.source.kind === "url" ? IMAGE_ESTIMATED_HEIGHT : 32;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-live-image";
    if (this.source.kind === "url") {
      box.classList.add("cm-live-image-loading");
      const img = document.createElement("img");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.alt = this.alt;
      if (this.title) img.title = this.title;
      img.addEventListener("load", () => {
        box.classList.remove("cm-live-image-loading");
        view.requestMeasure();
      });
      img.addEventListener("error", () => {
        box.classList.remove("cm-live-image-loading");
        box.classList.add("cm-live-image-blocked");
        box.replaceChildren(caption(this.alt, "Image could not be loaded"));
        view.requestMeasure();
      });
      img.src = this.source.url;
      box.append(img);
    } else {
      box.classList.add("cm-live-image-blocked");
      box.append(caption(this.alt, this.source.reason));
    }
    box.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pos = Math.max(0, view.posAtDOM(box) - this.back);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function caption(alt: string, reason: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = alt ? `${alt} (${reason})` : reason;
  return span;
}
