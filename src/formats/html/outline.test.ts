import { html } from "@codemirror/lang-html";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { decodeEntities, outlineFromState, scanHeadings } from "./outline";

function stateOf(doc: string, withLanguage = true): EditorState {
  const state = EditorState.create({ doc, extensions: withLanguage ? [html()] : [] });
  if (withLanguage) ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}
const outline = (doc: string) => outlineFromState(stateOf(doc));
const brief = (doc: string) => outline(doc).map((item) => [item.level, item.text]);

describe("outline from the syntax tree", () => {
  it("lists h1 to h6 in document order with level, text, line and offset", () => {
    const doc =
      "<h1>One</h1>\n<p>x</p>\n<h2>Two</h2>\n<h3>Three</h3><h4>Four</h4>\n<h5>Five</h5><h6>Six</h6>";
    const items = outline(doc);
    expect(items.map((i) => [i.level, i.text, i.line])).toEqual([
      [1, "One", 1],
      [2, "Two", 3],
      [3, "Three", 4],
      [4, "Four", 4],
      [5, "Five", 5],
      [6, "Six", 5],
    ]);
    expect(items[1]?.from).toBe(doc.indexOf("<h2>"));
    expect(items[0]?.from).toBe(0);
  });

  it("finds headings nested in other elements", () => {
    expect(
      brief("<html><body><main><section><div><h2>Deep</h2></div></section></main></body></html>"),
    ).toEqual([[2, "Deep"]]);
  });

  it("strips inline tags and keeps their text", () => {
    expect(
      brief('<h1>Hello <b>big</b> <a href="x">link <i>text</i></a> <code>code</code></h1>'),
    ).toEqual([[1, "Hello big link text code"]]);
  });

  it("ignores attributes and decodes character references", () => {
    expect(
      brief('<h2 id="a" class="b > c">Fish &amp; chips &lt;3 &#x41;&#66; &copy;</h2>'),
    ).toEqual([[2, "Fish & chips <3 AB ©"]]);
  });

  it("collapses whitespace and line breaks", () => {
    expect(brief("<h1>\n   Spread\n   over   lines \n</h1>")).toEqual([[1, "Spread over lines"]]);
  });

  it("reads tag names case-insensitively", () => {
    expect(brief("<H1>Upper</H1><H2>Mixed</h2>")).toEqual([
      [1, "Upper"],
      [2, "Mixed"],
    ]);
  });

  it("skips comments, scripts and styles inside and around headings", () => {
    expect(
      brief(
        '<!-- <h1>commented</h1> --><script>var s = "<h2>in script</h2>";</script><style>h1{}</style><h3>Real <!-- hidden -->one<script>x()</script></h3>',
      ),
    ).toEqual([[3, "Real one"]]);
  });

  it("does not take other tags for headings", () => {
    expect(
      brief("<header>H</header><h7>x</h7><hr><hgroup><p>p</p></hgroup><th>t</th><h>x</h>"),
    ).toEqual([]);
  });

  it("includes an empty heading with empty text", () => {
    expect(brief("<h1></h1>")).toEqual([[1, ""]]);
  });

  it("ends a heading with a missing end tag at the next block", () => {
    expect(brief("<h1>Unclosed\n<p>Paragraph</p>\n<h2>Next</h2>")).toEqual([
      [1, "Unclosed"],
      [2, "Next"],
    ]);
  });

  it("cuts a very long heading", () => {
    const [item] = outline(`<h1>${"word ".repeat(200)}</h1>`);
    expect(item?.text.length).toBeLessThanOrEqual(200);
    expect(item?.text.endsWith("…")).toBe(true);
  });

  it("returns nothing for an empty document or one without headings", () => {
    expect(outline("")).toEqual([]);
    expect(outline("<p>no headings</p>")).toEqual([]);
  });

  it("copes with malformed markup", () => {
    expect(() => outline("<h1><b>x</h1></b><h2 <<>> >y</h2><h3")).not.toThrow();
  });
});

describe("outline before the grammar has loaded", () => {
  it("reads the text, so the panel is not empty", () => {
    const doc =
      "<!-- <h1>no</h1> -->\n<h1>One <b>1</b></h1>\n<script>'<h2>no</h2>'</script>\n<h2>Two</h2>";
    const items = outlineFromState(stateOf(doc, false));
    expect(items.map((i) => [i.level, i.text, i.line])).toEqual([
      [1, "One 1", 2],
      [2, "Two", 4],
    ]);
    expect(items[0]?.from).toBe(doc.indexOf("<h1>One"));
  });

  it("agrees with the tree on an ordinary document", () => {
    const doc = "<h1>A</h1><div><h2>B &amp; C</h2></div><h3>D</h3>";
    expect(scanHeadings(Text.of(doc.split("\n")))).toEqual(outline(doc));
  });
});

describe("decodeEntities", () => {
  it("decodes the common ones and leaves the rest", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&#39;&#x1F600;&unknown;&#0;&#x110000;")).toBe(
      "&<>\"'\u{1F600}&unknown;&#0;&#x110000;",
    );
  });
});
