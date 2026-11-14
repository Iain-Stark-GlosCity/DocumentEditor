import { history, undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import {
  decreaseHeading,
  increaseHeading,
  insertHorizontalRule,
  setHeading,
  setParagraph,
  toggleBlockquote,
  toggleBulletList,
  toggleCodeBlock,
  toggleNumberedList,
  toggleTaskChecked,
  toggleTaskList,
  selectionHasTask,
} from "./blocks";
import { markdownFormatCommands } from "./commands";
import type { EditCommand } from "./syntax";
import { Harness, makeState, run, type Row } from "./testing";

function table(name: string, command: EditCommand, rows: readonly Row[]) {
  describe(name, () => {
    it.each(rows)("%s", (_title, input, expected) => {
      expect(run(command, input).out).toBe(expected);
    });
  });
}

table("setHeading(2)", setHeading(2), [
  ["makes a paragraph a heading", "fo^o", "## fo^o"],
  ["cursor at line start stays after the marker", "^foo", "## ^foo"],
  ["changes the level", "# fo^o", "## fo^o"],
  ["toggles off when already that level", "## fo^o", "fo^o"],
  ["works on a selection", "|foo|", "## |foo|"],
  ["every selected line", "|a\nb|", "## |a\n## b|"],
  ["mixed levels all become the level", "|# a\n### b|", "|## a\n## b|"],
  ["all at the level toggles all off", "|## a\n## b|", "|a\nb|"],
  ["skips blank lines in a multi-line selection", "|a\n\nb|", "## |a\n\n## b|"],
  ["multiple selections on different lines", "^a\nx\n^b", "## ^a\nx\n## ^b"],
  ["two cursors on one line change it once", "a^b^c", "## a^b^c"],
  ["empty line", "^", "## ^"],
  ["inside a blockquote", "> fo^o", "> ## fo^o"],
  ["inside a list item", "- fo^o", "- ## fo^o"],
  ["leaves code blocks alone", "```\nfo^o\n```", "```\nfo^o\n```"],
  ["rewrites a setext heading as ATX", "Tit^le\n=====", "## Title^"],
  ["no space heading marker stays text", "#fo^o", "## #fo^o"],
  ["CJK text", "你好^", "## 你好^"],
]);

table("setHeading(1)", setHeading(1), [
  ["h1", "foo^", "# foo^"],
  ["toggle", "# foo^", "foo^"],
  ["seven hashes are text", "####### fo^o", "# ####### fo^o"],
]);

table("setParagraph", setParagraph, [
  ["removes a heading", "### fo^o", "fo^o"],
  ["does nothing to a paragraph", "fo^o", "fo^o"],
  ["every line", "|# a\n## b|", "|a\nb|"],
  ["inside a quote", "> ## fo^o", "> fo^o"],
]);

table("increaseHeading", increaseHeading, [
  ["paragraph to h1", "fo^o", "# fo^o"],
  ["h1 to h2", "# fo^o", "## fo^o"],
  ["stops at h6", "###### fo^o", "###### fo^o"],
]);

table("decreaseHeading", decreaseHeading, [
  ["h2 to h1", "## fo^o", "# fo^o"],
  ["h1 to paragraph", "# fo^o", "fo^o"],
  ["paragraph unchanged", "fo^o", "fo^o"],
]);

table("toggleBlockquote", toggleBlockquote, [
  ["quotes a line", "fo^o", "> fo^o"],
  ["unquotes", "> fo^o", "fo^o"],
  ["multiple lines", "|a\nb|", "> |a\n> b|"],
  ["blank lines inside get a bare marker", "|a\n\nb|", "> |a\n>\n> b|"],
  ["unquotes multiple lines", "|> a\n> b|", "|a\nb|"],
  ["removes one level only", "> > fo^o", "> fo^o"],
  ["quotes a list item", "- fo^o", "> - fo^o"],
  ["mixed lines get quoted", "|> a\nb|", "> |> a\n> b|"],
  ["empty line", "^", "> ^"],
  ["range ending at the start of a line excludes it", "|a\n|b", "> |a\n|b"],
]);

table("toggleBulletList", toggleBulletList, [
  ["makes a bullet", "fo^o", "- fo^o"],
  ["removes a bullet", "- fo^o", "fo^o"],
  ["converts numbered", "1. fo^o", "- fo^o"],
  ["converts task", "- [ ] fo^o", "- fo^o"],
  ["multiple lines", "|a\nb|", "- |a\n- b|"],
  ["keeps nesting indentation", "|a\n  b|", "- |a\n  - b|"],
  ["keeps the existing bullet character", "|* a\nb|", "|* a\n* b|"],
  ["keeps blank lines", "|a\n\nb|", "- |a\n\n- b|"],
  ["empty line starts an item", "^", "- ^"],
  ["inside a blockquote", "> fo^o", "> - fo^o"],
  ["removing all in selection", "|- a\n- b|", "|a\nb|"],
  ["horizontal rule is text, not a bullet", "---^", "- ---^"],
]);

table("toggleNumberedList", toggleNumberedList, [
  ["numbers lines from one", "|a\nb\nc|", "1. |a\n2. b\n3. c|"],
  ["removes numbers", "|1. a\n2. b|", "|a\nb|"],
  ["converts bullets", "|- a\n- b|", "|1. a\n2. b|"],
  ["numbers each nesting level", "|a\n  b\n  c\nd|", "1. |a\n  1. b\n  2. c\n2. d|"],
  ["single line", "fo^o", "1. fo^o"],
  ["empty line", "^", "1. ^"],
]);

table("toggleTaskList", toggleTaskList, [
  ["makes a task", "fo^o", "- [ ] fo^o"],
  ["removes a task", "- [ ] fo^o", "fo^o"],
  ["removes a checked task", "- [x] fo^o", "fo^o"],
  ["converts a bullet", "- fo^o", "- [ ] fo^o"],
  ["converts numbered", "1. fo^o", "- [ ] fo^o"],
  ["multiple lines", "|a\nb|", "- [ ] |a\n- [ ] b|"],
  ["mixed selection becomes tasks", "|- a\n- [ ] b|", "|- [ ] a\n- [ ] b|"],
]);

table("toggleTaskChecked", toggleTaskChecked, [
  ["checks", "- [ ] fo^o", "- [x] fo^o"],
  ["unchecks", "- [x] fo^o", "- [ ] fo^o"],
  ["unchecks capital X", "- [X] fo^o", "- [ ] fo^o"],
  ["with the cursor anywhere on the line", "^- [ ] foo", "^- [x] foo"],
  ["every task in a selection", "|- [ ] a\n- [x] b|", "|- [x] a\n- [ ] b|"],
  ["nested task", "- a\n  - [ ] b^", "- a\n  - [x] b^"],
  ["two cursors", "- [ ] a^\n- [ ] b^", "- [x] a^\n- [x] b^"],
]);

describe("toggleTaskChecked outside tasks", () => {
  it("declines", () => {
    expect(run(toggleTaskChecked, "- fo^o").handled).toBe(false);
  });
  it("the Mod-Enter command is enabled only on a task line", () => {
    const command = markdownFormatCommands.find((c) => c.id === "markdown.toggleTaskChecked")!;
    expect(command.enabled?.(makeState("- [ ] a^"))).toBe(true);
    expect(command.enabled?.(makeState("| a |\n|---|\n| b^ |"))).toBe(false);
  });
  it("selectionHasTask tells the workbench whether Mod-Enter is ours", () => {
    expect(selectionHasTask(makeState("- [ ] a^"))).toBe(true);
    expect(selectionHasTask(makeState("fo^o"))).toBe(false);
  });
});

table("toggleCodeBlock", toggleCodeBlock, [
  ["wraps the line at the cursor", "fo^o", "```^\nfoo\n```"],
  ["wraps the selected lines", "|a\nb|", "```^\na\nb\n```"],
  ["wraps whole lines for a partial selection", "x |a| y\nz", "```^\nx a y\n```\nz"],
  ["unwraps with the cursor inside", "```\nfo^o\n```", "fo^o"],
  ["fence longer than any backtick run", "|a ``` b|", "````^\na ``` b\n````"],
  ["fence longer than a longer run", "|a ```` b|", "`````^\na ```` b\n`````"],
  ["empty line makes an empty block", "^", "```\n^\n```"],
  ["keeps blockquote prefix", "> fo^o", "> ```^\n> foo\n> ```"],
  ["unwraps with info string", "```js\nfo^o\n```", "fo^o"],
  ["unwraps an unclosed fence", "```\nfo^o", "fo^o"],
  ["unwraps a block with nothing inside", "```\n^\n```", "^"],
]);

table("insertHorizontalRule", insertHorizontalRule, [
  ["after a paragraph line", "fo^o", "foo\n\n---\n\n^"],
  ["on a blank line after text", "foo\n^", "foo\n\n---\n\n^"],
  ["on a blank line at the start", "^", "---\n\n^"],
  ["leaves selected text alone", "|foo|", "foo\n\n---\n\n^"],
  ["in the middle of a document", "a^\nb", "a\n\n---\n\n^\nb"],
]);

describe("block commands as transactions", () => {
  it("is one undo step that restores exactly", () => {
    const state = makeState("|a\nb\nc|", {}, [history()]);
    const harness = new Harness(state);
    toggleNumberedList(harness);
    expect(harness.transactions).toHaveLength(1);
    expect(harness.state.doc.toString()).toBe("1. a\n2. b\n3. c");
    undo(harness);
    expect(harness.state.doc.toString()).toBe("a\nb\nc");
  });

  it("never introduces CRLF or touches other lines", () => {
    const base = makeState("x\n|a|\ny");
    const state = base.update({
      changes: { from: 0, to: base.doc.length, insert: "x  \r\na\r\n  y" },
      selection: { anchor: 5, head: 6 },
    }).state;
    const harness = new Harness(state);
    setHeading(3)(harness);
    expect(harness.state.doc.toString()).toBe("x  \n### a\n  y");
  });
});

describe("command table", () => {
  it("has unique ids and no clash with existing keys", () => {
    const ids = markdownFormatCommands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = markdownFormatCommands.flatMap((c) => (c.defaultKey ? [c.defaultKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
    // Keys already used by the workbench: zoom, file, find and window commands.
    for (const taken of ["Mod-0", "Mod-=", "Mod--", "Mod-n", "Mod-o", "Mod-s", "Mod-w", "Mod-f"]) {
      expect(keys).not.toContain(taken);
    }
  });
});
