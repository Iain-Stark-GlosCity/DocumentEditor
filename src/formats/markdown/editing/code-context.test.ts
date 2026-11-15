/**
 * Regression tests: formatting commands must never write Markdown markup into code (inline code
 * spans, fenced or indented code blocks), where it would change the code the user typed.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  insertHorizontalRule,
  selectionHasTask,
  toggleCodeBlock,
  toggleNumberedList,
  toggleTaskChecked,
} from "./blocks";
import { toggleBold, toggleInlineCode, toggleItalic, toggleLink, toggleStrikethrough } from "./inline";
import { pasteUrl } from "./typing";
import { makeState, makeView, run, viewNotation } from "./testing";
import type { EditCommand } from "./syntax";

describe("inline toggles leave code alone", () => {
  const toggles: [string, EditCommand][] = [
    ["bold", toggleBold],
    ["italic", toggleItalic],
    ["strikethrough", toggleStrikethrough],
  ];
  describe.each(toggles)("%s", (_name, command) => {
    it.each([
      ["a selection inside an inline code span", "`co|de|`"],
      ["a word at the cursor inside an inline code span", "`co^de`"],
      ["an empty cursor between spaces inside an inline code span", "`a ^ b`"],
      ["a selection inside a fenced block", "```\nco|de|\n```"],
      ["a cursor inside a fenced block", "```\nco^de\n```"],
      ["a cursor on a blank line of a fenced block", "```\n^\n```"],
      ["a selection inside an indented code block", "    co|de|"],
      ["a cursor at the very end of an unclosed fence", "```\ncode^"],
    ])("declines for %s", (_title, input) => {
      const result = run(command, input);
      expect(result.handled).toBe(false);
      expect(result.out).toBe(input);
    });
  });

  it("does not wrap the fence lines when a selection spans a code block", () => {
    expect(run(toggleBold, "|a\n```\nx\n```\nb|").out).toBe("**|a**\n```\nx\n```\n**b|**");
  });

  it("still wraps a selection that includes the whole code span", () => {
    expect(run(toggleBold, "a |`code`| b").out).toBe("a **|`code`|** b");
  });

  it("inline code toggle skips fenced lines too", () => {
    expect(run(toggleInlineCode, "|a\n```\nx\n```\nb|").out).toBe("`|a`\n```\nx\n```\n`b|`");
  });

  it("inline code still unwraps from inside the span", () => {
    expect(run(toggleInlineCode, "`co^de`").out).toBe("co^de");
  });
});

describe("link command leaves code and images alone", () => {
  it.each([
    ["a selection inside an inline code span", "`a|b|c`"],
    ["a cursor inside a fenced block", "```\nfo^o\n```"],
    ["a selection inside image alt text", "![a|b|c](x.png)"],
    ["a cursor inside image alt text", "![ab^c](x.png)"],
  ])("declines for %s", (_title, input) => {
    const result = run(toggleLink, input);
    expect(result.handled).toBe(false);
    expect(result.out).toBe(input);
  });
});

describe("pasting a URL over a selection", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    while (views.length) views.pop()?.destroy();
  });
  function paste(input: string, text: string) {
    const view = makeView(input);
    views.push(view);
    return { handled: pasteUrl(view, text), out: viewNotation(view) };
  }

  it.each([
    ["link text", "[|foo|](x)"],
    ["image alt text", "![|foo|](x)"],
    ["a whole link", "|[foo](x)|"],
    ["a reference link label", "[|foo|][r]\n\n[r]: http://x"],
  ])("does not nest a link inside %s", (_title, input) => {
    const result = paste(input, "https://example.com");
    expect(result.handled).toBe(false);
    expect(result.out).toBe(input);
  });

  it("keeps a label with unbalanced brackets a single link", () => {
    expect(paste("|a [b|", "https://example.com").out).toBe(
      "[a \\[b](https://example.com)^",
    );
    expect(paste("|a] b|", "https://example.com").out).toBe("[a\\] b](https://example.com)^");
  });

  it("leaves a balanced label untouched", () => {
    expect(paste("|a [b] c|", "https://example.com").out).toBe(
      "[a [b] c](https://example.com)^",
    );
  });

  it("does not touch already escaped brackets", () => {
    expect(paste("|a \\[b|", "https://example.com").out).toBe("[a \\[b](https://example.com)^");
  });
});

describe("task toggle and rule do not edit code", () => {
  it("Mod-Enter style toggle ignores task-looking lines in a fence", () => {
    const result = run(toggleTaskChecked, "```\n- [ ] a^\n```");
    expect(result.handled).toBe(false);
    expect(result.out).toBe("```\n- [ ] a^\n```");
  });

  it("selectionHasTask is false inside a fence", () => {
    expect(selectionHasTask(makeState("```\n- [ ] a^\n```"))).toBe(false);
  });

  it("still toggles a task outside a fence", () => {
    expect(run(toggleTaskChecked, "- [ ] a^\n```\nx\n```").out).toBe("- [x] a^\n```\nx\n```");
  });

  it("a horizontal rule goes after the fence, not inside it", () => {
    expect(run(insertHorizontalRule, "```\nx^\n```").out).toBe("```\nx\n```\n\n---\n\n^");
  });

  it("a horizontal rule after an unclosed fence at the end of the document", () => {
    expect(run(insertHorizontalRule, "```\nx^").out).toBe("```\nx\n\n---\n\n^");
  });
});

describe("code block command at the end of the document", () => {
  it("removes an unclosed fence when the cursor is at the very end", () => {
    expect(run(toggleCodeBlock, "```js\nx^").out).toBe("x^");
  });

  it("removes an unclosed fence when the cursor is on a trailing empty line", () => {
    expect(run(toggleCodeBlock, "```\nx\n^").out).toBe("x\n^");
  });

  it("removes a closed fence when the cursor is at the end of the closing line", () => {
    expect(run(toggleCodeBlock, "a\n```\nx\n```^").out).toBe("a\nx^");
  });
});

describe("numbered list toggle keeps one delimiter", () => {
  it("continues the delimiter of the first numbered line", () => {
    expect(run(toggleNumberedList, "|1) a\nb\nc|").out).toBe("|1) a\n2) b\n3) c|");
  });

  it("uses a full stop when no line is numbered", () => {
    expect(run(toggleNumberedList, "|a\nb|").out).toBe("1. |a\n2. b|");
  });
});
