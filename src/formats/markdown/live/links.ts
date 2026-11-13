/**
 * Finding and following the link under the caret or pointer. In-document anchors (`#heading`)
 * are followed here, in the editor; everything else goes to the host through `openLink`.
 */
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { liveOptions } from "./types";

function text(state: EditorState, node: SyntaxNode): string {
  return state.doc.sliceString(node.from, node.to);
}

function normaliseLabel(label: string): string {
  return label
    .replace(/^\[|\]$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The URL of a `[label]: url` definition, searched among the top-level blocks. */
function definition(state: EditorState, label: string): string | null {
  const wanted = normaliseLabel(label);
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name !== "LinkReference") continue;
    const name = n.getChild("LinkLabel");
    const url = n.getChild("URL");
    if (name && url && normaliseLabel(text(state, name)) === wanted) {
      return text(state, url).replace(/^<|>$/g, "");
    }
  }
  return null;
}

function hrefOf(state: EditorState, node: SyntaxNode): string | null {
  switch (node.name) {
    case "Link": {
      const url = node.getChild("URL");
      if (url) return text(state, url).replace(/^<|>$/g, "");
      const label = node.getChild("LinkLabel");
      if (label) return definition(state, text(state, label));
      const marks = node.getChildren("LinkMark");
      const open = marks[0];
      const close = marks[1];
      if (open && close) return definition(state, state.doc.sliceString(open.to, close.from));
      return null;
    }
    case "Autolink": {
      const url = node.getChild("URL");
      if (!url) return null;
      const value = text(state, url);
      return /^[^\s@<>]+@[^\s@<>]+$/.test(value) && !value.includes(":")
        ? `mailto:${value}`
        : value;
    }
    case "URL": {
      const value = text(state, node);
      if (node.parent?.name === "Link" || node.parent?.name === "Image") return null;
      if (/^www\./i.test(value)) return `http://${value}`;
      if (/^[^\s@:]+@[^\s@]+$/.test(value)) return `mailto:${value}`;
      return value;
    }
    default:
      return null;
  }
}

/** The target of the link at `pos` (either side), or null. */
export function linkAt(state: EditorState, pos: number): string | null {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "Image") break;
      if (n.name === "Link" || n.name === "Autolink" || n.name === "URL") {
        const href = hrefOf(state, n);
        if (href !== null || n.name !== "URL") return href;
      }
    }
  }
  return null;
}

/** GitHub-style heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Start offset of the heading whose anchor is `id`, or null. */
export function findAnchor(state: EditorState, id: string): number | null {
  const wanted = id.toLowerCase();
  const seen = new Map<string, number>();
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (!/^(ATX|Setext)Heading/.test(n.name)) continue;
    const raw = text(state, n)
      .replace(/^#{1,6}[ \t]*/, "")
      .replace(/[ \t]+#+[ \t]*$/, "")
      .replace(/\n[=-]+[ \t]*$/, "")
      .replace(/[*_~`]/g, "");
    const base = slugify(raw);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count}`;
    if (slug === wanted || `user-content-${slug}` === wanted) return n.from;
  }
  return null;
}

/** Follows `href`: anchors move the caret to the heading, anything else goes to the host. */
export function followLink(view: EditorView, href: string): boolean {
  const target = href.trim();
  if (target.startsWith("#")) {
    let id = target.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep it as written.
    }
    const pos = findAnchor(view.state, id);
    if (pos === null) return false;
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }),
    });
    return true;
  }
  const open = view.state.facet(liveOptions).openLink;
  if (!open) return false;
  open(target);
  return true;
}

/** Command: open the link at the main caret. */
export function openLinkAtCursor(view: EditorView): boolean {
  const href = linkAt(view.state, view.state.selection.main.head);
  return href !== null && followLink(view, href);
}

/** Ctrl+click (Cmd+click on macOS) on a link follows it instead of adding a caret. */
export const ctrlClickLinks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const href = linkAt(view.state, pos);
    if (href === null) return false;
    event.preventDefault();
    followLink(view, href);
    return true;
  },
});
