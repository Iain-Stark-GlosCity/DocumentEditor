/**
 * Block constructs: headings, block quotes, lists and tasks, rules and code blocks. Their
 * markers are revealed when a selection is on the marker's line (code fences: anywhere in the
 * block), except list bullets and task boxes, which follow the inline rule so that typing in a
 * list item does not keep swapping the bullet for its source.
 */
import type { SyntaxNode } from "@lezer/common";
import type { LiveBuilder, LiveRenderer } from "../types";
import { BulletWidget, RuleWidget, TaskWidget } from "../widgets";
import { SYNTAX } from "./inline";

function isBlank(char: string): boolean {
  return char === " " || char === "\t";
}

const ATX = [1, 2, 3, 4, 5, 6].map((level) => `ATXHeading${level}`);

export const atxHeading: LiveRenderer = {
  id: "atx-heading",
  nodes: ATX,
  decorate(n, out) {
    const level = Number(n.name.slice(-1));
    out.lineClass(n.from, "cm-live-heading");
    out.lineClass(n.from, `cm-live-h${level}`);
    const marks = n.getChildren("HeaderMark");
    const open = marks[0];
    if (!open) return;
    const doc = out.state.doc;
    const revealed = out.linesTouched(n.from, n.to);
    let end = open.to;
    while (end < n.to && isBlank(doc.sliceString(end, end + 1))) end++;
    const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
    let closeFrom = close ? close.from : n.to;
    while (close && closeFrom > end && isBlank(doc.sliceString(closeFrom - 1, closeFrom))) {
      closeFrom--;
    }
    // A heading with no text keeps its marker, or the line would look empty.
    const hasText = end < closeFrom;
    if (revealed || !hasText) {
      out.mark(open.from, open.to, SYNTAX);
      if (close) out.mark(close.from, close.to, SYNTAX);
      return;
    }
    out.hide(open.from, end);
    if (close) out.hide(closeFrom, close.to);
  },
};

export const setextHeading: LiveRenderer = {
  id: "setext-heading",
  nodes: ["SetextHeading1", "SetextHeading2"],
  decorate(n, out) {
    const level = n.name.endsWith("1") ? 1 : 2;
    const underline = n.getChild("HeaderMark");
    const textEnd = underline ? underline.from - 1 : n.to;
    out.linesClass(n.from, Math.max(n.from, textEnd), "cm-live-heading");
    out.linesClass(n.from, Math.max(n.from, textEnd), `cm-live-h${level}`);
    if (underline) {
      // Dimmed, never hidden: it is what makes the line a heading.
      out.lineClass(underline.from, "cm-live-setext-underline");
      out.mark(underline.from, underline.to, SYNTAX);
    }
  },
};

/** Calls `fn` with the start of each line of `[from, to]` inside the range being decorated. */
function eachLine(out: LiveBuilder, from: number, to: number, fn: (lineFrom: number) => void) {
  const doc = out.state.doc;
  const first = doc.lineAt(Math.max(from, out.from)).number;
  const last = doc.lineAt(Math.min(to, out.to)).number;
  for (let n = first; n <= last; n++) fn(doc.line(n).from);
}

/** Each nesting level adds a bar; the depth is a line class (`cm-live-quote-<depth>`). */
export const blockquote: LiveRenderer = {
  id: "blockquote",
  nodes: ["Blockquote"],
  decorate(n, out) {
    eachLine(out, n.from, n.to, (pos) => {
      out.lineClass(pos, "cm-live-quote");
      out.lineCount(pos, "cm-live-quote");
    });
  },
};

export const quoteMark: LiveRenderer = {
  id: "quote-mark",
  nodes: ["QuoteMark"],
  decorate(n, out) {
    if (out.linesTouched(n.from, n.to)) {
      out.mark(n.from, n.to, SYNTAX);
      return;
    }
    const after = out.state.doc.sliceString(n.to, n.to + 1);
    out.hide(n.from, isBlank(after) ? n.to + 1 : n.to);
  },
};

function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent) {
    if (p.name === "BulletList" || p.name === "OrderedList") depth++;
  }
  return depth;
}

export const listMark: LiveRenderer = {
  id: "list-mark",
  nodes: ["ListMark"],
  decorate(n, out) {
    const item = n.parent;
    const list = item?.parent;
    if (!item || item.name !== "ListItem" || !list) return;
    // Task items show a checkbox instead (see `task`).
    if (item.getChild("Task")?.getChild("TaskMarker")) return;
    if (list.name === "OrderedList") {
      out.mark(n.from, n.to, "cm-live-list-number");
      return;
    }
    if (out.touches(n.from, n.to)) out.mark(n.from, n.to, SYNTAX);
    else out.replace(n.from, n.to, new BulletWidget(listDepth(n)));
  },
};

/** `- [ ] text`: the bullet and box become one real checkbox. */
export const task: LiveRenderer = {
  id: "task",
  nodes: ["Task"],
  decorate(n, out) {
    const marker = n.getChild("TaskMarker");
    const listMark = n.parent?.getChild("ListMark");
    if (!marker || !listMark) return;
    const doc = out.state.doc;
    const state = doc.sliceString(marker.from + 1, marker.from + 2);
    const checked = state === "x" || state === "X";
    const lineEnd = doc.lineAt(marker.to).to;
    const text = doc.sliceString(marker.to, Math.min(n.to, lineEnd)).trim();
    if (checked) out.mark(marker.to, n.to, "cm-live-task-done");
    if (out.touches(listMark.from, marker.to)) {
      out.mark(marker.from, marker.to, SYNTAX);
      return;
    }
    const label = text ? `Task: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}` : "Task";
    out.replace(
      listMark.from,
      marker.to,
      new TaskWidget(checked, marker.from + 1 - listMark.from, label),
    );
  },
};

export const horizontalRule: LiveRenderer = {
  id: "horizontal-rule",
  nodes: ["HorizontalRule"],
  decorate(n, out) {
    out.lineClass(n.from, "cm-live-hr-line");
    if (out.linesTouched(n.from, n.to)) out.mark(n.from, n.to, SYNTAX);
    else out.replace(n.from, n.to, new RuleWidget());
  },
};

export const fencedCode: LiveRenderer = {
  id: "fenced-code",
  nodes: ["FencedCode"],
  decorate(n, out) {
    const doc = out.state.doc;
    const revealed = out.linesTouched(n.from, n.to);
    eachLine(out, n.from, n.to, (pos) => out.lineClass(pos, "cm-live-codeblock"));
    out.lineClass(n.from, "cm-live-codeblock-begin");
    out.lineClass(n.to, "cm-live-codeblock-end");
    const fences = n.getChildren("CodeMark");
    for (const fence of fences) {
      const line = doc.lineAt(fence.from);
      out.lineClass(line.from, "cm-live-fence");
      if (!revealed) out.lineClass(line.from, "cm-live-fence-dim");
    }
    const info = n.getChild("CodeInfo");
    if (info) out.mark(info.from, info.to, "cm-live-code-lang");
    return false;
  },
};

export const indentedCode: LiveRenderer = {
  id: "indented-code",
  nodes: ["CodeBlock"],
  decorate(n, out) {
    eachLine(out, n.from, n.to, (pos) => out.lineClass(pos, "cm-live-codeblock"));
    out.lineClass(n.from, "cm-live-codeblock-begin");
    out.lineClass(n.to, "cm-live-codeblock-end");
    return false;
  },
};

/**
 * Left as source in this version (another renderer can take them over through the
 * `liveRenderers` facet). Returning false keeps inline rendering out of them, so a table's
 * columns stay lined up and raw HTML reads as written.
 */
export const leftAsSource: LiveRenderer = {
  id: "left-as-source",
  nodes: ["Table", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock", "LinkReference"],
  decorate: () => false,
  decorateBlock: () => false,
};
