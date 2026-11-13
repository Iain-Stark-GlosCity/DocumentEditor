import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { outlineFromState } from "./outline";

function stateOf(text: string) {
  return EditorState.create({ doc: text, extensions: [markdown({ base: markdownLanguage })] });
}

function outline(text: string) {
  return outlineFromState(stateOf(text));
}

describe("outlineFromState", () => {
  it("returns ATX and setext headings with level, line and offset", () => {
    const text = "# One\n\nText\n\nTwo\n===\n\nThree\n---\n\n### Four ###\n";
    expect(outline(text)).toEqual([
      { level: 1, text: "One", line: 1, from: 0 },
      { level: 1, text: "Two", line: 5, from: text.indexOf("Two") },
      { level: 2, text: "Three", line: 8, from: text.indexOf("Three") },
      { level: 3, text: "Four", line: 11, from: text.indexOf("### Four") },
    ]);
  });

  it("strips inline formatting", () => {
    const [item] = outline(
      "## A *bold* `code` [link](http://x.example) ![alt text](i.png) <b>raw</b> end",
    );
    expect(item?.text).toBe("A bold code link alt text raw end");
  });

  it("keeps reference link text, autolinks and unescapes", () => {
    const [item] = outline("# See [the docs][ref] and <http://a.example> \\*not bold\\*\n");
    expect(item?.text).toBe("See the docs and http://a.example *not bold*");
  });

  it("ignores headings in fenced and indented code", () => {
    const text = "```md\n# not a heading\n```\n\n    # nor this\n\n# Real\n";
    expect(outline(text).map((i) => i.text)).toEqual(["Real"]);
  });

  it("ignores front matter, with real line numbers afterwards", () => {
    const text = "---\n# not a heading\ntitle: x\n---\n# Real\n";
    expect(outline(text)).toEqual([
      { level: 1, text: "Real", line: 5, from: text.indexOf("# Real") },
    ]);
  });

  it("does not treat a front matter fence as a setext underline", () => {
    expect(outline("---\na: b\n---\n")).toEqual([]);
  });

  it("finds headings nested in block quotes and lists", () => {
    const items = outline("> ## Quoted\n\n- ## Listed\n");
    expect(items.map((i) => [i.level, i.text, i.line])).toEqual([
      [2, "Quoted", 1],
      [2, "Listed", 3],
    ]);
  });

  it("returns an empty outline for an empty document", () => {
    expect(outline("")).toEqual([]);
  });

  it("stays within a time bound on a 1 MB document and finds every heading", () => {
    const section =
      "## Section heading\n\n" + "Some body text for the section. ".repeat(20) + "\n\n";
    const count = Math.ceil((1024 * 1024) / section.length);
    const state = stateOf(section.repeat(count));

    // A request never blocks for long, even when the tree is unfinished.
    const started = performance.now();
    const partial = outlineFromState(state);
    expect(performance.now() - started).toBeLessThan(500);
    expect(partial.length).toBeLessThanOrEqual(count);

    // Once the parser has finished, the walk itself is quick and complete.
    expect(ensureSyntaxTree(state, state.doc.length, 20_000)).not.toBeNull();
    const walked = performance.now();
    const items = outlineFromState(state);
    expect(performance.now() - walked).toBeLessThan(1000);
    expect(items).toHaveLength(count);
  }, 30_000);
});
