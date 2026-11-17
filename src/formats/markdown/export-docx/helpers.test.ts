import { describe, expect, it } from "vitest";
import { readFrontMatter } from "./front-matter";
import { htmlToInline, htmlToParagraphs } from "./html-text";
import { classifyLink, encodeUri, externalUrl } from "./links";
import { numberingConfig } from "./lists";
import { parseMarkdown, plainText } from "./parse";
import { runSafe, xmlSafe } from "./xml-text";

describe("xmlSafe", () => {
  it("removes the characters XML 1.0 forbids and keeps everything else", () => {
    expect(xmlSafe("a\u0000b\u0001c\u0008d\u000Be\u000Cf\u000Eg\u001Fh")).toBe("abcdefgh");
    expect(xmlSafe("tab\there\nline\rcr")).toBe("tab\there\nline\rcr");
    expect(xmlSafe("x\uFFFEy\uFFFFz")).toBe("xyz");
    expect(xmlSafe("é ü 中文 😀")).toBe("é ü 中文 😀");
  });

  it("removes unpaired surrogates but keeps pairs", () => {
    expect(xmlSafe("a\uD800b")).toBe("ab");
    expect(xmlSafe("a\uDC00b")).toBe("ab");
    expect(xmlSafe("a\uD83D\uDE00b")).toBe("a\uD83D\uDE00b");
    expect(xmlSafe("\uD83D")).toBe("");
  });

  it("runSafe also drops carriage returns", () => {
    expect(runSafe("a\r\nb")).toBe("a\nb");
  });
});

describe("links", () => {
  const anchors = new Map([
    ["results", "results"],
    ["café", "café"],
  ]);

  it("makes http, https and mailto addresses hyperlinks", () => {
    expect(classifyLink("https://example.com/x?y=1#z", "x", anchors)).toEqual({
      kind: "external",
      url: "https://example.com/x?y=1#z",
    });
    expect(classifyLink("HTTP://example.com", "x", anchors).kind).toBe("external");
    expect(classifyLink("mailto:someone@example.com", "x", anchors).kind).toBe("external");
  });

  it("links fragments to heading bookmarks, decoding them first", () => {
    expect(classifyLink("#results", "see", anchors)).toEqual({
      kind: "internal",
      anchor: "results",
    });
    expect(classifyLink("#caf%C3%A9", "see", anchors)).toEqual({
      kind: "internal",
      anchor: "café",
    });
    expect(classifyLink("#nowhere", "see", anchors)).toEqual({ kind: "none" });
  });

  it("keeps the text of other links, with the address when it adds something", () => {
    expect(classifyLink("docs/a.md", "the docs", anchors)).toEqual({
      kind: "none",
      address: "docs/a.md",
    });
    expect(classifyLink("docs/a.md", "docs/a.md", anchors)).toEqual({ kind: "none" });
    expect(classifyLink("file:///c:/x", "x", anchors)).toEqual({
      kind: "none",
      address: "file:///c:/x",
    });
    expect(classifyLink("javascript:alert(1)", "x", anchors).kind).toBe("none");
    expect(classifyLink(`data:text/plain,${"a".repeat(300)}`, "x", anchors)).toEqual({
      kind: "none",
    });
  });

  it("refuses web addresses without a host and encodes characters a URI may not hold", () => {
    expect(externalUrl("https://")).toBeNull();
    expect(externalUrl("mailto:")).toBeNull();
    expect(externalUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(encodeUri("https://ex.com/é?q=<x>&r=%41&s=%zz")).toBe(
      "https://ex.com/%C3%A9?q=%3Cx%3E&r=%41&s=%25zz",
    );
  });
});

describe("html to text", () => {
  it("strips tags, decodes entities and drops comments, scripts and styles", () => {
    expect(
      htmlToParagraphs(
        "<div>Fish &amp; chips &copy; <!-- no --><script>x()</script><style>p{}</style>2024</div>",
      ),
    ).toEqual([[{ kind: "text", text: "Fish & chips © 2024" }]]);
  });

  it("splits paragraphs at block elements and keeps <br> as a line break", () => {
    expect(htmlToParagraphs("<p>One<br>two</p>\n<p>Three</p>")).toEqual([
      [{ kind: "text", text: "One" }, { kind: "break" }, { kind: "text", text: "two" }],
      [{ kind: "text", text: "Three" }],
    ]);
  });

  it("gives nothing for a comment or an empty element", () => {
    expect(htmlToParagraphs("<!-- a comment -->")).toEqual([]);
    expect(htmlToParagraphs("<div></div>")).toEqual([]);
  });

  it("keeps the spaces of inline html, which sits in a sentence", () => {
    expect(htmlToInline("<b>")).toEqual([]);
    expect(htmlToInline("<br/>")).toEqual([{ kind: "break" }]);
    expect(htmlToInline("<span> a&lt;b </span>")).toEqual([{ kind: "text", text: " a<b " }]);
  });
});

describe("front matter", () => {
  it("reads title, author and date", () => {
    const tree = parseMarkdown(
      "---\ntitle: The plan\nauthor: [Ann, Bob]\ndate: 2024-05-01\n---\n\nBody",
    );
    expect(readFrontMatter(tree)).toEqual({
      title: "The plan",
      author: "Ann; Bob",
      date: "2024-05-01",
    });
  });

  it("ignores missing, empty and broken front matter", () => {
    expect(readFrontMatter(parseMarkdown("# No front matter"))).toEqual({});
    expect(readFrontMatter(parseMarkdown("---\n---\n\nBody"))).toEqual({});
    expect(readFrontMatter(parseMarkdown("---\ntitle: [unclosed\n---\n"))).toEqual({});
    expect(readFrontMatter(parseMarkdown("---\n- a list\n---\n"))).toEqual({});
  });
});

describe("parse", () => {
  it("reads the same constructs as the preview: GFM, maths and front matter", () => {
    const tree = parseMarkdown(
      "---\na: 1\n---\n\n~~s~~ $x$ [^1]\n\n| a |\n| - |\n| b |\n\n[^1]: n",
    );
    const types = tree.children.map((n) => n.type);
    expect(types).toEqual(["yaml", "paragraph", "table", "footnoteDefinition"]);
    expect(plainText(tree.children[1]!)).toContain("x");
  });

  it("leaves prices alone, as the preview does", () => {
    const tree = parseMarkdown("costs $5 and $10");
    expect(plainText(tree)).toBe("costs $5 and $10");
  });
});

describe("numbering", () => {
  it("defines nine levels, starting the list's own level at its start number", () => {
    const config = numberingConfig("l", { ordered: true, start: 7, level: 1, base: 720 });
    expect(config.levels).toHaveLength(9);
    expect(config.levels[1]).toMatchObject({ start: 7, text: "%2." });
    expect(config.levels[0]).toMatchObject({ start: 1 });
    expect(config.levels[1]!.style?.paragraph?.indent).toEqual({ left: 1440, hanging: 360 });
  });

  it("clamps start numbers to what Word accepts", () => {
    expect(
      numberingConfig("l", { ordered: true, start: 123456789, level: 0, base: 0 }).levels[0]!.start,
    ).toBe(32767);
  });
});
