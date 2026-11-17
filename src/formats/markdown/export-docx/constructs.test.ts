import { describe, expect, it } from "vitest";
import { inspectDocxBytes } from "../../docx/inspect";
import { child, descendants, parseXml, type XElement } from "../../docx/xml";
import { degradedImages } from "./index";
import { xmlSafe } from "./xml-text";
import { bmpBytes, gifBytes, jpegBytes, pngBytes, SVG_BYTES, WEBP_BYTES } from "./test-images";
import {
  bodyParagraphs,
  contextWith,
  exportMarkdown,
  fullView,
  partsOf,
  styleOf,
  viewBody,
  wordText,
  xmlRoot,
} from "./test-support";

const runProps = (p: XElement) =>
  descendants(p, "w:r").map((r) => ({
    text: wordText(r),
    props: (child(r, "w:rPr")?.children ?? []).flatMap((c) =>
      typeof c === "string" ? [] : [c.name === "w:rStyle" ? `style=${c.attrs["w:val"]}` : c.name],
    ),
  }));

async function noWarnings(bytes: Uint8Array): Promise<void> {
  const findings = await inspectDocxBytes(bytes, { path: "x.docx" });
  expect(findings.filter((f) => f.severity !== "info").map((f) => f.rule)).toEqual([]);
}

describe("headings", () => {
  it("uses Heading 1 to 6, never Title, with bookmarks named like the preview's ids", async () => {
    const md = "# Top\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n# Top";
    const bytes = await exportMarkdown(md);
    const paragraphs = bodyParagraphs(bytes);
    expect(paragraphs.map(styleOf)).toEqual([
      "Heading1",
      "Heading2",
      "Heading3",
      "Heading4",
      "Heading5",
      "Heading6",
      "Heading1",
    ]);
    const names = descendants(xmlRoot(partsOf(bytes)["word/document.xml"]), "w:bookmarkStart").map(
      (b) => b.attrs["w:name"],
    );
    expect(names).toEqual(["top", "two", "three", "four", "five", "six", "top-1"]);
    expect(partsOf(bytes)["word/document.xml"]).not.toContain('w:val="Title"');
    await noWarnings(bytes);
  });

  it("links #fragments to the bookmark on the heading, decoding them as the preview does", async () => {
    const md =
      "# Café au lait\n\n## Results & notes\n\n[a](#caf%C3%A9-au-lait) [b](#results--notes) [c](#missing)";
    const bytes = await exportMarkdown(md);
    const doc = xmlRoot(partsOf(bytes)["word/document.xml"]);
    const links = descendants(doc, "w:hyperlink").map((h) => [h.attrs["w:anchor"], wordText(h)]);
    expect(links).toEqual([
      ["café-au-lait", "a"],
      ["results--notes", "b"],
    ]);
    // A fragment that points nowhere keeps its text and nothing else.
    expect(wordText(bodyParagraphs(bytes)[2]!)).toBe("a b c");
  });

  it("gives headings Word cannot name a hidden bookmark of their own", async () => {
    const md = `# 2024 plans\n\n# ${"long ".repeat(20)}\n\n[x](#2024-plans)`;
    const bytes = await exportMarkdown(md);
    const doc = xmlRoot(partsOf(bytes)["word/document.xml"]);
    const names = descendants(doc, "w:bookmarkStart").map((b) => b.attrs["w:name"]);
    expect(names).toEqual(["_Heading_1", "_Heading_2"]);
    expect(descendants(doc, "w:hyperlink")[0]!.attrs["w:anchor"]).toBe("_Heading_1");
    await noWarnings(bytes);
  });

  it("includes a footnote's number in the slug, as the preview's heading id does", async () => {
    const bytes = await exportMarkdown("# Title[^a]\n\n[x](#title1)\n\n[^a]: Note.");
    const doc = xmlRoot(partsOf(bytes)["word/document.xml"]);
    expect(descendants(doc, "w:hyperlink")[0]!.attrs["w:anchor"]).toBe("title1");
  });
});

describe("inline formatting", () => {
  it("writes italic, bold, strikethrough and the Code character style", async () => {
    const bytes = await exportMarkdown("*i* **b** ~~s~~ `c` ***bi***");
    const runs = runProps(bodyParagraphs(bytes)[0]!).filter((r) => r.text.trim() !== "");
    expect(runs).toEqual([
      { text: "i", props: ["w:i", "w:iCs"] },
      { text: "b", props: ["w:b", "w:bCs"] },
      { text: "s", props: ["w:strike"] },
      { text: "c", props: ["style=Code"] },
      { text: "bi", props: ["w:b", "w:bCs", "w:i", "w:iCs"] },
    ]);
  });

  it("turns hard breaks into line breaks and soft breaks into spaces", async () => {
    const bytes = await exportMarkdown("one\ntwo  \nthree\\\nfour");
    expect(wordText(bodyParagraphs(bytes)[0]!)).toBe("one two\nthree\nfour");
  });

  it("keeps tabs as Word tabs", async () => {
    const bytes = await exportMarkdown("a\tb");
    expect(descendants(bodyParagraphs(bytes)[0]!, "w:tab")).toHaveLength(1);
  });

  it("keeps inline maths as its source, in italic (known limitation: no Word equations)", async () => {
    const bytes = await exportMarkdown("Area $\\pi r^2$ and $$E=mc^2$$ but costs $5 and $10.");
    const runs = runProps(bodyParagraphs(bytes)[0]!);
    expect(runs).toContainEqual({ text: "$\\pi r^2$", props: ["w:i", "w:iCs"] });
    expect(runs).toContainEqual({ text: "$$E=mc^2$$", props: ["w:i", "w:iCs"] });
    expect(wordText(bodyParagraphs(bytes)[0]!)).toContain("costs $5 and $10.");
  });
});

describe("links", () => {
  it("makes web and mail addresses hyperlinks in the Hyperlink style, with external relationships", async () => {
    const md =
      "[site](https://example.com/a?b=1) [mail](mailto:a@example.com) <https://auto.example> www.bare.example and https://bare.example/x.";
    const bytes = await exportMarkdown(md);
    const parts = partsOf(bytes);
    const rels = xmlRoot(parts["word/_rels/document.xml.rels"]);
    const targets = new Map(descendants(rels, "pr:Relationship").map((r) => [r.attrs["Id"], r]));
    const links = descendants(xmlRoot(parts["word/document.xml"]), "w:hyperlink").map((h) => {
      const rel = targets.get(h.attrs["r:id"]);
      expect(rel?.attrs["TargetMode"]).toBe("External");
      expect(descendants(h, "w:rStyle").every((s) => s.attrs["w:val"] === "Hyperlink")).toBe(true);
      return [wordText(h), rel?.attrs["Target"]];
    });
    expect(links).toEqual([
      ["site", "https://example.com/a?b=1"],
      ["mail", "mailto:a@example.com"],
      ["https://auto.example", "https://auto.example"],
      ["www.bare.example", "http://www.bare.example"],
      ["https://bare.example/x", "https://bare.example/x"],
    ]);
  });

  it("keeps only the text of other links, with the address in brackets when it differs", async () => {
    const md =
      "[guide](docs/guide.md) [docs/x.md](docs/x.md) [run](javascript:alert(1)) [f](file:///c:/a.txt)";
    const bytes = await exportMarkdown(md);
    expect(descendants(xmlRoot(partsOf(bytes)["word/document.xml"]), "w:hyperlink")).toEqual([]);
    expect(wordText(bodyParagraphs(bytes)[0]!)).toBe(
      "guide (docs/guide.md) docs/x.md run (javascript:alert(1)) f (file:///c:/a.txt)",
    );
  });

  it("formats text inside links and resolves reference links", async () => {
    const md =
      '[**bold** link][ref] and [`code`](https://c.example)\n\n[ref]: https://ref.example "Title"';
    const bytes = await exportMarkdown(md);
    const body = await viewBody(bytes);
    expect(body).toContain("[**bold** link](https://ref.example)");
    expect(body).toContain('[<span font="Consolas" no-proof>code</span>](https://c.example)');
  });
});

describe("images", () => {
  const assets = {
    "a.png": pngBytes(1200, 600),
    "b.jpg": jpegBytes(300, 200),
    "c.gif": gifBytes(40, 20),
    "d.bmp": bmpBytes(100, -50),
    // The extension lies: the bytes decide.
    "e.png": jpegBytes(10, 10),
    "f.svg": SVG_BYTES,
    "g.webp": WEBP_BYTES,
    "h.png": pngBytes(5, 5).slice(0, 18),
  };
  const md = [
    '![Wide](a.png) ![Photo](b.jpg "A title") ![Anim](c.gif) ![Bitmap](d.bmp) ![Liar](e.png)',
    "![Vector](f.svg) ![Modern](g.webp) ![Broken](h.png) ![Gone](missing.png) ![Remote](https://example.com/x.png) ![](nothing.png)",
  ].join("\n\n");

  it("embeds PNG, JPEG, GIF and BMP inline, sized from their headers and scaled to fit", async () => {
    const bytes = await exportMarkdown(md, assets);
    const parts = partsOf(bytes);
    const doc = xmlRoot(parts["word/document.xml"]);
    const drawings = descendants(doc, "wp:inline").map((inline) => {
      const extent = child(inline, "wp:extent")!;
      const docPr = child(inline, "wp:docPr")!;
      return {
        width: Number(extent.attrs["cx"]) / 9525,
        height: Number(extent.attrs["cy"]) / 9525,
        descr: docPr.attrs["descr"],
        title: docPr.attrs["title"],
      };
    });
    expect(drawings).toEqual([
      { width: 576, height: 288, descr: "Wide", title: undefined },
      { width: 300, height: 200, descr: "Photo", title: "A title" },
      { width: 40, height: 20, descr: "Anim", title: undefined },
      { width: 100, height: 50, descr: "Bitmap", title: undefined },
      { width: 10, height: 10, descr: "Liar", title: undefined },
    ]);
    const media = Object.keys(parts)
      .filter((n) => n.startsWith("word/media/"))
      .sort();
    expect(media.map((n) => n.slice(n.lastIndexOf("."))).sort()).toEqual([
      ".bmp",
      ".gif",
      ".jpg",
      ".jpg",
      ".png",
    ]);
    await noWarnings(bytes);
  });

  it("writes every other picture as its alternative text, in italic brackets", async () => {
    const bytes = await exportMarkdown(md, assets);
    const second = bodyParagraphs(bytes)[1]!;
    expect(wordText(second)).toBe("[Vector] [Modern] [Broken] [Gone] [Remote] [Image]");
    for (const run of runProps(second).filter((r) => r.text.startsWith("["))) {
      expect(run.props).toContain("w:i");
    }
  });

  it("lists the degraded pictures and why", async () => {
    const list = await degradedImages(md, contextWith(assets).readAsset);
    expect(list).toEqual([
      { url: "f.svg", alt: "Vector", reason: "unsupported" },
      { url: "g.webp", alt: "Modern", reason: "unsupported" },
      { url: "h.png", alt: "Broken", reason: "unreadable" },
      { url: "missing.png", alt: "Gone", reason: "unavailable" },
      { url: "https://example.com/x.png", alt: "Remote", reason: "unavailable" },
      { url: "nothing.png", alt: "", reason: "unavailable" },
    ]);
  });

  it("never asks for a remote picture, and survives a reader that throws", async () => {
    const asked: string[] = [];
    const bytes = await exportMarkdown(
      "![a](https://x.example/a.png) ![b](//x.example/b.png) ![c](c.png)",
      {},
      {
        readAsset: async (reference) => {
          asked.push(reference);
          throw new Error("disk on fire");
        },
      },
    );
    expect(asked).toEqual(["c.png"]);
    expect(wordText(bodyParagraphs(bytes)[0]!)).toBe("[a] [b] [c]");
  });
});

describe("lists", () => {
  it("gives each list its own numbering, so separate lists restart at their own start", async () => {
    const md = "1. a\n2. b\n\npara\n\n3. c\n4. d\n\npara\n\n- x\n- y";
    const bytes = await exportMarkdown(md);
    const body = await viewBody(bytes);
    expect(body).toMatch(/1\. a .*list=2 level=1/);
    expect(body).toMatch(/3\. c .*list=3 level=1/);
    expect(body).toMatch(/4\. d .*list=3 level=1/);
    expect(body).toMatch(/- x .*list=4 level=1/);
    await noWarnings(bytes);
  });

  it("nests to any depth, clamped to Word's nine levels and to a sane indent", async () => {
    const md = Array.from({ length: 12 }, (_, i) => `${"  ".repeat(i)}- level ${i}`).join("\n");
    const bytes = await exportMarkdown(md);
    const levels = bodyParagraphs(bytes).map((p) =>
      Number(descendants(p, "w:ilvl")[0]?.attrs["w:val"]),
    );
    expect(levels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8]);
    await noWarnings(bytes);
  });

  it("marks task items with check boxes", async () => {
    const bytes = await exportMarkdown("- [ ] open\n- [x] done\n- plain");
    expect(bodyParagraphs(bytes).map(wordText)).toEqual(["\u2610 open", "\u2611 done", "plain"]);
  });

  it("keeps the space between items of a loose list and not of a tight one", async () => {
    const tight = bodyParagraphs(await exportMarkdown("- a\n- b"));
    const loose = bodyParagraphs(await exportMarkdown("- a\n\n- b"));
    const spacing = (p: XElement) => descendants(p, "w:contextualSpacing")[0]?.attrs["w:val"];
    expect(tight.map(spacing)).toEqual([undefined, undefined]);
    expect(loose.map(spacing)).toEqual(["false", "false"]);
  });

  it("indents further paragraphs and code blocks of an item to its text", async () => {
    const md = "1. First\n\n   More about it.\n\n   ```\n   code\n   ```\n2. Second";
    const bytes = await exportMarkdown(md);
    const paragraphs = bodyParagraphs(bytes);
    expect(paragraphs.map(styleOf)).toEqual([
      "ListParagraph",
      "ListParagraph",
      "SourceCode",
      "ListParagraph",
    ]);
    expect(descendants(paragraphs[1]!, "w:numPr")).toEqual([]);
    expect(descendants(paragraphs[2]!, "w:ind")[0]?.attrs["w:left"]).toBe("720");
  });

  it("numbers an item that starts with a block on an empty paragraph of its own", async () => {
    const bytes = await exportMarkdown("- ```\n  code\n  ```\n-\n- > quoted");
    const paragraphs = bodyParagraphs(bytes);
    expect(
      paragraphs.map((p) => [styleOf(p), descendants(p, "w:numPr").length, wordText(p)]),
    ).toEqual([
      ["ListParagraph", 1, ""],
      ["SourceCode", 0, "code"],
      ["ListParagraph", 1, ""],
      ["ListParagraph", 1, ""],
      ["Quote", 0, "quoted"],
    ]);
  });
});

describe("block quotes", () => {
  it("uses the Quote style, indenting nested quotes further, with quoted lists and code", async () => {
    const md = "> one\n>\n> > two\n> > > three\n>\n> - item\n>\n> ```\n> code\n> ```";
    const bytes = await exportMarkdown(md);
    const paragraphs = bodyParagraphs(bytes);
    const indent = (p: XElement) => descendants(p, "w:ind")[0]?.attrs["w:left"];
    expect(paragraphs.map((p) => [styleOf(p), indent(p), wordText(p)])).toEqual([
      ["Quote", undefined, "one"],
      ["Quote", "1440", "two"],
      ["Quote", "2160", "three"],
      ["Quote", undefined, "item"],
      ["SourceCode", "720", "code"],
    ]);
    expect(descendants(paragraphs[3]!, "w:numPr")).toHaveLength(1);
    await noWarnings(bytes);
  });
});

describe("code blocks", () => {
  it("keeps line breaks, tabs and leading spaces exactly, and drops the language", async () => {
    const md = "```ts\nfunction f() {\n\tif (x)\n        return  1;\n}\n\n```";
    const bytes = await exportMarkdown(md);
    const [p] = bodyParagraphs(bytes);
    expect(styleOf(p!)).toBe("SourceCode");
    expect(wordText(p!)).toBe("function f() {\n\tif (x)\n        return  1;\n}\n");
    expect(partsOf(bytes)["word/document.xml"]).not.toContain(">ts<");
    expect(descendants(p!, "w:t").every((t) => t.attrs["xml:space"] === "preserve")).toBe(true);
  });

  it("styles code blocks monospace, small, shaded and without proofing", async () => {
    const styles = xmlRoot(partsOf(await exportMarkdown("```\nx\n```"))["word/styles.xml"]);
    const code = descendants(styles, "w:style").find((s) => s.attrs["w:styleId"] === "SourceCode")!;
    expect(descendants(code, "w:rFonts")[0]?.attrs["w:ascii"]).toBe("Consolas");
    expect(descendants(code, "w:noProof")).toHaveLength(1);
    expect(descendants(code, "w:shd")[0]?.attrs["w:fill"]).toBe("F2F2F2");
  });

  it("keeps Mermaid and display maths as their source (known limitation)", async () => {
    // Diagrams and equations are not drawn in Word; the reader gets the source as code.
    const md = "```mermaid\ngraph TD; A-->B\n```\n\n$$\n\\int_0^1 x\\,dx\n$$";
    const paragraphs = bodyParagraphs(await exportMarkdown(md));
    expect(paragraphs.map((p) => [styleOf(p), wordText(p)])).toEqual([
      ["SourceCode", "graph TD; A-->B"],
      ["SourceCode", "\\int_0^1 x\\,dx"],
    ]);
  });
});

describe("tables", () => {
  const md =
    "| Name | Amount | Note |\n| :-- | --: | :-: |\n| Tea | 1.50 | hot |\n| Cake with a long description | 3 |";

  it("writes a Table Grid table at full width with a repeated, shaded, bold header row", async () => {
    const bytes = await exportMarkdown(md);
    const doc = xmlRoot(partsOf(bytes)["word/document.xml"]);
    const table = descendants(doc, "w:tbl")[0]!;
    expect(descendants(table, "w:tblStyle")[0]?.attrs["w:val"]).toBe("TableGrid");
    expect(descendants(table, "w:tblW")[0]?.attrs).toMatchObject({
      "w:type": "pct",
      "w:w": "5000",
    });
    const rows = descendants(table, "w:tr");
    expect(rows).toHaveLength(3);
    expect(descendants(rows[0]!, "w:tblHeader")).toHaveLength(1);
    expect(descendants(rows[1]!, "w:tblHeader")).toHaveLength(0);
    expect(descendants(rows[0]!, "w:shd")).toHaveLength(3);
    expect(descendants(rows[0]!, "w:b")).toHaveLength(3);
    expect(descendants(rows[1]!, "w:b")).toHaveLength(0);
    await noWarnings(bytes);
  });

  it("aligns columns from the delimiter row and pads short rows", async () => {
    const doc = xmlRoot(partsOf(await exportMarkdown(md))["word/document.xml"]);
    const rows = descendants(doc, "w:tr");
    const align = descendants(rows[1]!, "w:tc").map(
      (c) => descendants(c, "w:jc")[0]?.attrs["w:val"],
    );
    expect(align).toEqual(["left", "right", "center"]);
    expect(descendants(rows[2]!, "w:tc")).toHaveLength(3);
  });

  it("weights column widths by content and fills the text column exactly", async () => {
    const doc = xmlRoot(partsOf(await exportMarkdown(md))["word/document.xml"]);
    const grid = descendants(doc, "w:gridCol").map((g) => Number(g.attrs["w:w"]));
    expect(grid.reduce((a, b) => a + b, 0)).toBe(9026);
    expect(grid[0]).toBeGreaterThan(grid[1]!);
    const cells = descendants(descendants(doc, "w:tr")[0]!, "w:tcW").map((w) =>
      Number(w.attrs["w:w"]),
    );
    expect(cells).toEqual(grid);
  });

  it("indents a table in a list and narrows it to fit; separates adjacent tables", async () => {
    const t = "| a | b |\n| - | - |\n| 1 | 2 |";
    const bytes = await exportMarkdown(`- item\n\n  ${t.replace(/\n/g, "\n  ")}\n\n${t}\n\n${t}`);
    const doc = xmlRoot(partsOf(bytes)["word/document.xml"]);
    const [first, second] = descendants(doc, "w:tbl");
    expect(descendants(first!, "w:tblInd")[0]?.attrs["w:w"]).toBe("720");
    expect(descendants(first!, "w:tblW")[0]?.attrs).toMatchObject({
      "w:type": "dxa",
      "w:w": "8306",
    });
    expect(descendants(second!, "w:tblInd")).toEqual([]);
    const body = descendants(doc, "w:body")[0]!.children.filter(
      (c): c is XElement => typeof c !== "string",
    );
    // Each pair of adjacent tables is kept apart by an empty paragraph.
    expect(body.map((c) => c.name)).toEqual([
      "w:p",
      "w:tbl",
      "w:p",
      "w:tbl",
      "w:p",
      "w:tbl",
      "w:sectPr",
    ]);
    await noWarnings(bytes);
  });
});

describe("other blocks", () => {
  it("writes a thematic break as a paragraph with a bottom border", async () => {
    const [, rule] = bodyParagraphs(await exportMarkdown("above\n\n***\n\nbelow"));
    expect(descendants(rule!, "w:bottom")[0]?.attrs).toMatchObject({ "w:val": "single" });
    expect(wordText(rule!)).toBe("");
  });

  it("turns raw HTML into plain text and never passes markup through", async () => {
    const md =
      '<div class="x"><p>Para <b>one</b> &mdash; ok<br>next</p><p>two</p><script>alert(1)</script></div>\n\n<!-- hidden -->\n\nInline <span style="color:red">red</span> &lt;tag&gt;.';
    const bytes = await exportMarkdown(md);
    const doc = partsOf(bytes)["word/document.xml"]!;
    expect(doc).not.toMatch(/&lt;(b|span|div|script)|alert|hidden|color:red/);
    expect(bodyParagraphs(bytes).map(wordText)).toEqual([
      "Para one \u2014 ok\nnext",
      "two",
      "Inline red <tag>.",
    ]);
  });
});

describe("footnotes", () => {
  it("writes real Word footnotes, a note referred to twice twice, with block content", async () => {
    const md =
      "One[^a] two[^b] again[^a].\n\n[^a]: First *note*.\n\n[^b]: Second.\n\n    Indented more.\n\n[^unused]: Never referred to.";
    const bytes = await exportMarkdown(md);
    const parts = partsOf(bytes);
    const refs = descendants(xmlRoot(parts["word/document.xml"]), "w:footnoteReference").map(
      (r) => r.attrs["w:id"],
    );
    expect(refs).toEqual(["1", "2", "3"]);
    const notes = descendants(xmlRoot(parts["word/footnotes.xml"]), "w:footnote").filter(
      (n) => n.attrs["w:type"] === undefined,
    );
    expect(notes.map((n) => [n.attrs["w:id"], descendants(n, "w:p").map(wordText)])).toEqual([
      ["1", ["First note."]],
      ["2", ["Second.", "Indented more."]],
      ["3", ["First note."]],
    ]);
    for (const note of notes) {
      expect(descendants(note, "w:p").every((p) => styleOf(p) === "FootnoteText")).toBe(true);
      expect(descendants(note, "w:footnoteRef")).toHaveLength(1);
    }
    expect(parts["word/footnotes.xml"]).not.toContain("Never referred to");
    await noWarnings(bytes);
  });

  it("keeps a footnote reference inside a footnote as text, and tables in notes as text", async () => {
    const md =
      "Text[^a].\n\n[^a]: See[^b].\n\n    | x | y |\n    | - | - |\n    | 1 | 2 |\n\n[^b]: Other.";
    const parts = partsOf(await exportMarkdown(md));
    const note = descendants(xmlRoot(parts["word/footnotes.xml"]), "w:footnote").find(
      (n) => n.attrs["w:id"] === "1",
    )!;
    expect(descendants(note, "w:p").map(wordText)).toEqual(["See[b].", "x | y", "1 | 2"]);
    expect(descendants(note, "w:tbl")).toEqual([]);
  });
});

describe("page and document defaults", () => {
  it("sets up A4 with 2.54 cm margins and Calibri 11 pt, 1.15 spacing, 8 pt after, British English", async () => {
    const parts = partsOf(await exportMarkdown("x"));
    const doc = xmlRoot(parts["word/document.xml"]);
    expect(descendants(doc, "w:pgSz")[0]?.attrs).toMatchObject({ "w:w": "11906", "w:h": "16838" });
    expect(descendants(doc, "w:pgMar")[0]?.attrs).toMatchObject({
      "w:top": "1440",
      "w:right": "1440",
      "w:bottom": "1440",
      "w:left": "1440",
    });
    const defaults = descendants(xmlRoot(parts["word/styles.xml"]), "w:docDefaults")[0]!;
    expect(descendants(defaults, "w:rFonts")[0]?.attrs["w:ascii"]).toBe("Calibri");
    expect(descendants(defaults, "w:sz")[0]?.attrs["w:val"]).toBe("22");
    expect(descendants(defaults, "w:lang")[0]?.attrs["w:val"]).toBe("en-GB");
    expect(descendants(defaults, "w:spacing")[0]?.attrs).toMatchObject({
      "w:after": "160",
      "w:line": "276",
      "w:lineRule": "auto",
    });
  });

  it("titles the document from the front matter, else from the export context; front matter is not body text", async () => {
    const withFront = partsOf(
      await exportMarkdown(
        "---\ntitle: From front\nauthor: Ann Example\ndate: 2024-01-02\n---\n\nBody",
      ),
    );
    expect(withFront["docProps/core.xml"]).toContain("<dc:title>From front</dc:title>");
    // An author the document itself names is kept; nothing else identifies anyone.
    expect(withFront["docProps/core.xml"]).toContain("<dc:creator>Ann Example</dc:creator>");
    expect(withFront["docProps/core.xml"]).not.toContain("lastModifiedBy>");
    expect(withFront["word/document.xml"]).not.toContain("From front");
    const plain = partsOf(await exportMarkdown("Body"));
    expect(plain["docProps/core.xml"]).toContain("<dc:title>report</dc:title>");
    expect(plain["docProps/core.xml"]).not.toContain("creator");
  });
});

describe("robustness", () => {
  it("writes a valid document with one empty paragraph for empty input", async () => {
    for (const md of ["", "\n\n", "---\ntitle: x\n---\n", "[a]: https://x.example"]) {
      const bytes = await exportMarkdown(md);
      const paragraphs = bodyParagraphs(bytes);
      expect(paragraphs).toHaveLength(1);
      expect(wordText(paragraphs[0]!)).toBe("");
      await noWarnings(bytes);
    }
  });

  it("removes characters XML forbids from text, alt text, link text and code", async () => {
    const md =
      "a\u0001b\u000bc \uD800d\uFFFF [l\u0002nk](https://x.example) ![al\u0003t](m.png) `c\u0004d`\n\n```\n\u0005code\n```\n\n# He\u0006ading";
    const bytes = await exportMarkdown(md);
    const parts = partsOf(bytes);
    for (const [name, text] of Object.entries(parts)) {
      if (!/\.(xml|rels)$/.test(name)) continue;
      expect(xmlSafe(text), name).toBe(text);
      expect(parseXml(text).problems, name).toEqual([]);
    }
    expect(bodyParagraphs(bytes).map(wordText)).toEqual(["abc d lnk [alt] cd", "code", "Heading"]);
  });

  it("never throws on odd Markdown", async () => {
    const odd = [
      ">".repeat(2000) + " deep",
      "*".repeat(5000) + "x" + "*".repeat(5000),
      "[".repeat(3000) + "x" + "](u)".repeat(3000),
      Array.from({ length: 60 }, (_, i) => `${"  ".repeat(i)}1. n`).join("\n"),
      "| a |\n| - |\n" + "| b | c | d |\n".repeat(50),
      "[^x]\n\n[^x]: [^x]",
      "<table><tr><td>x</td></tr></table>",
      "x".repeat(300_000),
      "\u0000\u0000",
      "- [ ]\n- [x]",
      "#",
      "![](<>)",
    ];
    for (const md of odd) {
      const bytes = await exportMarkdown(md);
      expect(bytes.length).toBeGreaterThan(1000);
      await noWarnings(bytes);
    }
  }, 60_000);

  it("keeps the view legible on its own output", async () => {
    const view = await fullView(await exportMarkdown("# A\n\nB"));
    expect(view).not.toContain("<!-- raw");
    expect(view).not.toContain("<!-- error");
  });

  it("stays roughly linear in the document's size", async () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        i % 40 === 0
          ? "| a | b |\n| - | - |\n| 1 | 2 |"
          : `Paragraph ${i} with *some* **bold** text and a [link](https://example.com/${i}).`,
      ).join("\n\n");
    const time = async (n: number) => {
      const start = performance.now();
      await exportMarkdown(make(n));
      return performance.now() - start;
    };
    await time(500); // warm up
    const small = await time(2_500);
    const large = await time(20_000);
    // Linear would be 8 times; quadratic 64.
    expect(large / small).toBeLessThan(20);
  }, 120_000);
});
