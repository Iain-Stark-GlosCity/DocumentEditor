import { describe, expect, it } from "vitest";
import { outlineMarkdown } from "./outline";

describe("outlineMarkdown", () => {
  it("returns ATX and setext headings with level, line and offset", () => {
    const text = "# One\n\nText\n\nTwo\n===\n\nThree\n---\n\n### Four ###\n";
    expect(outlineMarkdown(text)).toEqual([
      { level: 1, text: "One", line: 1, from: 0 },
      { level: 1, text: "Two", line: 5, from: text.indexOf("Two") },
      { level: 2, text: "Three", line: 8, from: text.indexOf("Three") },
      { level: 3, text: "Four", line: 11, from: text.indexOf("### Four") },
    ]);
  });

  it("strips inline formatting", () => {
    const [item] = outlineMarkdown(
      "## A *bold* `code` [link](http://x.example) ![alt text](i.png) <b>raw</b> end",
    );
    expect(item?.text).toBe("A bold code link alt text raw end");
  });

  it("ignores headings in fenced and indented code", () => {
    const text = "```md\n# not a heading\n```\n\n    # nor this\n\n# Real\n";
    expect(outlineMarkdown(text).map((i) => i.text)).toEqual(["Real"]);
  });

  it("ignores front matter, with real line numbers afterwards", () => {
    const text = "---\n# not a heading\ntitle: x\n---\n# Real\n";
    expect(outlineMarkdown(text)).toEqual([
      { level: 1, text: "Real", line: 5, from: text.indexOf("# Real") },
    ]);
  });

  it("does not treat a front matter fence as a setext underline", () => {
    expect(outlineMarkdown("---\na: b\n---\n")).toEqual([]);
  });

  it("finds headings nested in block quotes and lists", () => {
    const items = outlineMarkdown("> ## Quoted\n\n- ## Listed\n");
    expect(items.map((i) => [i.level, i.text, i.line])).toEqual([
      [2, "Quoted", 1],
      [2, "Listed", 3],
    ]);
  });

  it("returns an empty outline for an empty document", () => {
    expect(outlineMarkdown("")).toEqual([]);
  });
});
