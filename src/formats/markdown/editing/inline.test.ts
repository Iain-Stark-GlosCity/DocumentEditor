import { undo, history } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import {
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleStrikethrough,
} from "./inline";
import { Harness, makeState, run, type Row } from "./testing";
import type { EditCommand } from "./syntax";

function table(name: string, command: EditCommand, rows: readonly Row[]) {
  describe(name, () => {
    it.each(rows)("%s", (_title, input, expected) => {
      expect(run(command, input).out).toBe(expected);
    });
  });
}

table("toggleBold", toggleBold, [
  ["wraps a selection", "foo |bar| baz", "foo **|bar|** baz"],
  ["wraps the word at the cursor", "foo ba^r baz", "foo **ba^r** baz"],
  ["cursor at word start", "foo ^bar baz", "foo **^bar** baz"],
  ["cursor at word end", "foo bar^ baz", "foo **bar^** baz"],
  ["empty pair when no word", "foo ^ baz", "foo **^** baz"],
  ["unwraps when the selection is inside", "**foo |ba|r**", "foo |ba|r"],
  ["unwraps with the cursor inside", "**fo^o**", "fo^o"],
  ["unwraps when the selection is exactly the text", "**|foo|**", "|foo|"],
  ["unwraps when the selection includes the markers", "x |**foo**| y", "x |foo| y"],
  ["unwraps underscores", "__fo^o__", "fo^o"],
  ["does not treat italic as bold", "*fo^o*", "***fo^o***"],
  ["trims whitespace from the selection", "a| b |c", "a **|b|** c"],
  ["bolds inside italic", "*a |b| c*", "*a **|b|** c*"],
  ["unwraps bold inside italic", "*a **|b|** c*", "*a |b| c*"],
  ["selection covering two bold runs unwraps both", "|**a** **b**|", "|a b|"],
  ["selection covering bold and plain text wraps", "|**a** and b|", "**|**a** and b|**"],
  ["multiple selections", "|a| b |c|", "**|a|** b **|c|**"],
  ["two cursors in the same word wrap it once", "fo^o^bar", "**fo^o^bar**"],
  ["multiple selections unwrap", "**|a|** b **|c|**", "|a| b |c|"],
  ["each line of a multi-line selection", "|one\n\ntwo|", "**|one**\n\n**two|**"],
  ["skips list markers", "|- one\n- two|", "- **|one**\n- **two|**"],
  ["skips heading markers", "|# Title|", "# **|Title|**"],
  ["CJK word", "你好^世界 end", "**你好^世界** end"],
  ["CJK selection", "a |你好| b", "a **|你好|** b"],
  ["emoji selection keeps surrogate pairs", "a |😀😀| b", "a **|😀😀|** b"],
  ["emoji only: empty pair at the cursor", "😀^😀", "😀**^**😀"],
  ["word next to an emoji", "😀fo^o😀", "😀**fo^o**😀"],
  ["unwraps around emoji", "**😀|x|😀**", "😀|x|😀"],
]);

table("toggleItalic", toggleItalic, [
  ["wraps a selection", "foo |bar| baz", "foo *|bar|* baz"],
  ["wraps the word", "foo ba^r", "foo *ba^r*"],
  ["unwraps asterisks", "*fo^o*", "fo^o"],
  ["unwraps underscores", "_|foo|_", "|foo|"],
  ["unwraps inside bold-italic", "***fo^o***", "**fo^o**"],
  ["italic inside bold", "**a |b| c**", "**a *|b|* c**"],
  ["bold is not italic", "**fo^o**", "***fo^o***"],
  ["adjacent italic runs toggle independently", "*a* *b^*", "*a* b^"],
  ["empty pair", "x ^ y", "x *^* y"],
]);

table("toggleStrikethrough", toggleStrikethrough, [
  ["wraps a selection", "foo |bar| baz", "foo ~~|bar|~~ baz"],
  ["unwraps", "~~fo^o~~", "fo^o"],
  ["unwraps a selection exactly around", "~~|foo|~~", "|foo|"],
  ["nested in bold", "**a |b| c**", "**a ~~|b|~~ c**"],
  ["empty pair", "x ^ y", "x ~~^~~ y"],
]);

table("toggleInlineCode", toggleInlineCode, [
  ["wraps a selection", "foo |bar| baz", "foo `|bar|` baz"],
  ["wraps the word", "foo ba^r", "foo `ba^r`"],
  ["unwraps", "`fo^o`", "fo^o"],
  ["unwraps a selection", "`|foo|`", "|foo|"],
  ["longer fence than any run inside", "|a`b|", "``|a`b|``"],
  ["longer again for a double run", "|a``b|", "```|a``b|```"],
  ["pads when the content starts with a backtick", "|`a|", "`` |`a| ``"],
  ["unwraps double-backtick code", "``a`b^``", "a`b^"],
  ["empty pair", "x ^ y", "x `^` y"],
  ["multiple selections", "|a| |b|", "`|a|` `|b|`"],
]);

table("toggleLink", toggleLink, [
  ["wraps a selection with the cursor in the address", "see |docs| now", "see [docs](^) now"],
  [
    "selection that is a URL puts the cursor in the text",
    "|https://example.com|",
    "[^](https://example.com)",
  ],
  ["URL under the cursor", "go https://exa^mple.com now", "go [^](https://example.com) now"],
  ["word at the cursor", "see do^cs now", "see [docs](^) now"],
  ["no word: empty link", "a ^ b", "a [^]() b"],
  ["unwraps a link", "[do^cs](https://example.com)", "do^cs"],
  ["unwraps with the selection on the text", "[|docs|](https://example.com)", "|docs|"],
  ["multiple selections", "|a| and |b|", "[a](^) and [b](^)"],
  [
    "URL with unbalanced parenthesis uses angle brackets",
    "|https://e.com/a)b|",
    "[^](<https://e.com/a)b>)",
  ],
  ["www URL", "|www.example.com|", "[^](www.example.com)"],
  ["CJK selection", "a |你好| b", "a [你好](^) b"],
]);

describe("transactions", () => {
  it("is a single undoable transaction that restores the text exactly", () => {
    const state = makeState("**|a|** b **|c|**", {}, [history()]);
    const harness = new Harness(state);
    expect(toggleBold(harness)).toBe(true);
    expect(harness.transactions).toHaveLength(1);
    expect(harness.notation).toBe("|a| b |c|");
    const before = state.doc.toString();
    expect(undo(harness)).toBe(true);
    expect(harness.state.doc.toString()).toBe(before);
  });

  it("never introduces CRLF", () => {
    const base = makeState("a\n|b|\nc");
    const state = base.update({
      changes: { from: 0, to: base.doc.length, insert: "a\r\nb\r\nc" },
      selection: { anchor: 2, head: 3 },
    }).state;
    expect(state.doc.toString()).toBe("a\nb\nc");
    const harness = new Harness(state);
    toggleBold(harness);
    expect(harness.state.doc.toString()).not.toContain("\r");
    expect(harness.notation).toBe("a\n**|b|**\nc");
  });

  it("leaves text it did not touch alone", () => {
    const { harness } = run(toggleItalic, "keep  this   spacing |x|  and\ttabs");
    expect(harness.state.doc.toString()).toBe("keep  this   spacing *x*  and\ttabs");
  });
});
