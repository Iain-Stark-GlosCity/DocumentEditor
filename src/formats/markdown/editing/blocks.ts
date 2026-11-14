/**
 * Block-level commands: headings, blockquote, lists, task state, code block, horizontal rule.
 * All of them work line by line on the lines the selection touches.
 */
import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import {
  commit,
  findAncestor,
  isBlank,
  parseLine,
  selectedLines,
  treeOf,
  type EditCommand,
  type ParsedLine,
} from "./syntax";

const HEADING = /^(#{1,6})(?=[ \t]|$)[ \t]*/;

function codeBlockAt(state: EditorState, pos: number): boolean {
  const node = findAncestor(treeOf(state).resolveInner(pos, 1), ["FencedCode", "CodeBlock"]);
  return node !== null;
}

/** The ATX level (1 to 6) of a line, or 0. Looks after any quote and list markers. */
function levelOf(text: string, parsed: ParsedLine): number {
  const match = HEADING.exec(text.slice(parsed.contentStart));
  return match ? (match[1]?.length ?? 0) : 0;
}

type LevelChange = (current: number) => number;

/** Rewrites the heading level of each selected line. Level 0 means a plain paragraph. */
function changeHeadings(state: EditorState, next: LevelChange): ChangeSpec[] | null {
  const tree = treeOf(state);
  const lines = selectedLines(state);
  const targets = lines.filter(
    (line) =>
      (lines.length === 1 || !isBlank(line.text)) &&
      !codeBlockAt(state, line.from + parseLine(line.text).markerStart),
  );
  if (targets.length === 0) return null;
  const changes: ChangeSpec[] = [];
  const doneSetext = new Set<number>();
  for (const line of targets) {
    // Setext headings (a line underlined with = or -) are rewritten as ATX.
    const setext = findAncestor(
      tree.resolveInner(line.from + parseLine(line.text).markerStart, 1),
      ["SetextHeading1", "SetextHeading2"],
    );
    if (setext) {
      if (doneSetext.has(setext.from)) continue;
      doneSetext.add(setext.from);
      const first = state.doc.lineAt(setext.from);
      const last = state.doc.lineAt(setext.to);
      if (last.number - first.number !== 1) continue;
      const current = setext.name === "SetextHeading1" ? 1 : 2;
      const level = next(current);
      const text = first.text.trim();
      changes.push({
        from: first.from,
        to: last.to,
        insert: level === 0 ? text : `${"#".repeat(level)} ${text}`,
      });
      continue;
    }
    const parsed = parseLine(line.text);
    const current = levelOf(line.text, parsed);
    const level = next(current);
    if (level === current) continue;
    const start = line.from + parsed.contentStart;
    const match = HEADING.exec(line.text.slice(parsed.contentStart));
    const end = start + (match ? match[0].length : 0);
    changes.push({ from: start, to: end, insert: level === 0 ? "" : `${"#".repeat(level)} ` });
  }
  return changes;
}

function applyLineChanges(
  target: Parameters<EditCommand>[0],
  changes: ChangeSpec[] | null,
): boolean {
  if (!changes || changes.length === 0) return false;
  const cs = target.state.changes(changes);
  return commit(target, { changes: cs, selection: target.state.selection.map(cs, 1) });
}

/** Sets the heading level of the selected lines, or removes the heading if all already have it. */
export function setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): EditCommand {
  return (target) => {
    const { state } = target;
    const lines = selectedLines(state).filter(
      (l) => !isBlank(l.text) || selectedLines(state).length === 1,
    );
    const allAtLevel =
      lines.length > 0 &&
      lines.every((l) => {
        const p = parseLine(l.text);
        return levelOf(l.text, p) === level;
      });
    return applyLineChanges(
      target,
      changeHeadings(state, () => (allAtLevel ? 0 : level)),
    );
  };
}

export const setParagraph: EditCommand = (target) =>
  applyLineChanges(
    target,
    changeHeadings(target.state, () => 0),
  );

export const increaseHeading: EditCommand = (target) =>
  applyLineChanges(
    target,
    changeHeadings(target.state, (n) => Math.min(6, n + 1)),
  );

export const decreaseHeading: EditCommand = (target) =>
  applyLineChanges(
    target,
    changeHeadings(target.state, (n) => Math.max(0, n - 1)),
  );

const QUOTE = /^([ \t]{0,3})>[ ]?/;

export const toggleBlockquote: EditCommand = (target) => {
  const { state } = target;
  const lines = selectedLines(state);
  const content = lines.filter((l) => !isBlank(l.text));
  const quoted = content.length > 0 && content.every((l) => QUOTE.test(l.text));
  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    if (quoted) {
      const m = QUOTE.exec(line.text);
      if (m) changes.push({ from: line.from + (m[1]?.length ?? 0), to: line.from + m[0].length });
    } else {
      changes.push({
        from: line.from,
        insert: isBlank(line.text) && lines.length > 1 ? ">" : "> ",
      });
    }
  }
  return applyLineChanges(target, changes);
};

type ListTarget = "bullet" | "ordered" | "task";

function markerFor(kind: ListTarget, parsed: ParsedLine, number: number, bullet = "-"): string {
  if (kind === "ordered") return `${number}${parsed.kind === "ordered" ? parsed.delimiter : "."} `;
  return kind === "task" ? `${bullet} [ ] ` : `${bullet} `;
}

function toggleList(kind: ListTarget): EditCommand {
  return (target) => {
    const { state } = target;
    const lines = selectedLines(state).filter((l) => !isBlank(l.text));
    if (lines.length === 0) {
      // A cursor on an empty line starts a new item.
      const line = selectedLines(state)[0];
      if (!line) return false;
      const marker = markerFor(kind, parseLine(""), 1);
      return applyLineChanges(target, [{ from: line.to, insert: marker }]);
    }
    const parsedLines = lines.map((l) => parseLine(l.text));
    const allSame = parsedLines.every((p) => p.kind === kind);
    const bullet = parsedLines.find((p) => p.bullet)?.bullet ?? "-";
    const counters = new Map<number, number>();
    const changes: ChangeSpec[] = [];
    lines.forEach((line, i) => {
      const p = parsedLines[i];
      if (!p) return;
      let number = 1;
      if (kind === "ordered" && !allSame) {
        const indent = p.markerStart;
        for (const key of [...counters.keys()]) if (key > indent) counters.delete(key);
        number = (counters.get(indent) ?? 0) + 1;
        counters.set(indent, number);
      }
      const replaceFrom = line.from + p.markerStart;
      const replaceTo = line.from + p.contentStart;
      // An existing marker is replaced; a plain line gets a marker after its indentation.
      const from = p.kind === "none" ? line.from + p.markerStart : replaceFrom;
      const to = p.kind === "none" ? from : replaceTo;
      changes.push({ from, to, insert: allSame ? "" : markerFor(kind, p, number, bullet) });
    });
    return applyLineChanges(target, changes);
  };
}

export const toggleBulletList = toggleList("bullet");
export const toggleNumberedList = toggleList("ordered");
export const toggleTaskList = toggleList("task");

/** Flips `[ ]` and `[x]` on the task items under the cursors. Declines if there is none. */
export const toggleTaskChecked: EditCommand = (target) => {
  const { state } = target;
  const seen = new Set<number>();
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const p = parseLine(line.text);
      if (p.kind !== "task" && !(p.kind === "ordered" && p.boxStart >= 0)) continue;
      changes.push({
        from: line.from + p.boxStart + 1,
        to: line.from + p.boxStart + 2,
        insert: p.checked ? " " : "x",
      });
    }
  }
  if (changes.length === 0) return false;
  return commit(target, { changes });
};

/** Is any line under the selection a task item? Decides whether Mod-Enter belongs to us. */
export function selectionHasTask(state: EditorState): boolean {
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
      const p = parseLine(state.doc.line(n).text);
      if (p.kind === "task" || (p.kind === "ordered" && p.boxStart >= 0)) return true;
    }
  }
  return false;
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  for (const run of text.match(new RegExp(`${char === "`" ? "`" : "~"}+`, "g")) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return longest;
}

const FENCE_LINE = /^([ \t]{0,3})(`{3,}|~{3,})/;

/** Wraps the selected lines in a fence longer than any backtick run inside, or removes the fence. */
export const toggleCodeBlock: EditCommand = (target) => {
  const { state } = target;
  const tree = treeOf(state);

  // Inside a fenced block: remove its fences.
  const blocks = new Map<number, ReturnType<typeof findAncestor>>();
  for (const range of state.selection.ranges) {
    for (const pos of [range.from, range.to]) {
      const block = findAncestor(tree.resolveInner(pos, 1), ["FencedCode"]);
      if (block) blocks.set(block.from, block);
    }
  }
  if (blocks.size > 0) {
    const changes: ChangeSpec[] = [];
    for (const block of blocks.values()) {
      if (!block) continue;
      const first = state.doc.lineAt(block.from);
      const last = state.doc.lineAt(block.to);
      const closed = last.number > first.number && FENCE_LINE.test(last.text);
      if (closed && last.number === first.number + 1) {
        changes.push({ from: first.from, to: last.to });
        continue;
      }
      if (closed) changes.push({ from: last.from - 1, to: last.to });
      changes.push({
        from: first.from,
        to: first.number < state.doc.lines ? first.to + 1 : first.to,
      });
    }
    return applyLineChanges(target, changes);
  }

  const lines = selectedLines(state);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return false;
  const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(first.text)?.[0] ?? "";
  const body = state.sliceDoc(first.from, last.to);
  const char = "`";
  const fence = char.repeat(Math.max(3, longestRun(body, char) + 1));
  const empty = isBlank(body);
  const opener = `${prefix}${fence}`;
  const insertBefore = `${opener}\n`;
  const insertAfter = `\n${prefix}${fence}`;
  if (empty) {
    const insert = `${opener}\n${prefix}\n${prefix}${fence}`;
    return commit(target, {
      changes: { from: first.from, to: last.to, insert },
      selection: EditorSelection.cursor(first.from + opener.length + 1 + prefix.length),
    });
  }
  const changes: ChangeSpec[] = [
    { from: first.from, insert: insertBefore },
    { from: last.to, insert: insertAfter },
  ];
  return commit(target, {
    changes,
    selection: EditorSelection.cursor(first.from + opener.length),
  });
};

/** Inserts `---` on its own line below the cursor, with blank lines around it. */
export const insertHorizontalRule: EditCommand = (target) => {
  const { state } = target;
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.to);
  const blank = isBlank(line.text);
  const previousFilled = line.number > 1 && !isBlank(doc.line(line.number - 1).text);
  const lead = blank ? (previousFilled ? "\n" : "") : "\n\n";
  const insert = `${lead}---\n\n`;
  const from = blank ? line.from : line.to;
  const to = blank ? line.to : line.to;
  return commit(target, {
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
  });
};
