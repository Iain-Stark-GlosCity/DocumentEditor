/**
 * Inline constructs: emphasis, strong, strikethrough, inline code, links, autolinks, escapes
 * and entities. Markers are hidden unless a selection touches the construct (edges included).
 * Lezer only builds these nodes for balanced markup, so unbalanced markers are never hidden.
 */
import type { SyntaxNode } from "@lezer/common";
import type { LiveBuilder, LiveRenderer } from "../types";
import { EntityWidget } from "../widgets";

/** Dimmed, still visible markers of a revealed construct. */
export const SYNTAX = "cm-live-syntax";

function children(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) out.push(child);
  }
  return out;
}

/** Shows or hides a marker depending on whether the construct is revealed. */
function marker(out: LiveBuilder, revealed: boolean, from: number, to: number): void {
  if (revealed) out.mark(from, to, SYNTAX);
  else out.hide(from, to);
}

function delimited(id: string, node: string, markName: string, className: string): LiveRenderer {
  return {
    id,
    nodes: [node],
    decorate(n, out) {
      const marks = children(n, markName);
      if (marks.length < 2) return;
      const revealed = out.touches(n.from, n.to);
      const first = marks[0];
      const last = marks[marks.length - 1];
      if (!first || !last) return;
      out.mark(first.to, last.from, className);
      for (const m of marks) marker(out, revealed, m.from, m.to);
    },
  };
}

export const emphasis = delimited("emphasis", "Emphasis", "EmphasisMark", "cm-live-em");
export const strong = delimited("strong", "StrongEmphasis", "EmphasisMark", "cm-live-strong");
export const strikethrough = delimited(
  "strikethrough",
  "Strikethrough",
  "StrikethroughMark",
  "cm-live-strike",
);

export const inlineCode = delimited("inline-code", "InlineCode", "CodeMark", "cm-live-inline-code");

/** `[text](url "title")`, `[text][label]` and `[text][]`. A bare `[text]` is left alone. */
export const link: LiveRenderer = {
  id: "link",
  nodes: ["Link"],
  decorate(n, out) {
    const marks = children(n, "LinkMark");
    const open = marks[0];
    const close = marks[1];
    if (!open || !close || open.to !== open.from + 1) return;
    const url = n.getChild("URL");
    const label = n.getChild("LinkLabel");
    const inline = marks.length >= 4; // [ ] ( )
    const collapsed = !label && n.to === close.to + 2 && sliceAt(out, close.to, n.to) === "[]";
    if (!inline && !label && !collapsed) return;
    // Hiding everything around empty text would make the link vanish.
    if (close.from <= open.to) return;
    const target = url
      ? sliceAt(out, url.from, url.to).replace(/^<|>$/g, "")
      : label
        ? sliceAt(out, label.from, label.to)
        : sliceAt(out, open.to, close.from);
    const revealed = out.touches(n.from, n.to);
    out.mark(open.to, close.from, "cm-live-link", { title: `${target}\nCtrl+click to open` });
    marker(out, revealed, open.from, open.to);
    marker(out, revealed, close.from, n.to);
  },
};

/** `<https://example.com>` and `<someone@example.com>`. */
export const autolink: LiveRenderer = {
  id: "autolink",
  nodes: ["Autolink"],
  decorate(n, out) {
    const url = n.getChild("URL");
    if (!url) return false;
    const revealed = out.touches(n.from, n.to);
    out.mark(url.from, url.to, "cm-live-link", { title: "Ctrl+click to open" });
    for (const m of children(n, "LinkMark")) marker(out, revealed, m.from, m.to);
    return false;
  },
};

const LINK_PARENTS = new Set(["Link", "Image", "Autolink", "LinkReference"]);

/** A bare URL found by the GFM autolink extension (`https://...`, `www.`). */
export const bareUrl: LiveRenderer = {
  id: "bare-url",
  nodes: ["URL"],
  decorate(n, out) {
    if (LINK_PARENTS.has(n.parent?.name ?? "")) return;
    out.mark(n.from, n.to, "cm-live-link", { title: "Ctrl+click to open" });
  },
};

/** `\*`: the backslash is hidden. */
export const escape: LiveRenderer = {
  id: "escape",
  nodes: ["Escape"],
  decorate(n, out) {
    marker(out, out.touches(n.from, n.to), n.from, n.from + 1);
  },
};

/** `&amp;`, `&#169;`: shown as the character. */
export const entity: LiveRenderer = {
  id: "entity",
  nodes: ["Entity"],
  decorate(n, out) {
    if (out.touches(n.from, n.to)) out.mark(n.from, n.to, SYNTAX);
    else out.replace(n.from, n.to, new EntityWidget(sliceAt(out, n.from, n.to)));
  },
};

function sliceAt(out: LiveBuilder, from: number, to: number): string {
  return out.state.doc.sliceString(from, to);
}
