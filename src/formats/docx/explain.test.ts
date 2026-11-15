import { describe, expect, it } from "vitest";
import { describeTwips, explainParagraph, findByLocator, parseTwips } from "./explain";
import { ANCHORED_PICTURE } from "./hand-samples";
import { handDocx, sourceFromParts } from "./test-helpers";
import { explainDocxBytes } from "./explain-bytes";
import { parseXml } from "./xml";

const STYLES = `
<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:ind w:left="720" w:firstLine="360"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListPara"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Bullets"><w:name w:val="Bullets"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>`;
const NUMBERING = `
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
  <w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;

function explain(body: string, locator = "/w:document/w:body/w:p") {
  const src = handDocx(body, { styles: STYLES, numbering: NUMBERING });
  return explainParagraph(src, "word/document.xml", locator);
}
function rowOf(e: ReturnType<typeof explain>, label: string) {
  for (const s of e!.sections) for (const r of s.rows) if (r.label === label) return r;
  throw new Error(`no row ${label}`);
}

describe("describeTwips", () => {
  it("gives centimetres and points", () => {
    expect(describeTwips(720)).toBe("1.27 cm (36 pt)");
    expect(describeTwips(0)).toBe("0 cm (0 pt)");
  });
});

describe("explainParagraph", () => {
  it("reports document defaults for an unstyled paragraph", () => {
    const e = explain("<w:p><w:r><w:t>x</w:t></w:r></w:p>");
    expect(rowOf(e, "Paragraph style").value).toBe("Normal");
    const after = rowOf(e, "Space after");
    expect(after.source?.label).toBe("Document defaults");
    expect(rowOf(e, "Line spacing").value).toBe("1.08 lines");
    expect(rowOf(e, "Left indent").value).toContain("not set");
  });

  it("takes the style's indent and shows nothing overridden", () => {
    const e = explain('<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr></w:p>');
    const left = rowOf(e, "Left indent");
    expect(left.value).toBe("1.27 cm (36 pt)");
    expect(left.source?.label).toBe('Style "Body Text"');
    expect(left.source?.part).toBe("word/styles.xml");
    expect(rowOf(e, "First line").value).toContain("first line");
    expect(rowOf(e, "Alignment").value).toBe("justified");
  });

  it("lets direct formatting beat the style and lists what it overrode", () => {
    const e = explain(
      '<w:p><w:pPr><w:pStyle w:val="Body"/><w:ind w:left="0" w:hanging="0"/></w:pPr></w:p>',
    );
    const left = rowOf(e, "Left indent");
    expect(left.value).toBe("0 cm (0 pt)");
    expect(left.source?.label).toBe("Direct formatting");
    expect(left.source?.part).toBe("word/document.xml");
    expect(left.overridden?.[0]?.source.label).toBe('Style "Body Text"');
    // Direct hanging 0 replaces the style's first-line indent.
    expect(rowOf(e, "First line").value).toBe("none");
  });

  it("applies a directly numbered paragraph's list level above the style", () => {
    const e = explain(
      '<w:p><w:pPr><w:pStyle w:val="ListPara"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>',
    );
    const left = rowOf(e, "Left indent");
    expect(left.source?.label).toBe("List level 1 (list 1)");
    expect(left.value).toBe("1.9 cm (54 pt)");
    expect(left.uncertain).toBeUndefined();
    expect(rowOf(e, "In a list").value).toContain("level 1 of list 1");
  });

  it("flags a list that comes from the style as uncertain when the order matters", () => {
    const styles = STYLES.replace(
      '<w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>',
      '<w:numPr><w:numId w:val="1"/></w:numPr><w:ind w:left="720"/></w:pPr>',
    );
    const src = handDocx('<w:p><w:pPr><w:pStyle w:val="Bullets"/></w:pPr></w:p>', {
      styles,
      numbering: NUMBERING,
    });
    const e = explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p");
    const left = rowOf(e, "Left indent");
    expect(left.uncertain).toBe(true);
    expect(left.note).toContain("list level");
  });

  it("offers to remove the paragraph's own indent only when it decides the value", () => {
    const own = explain('<w:p><w:pPr><w:pStyle w:val="Body"/><w:ind w:left="0"/></w:pPr></w:p>');
    const fix = rowOf(own, "Left indent").fix;
    expect(fix?.part).toBe("word/document.xml");
    expect(fix?.locator).toBe("/w:document/w:body/w:p/w:pPr/w:ind");
    expect(rowOf(own, "Space after").fix).toBeUndefined();
    const spaced = explain(
      '<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr></w:p>',
    );
    expect(rowOf(spaced, "Space after").fix?.locator).toBe(
      "/w:document/w:body/w:p/w:pPr/w:spacing",
    );
    expect(rowOf(spaced, "Space after").fix?.label).toBe("Remove this paragraph's own spacing");
    expect(rowOf(spaced, "Alignment").fix?.locator).toBe("/w:document/w:body/w:p/w:pPr/w:jc");
    // The repair is offered once for an element, on its first row.
    const both = explain('<w:p><w:pPr><w:spacing w:before="10" w:after="0"/></w:pPr></w:p>');
    expect(rowOf(both, "Space before").fix).toBeDefined();
    expect(rowOf(both, "Space after").fix).toBeUndefined();
    // Line spacing comes from the defaults here, so no repair is offered for it.
    expect(rowOf(spaced, "Line spacing").fix).toBeUndefined();
    const styled = explain('<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr></w:p>');
    expect(rowOf(styled, "Left indent").fix).toBeUndefined();
  });

  it("treats numId 0 as no list", () => {
    const e = explain(
      '<w:p><w:pPr><w:pStyle w:val="Bullets"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr></w:p>',
    );
    expect(() => rowOf(e, "In a list")).toThrow();
  });

  it("finds the Nth paragraph and refuses non-paragraphs and missing elements", () => {
    const body = '<w:p/><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>';
    expect(rowOf(explain(body, "/w:document/w:body/w:p[2]"), "Alignment").value).toBe("centred");
    expect(explain(body, "/w:document/w:body")).toBeNull();
    expect(explain(body, "/w:document/w:body/w:p[9]")).toBeNull();
    expect(explain(body, "nonsense")).toBeNull();
  });

  it("notes character-unit indents and tables", () => {
    const e = explain(
      '<w:tbl><w:tr><w:tc><w:p><w:pPr><w:ind w:leftChars="100"/></w:pPr></w:p></w:tc></w:tr></w:tbl>',
      "/w:document/w:body/w:tbl/w:tr/w:tc/w:p",
    );
    expect(e!.notes.join(" ")).toContain("character units");
    expect(e!.notes.join(" ")).toContain("table");
  });

  it("does not throw without styles or numbering", () => {
    const src = handDocx("<w:p/>");
    expect(explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p")).not.toBeNull();
  });
});

describe("findByLocator", () => {
  it("follows names as written", () => {
    const doc = parseXml('<a:r xmlns:a="x"><a:b/><a:b><a:c/></a:b></a:r>');
    expect(findByLocator(doc.root, "/a:r/a:b[2]/a:c")?.rawName).toBe("a:c");
  });
});

describe("parseTwips", () => {
  it("reads integers and universal measures and rejects the rest", () => {
    expect(parseTwips("720")).toBe(720);
    expect(parseTwips("-720")).toBe(-720);
    expect(parseTwips("36pt")).toBe(720);
    expect(parseTwips("1in")).toBe(1440);
    expect(parseTwips("2.54cm")).toBe(1440);
    for (const bad of ["", " ", "abc", "0x10", "1e3", "NaN", "Infinity", "12px"])
      expect(parseTwips(bad)).toBeUndefined();
  });
});

describe("explainParagraph edge cases", () => {
  it("does not read an empty or hexadecimal attribute as a number", () => {
    const e = explain(
      '<w:p><w:pPr><w:pStyle w:val="Body"/><w:ind w:left="" w:right="0x10"/></w:pPr></w:p>',
    );
    expect(rowOf(e, "Left indent").source?.label).toBe('Style "Body Text"');
    expect(rowOf(e, "Right indent").value).toBe("not set");
  });

  it("falls back to the default style when the paragraph style is not defined", () => {
    const styles = STYLES.replace(
      '<w:name w:val="Normal"/>',
      '<w:name w:val="Normal"/><w:pPr><w:ind w:left="200"/></w:pPr>',
    );
    const src = handDocx('<w:p><w:pPr><w:pStyle w:val="Gone"/></w:pPr></w:p>', { styles });
    const e = explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p");
    expect(rowOf(e, "Left indent").source?.label).toBe('Style "Normal"');
    expect(rowOf(e, "Paragraph style").value).toContain("Gone");
  });

  it("uses the paragraph's own list level with the list from the style", () => {
    const numbering = `<w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:pPr><w:ind w:left="720"/></w:pPr></w:lvl>
      <w:lvl w:ilvl="1"><w:pPr><w:ind w:left="1440"/></w:pPr></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
    const src = handDocx(
      '<w:p><w:pPr><w:pStyle w:val="Bullets"/><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:p>',
      { styles: STYLES, numbering },
    );
    const e = explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p");
    expect(rowOf(e, "In a list").value).toContain("level 2 of list 1");
    expect(rowOf(e, "Left indent").value).toBe("2.54 cm (72 pt)");
  });

  it("takes a style's list from its base style when the derived style only sets the level", () => {
    const styles = `${STYLES}<w:style w:type="paragraph" w:styleId="Sub"><w:name w:val="Sub"/><w:basedOn w:val="Bullets"/>
      <w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>`;
    const numbering = `<w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:pPr><w:ind w:left="720"/></w:pPr></w:lvl>
      <w:lvl w:ilvl="1"><w:pPr><w:ind w:left="1440"/></w:pPr></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
    const src = handDocx('<w:p><w:pPr><w:pStyle w:val="Sub"/></w:pPr></w:p>', {
      styles,
      numbering,
    });
    const e = explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p");
    expect(rowOf(e, "In a list").value).toContain("level 2 of list 1");
  });

  it("never throws on a basedOn cycle, damaged XML or huge values", () => {
    const styles = `<w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/></w:style>
      <w:style w:type="paragraph" w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/><w:pPr><w:ind w:left="99999999999999999999999"/></w:pPr></w:style>`;
    const src = handDocx('<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr></w:p>', { styles });
    expect(explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p")).not.toBeNull();
    const broken = sourceFromParts({ "word/document.xml": "<w:document><w:body><w:p><w:pPr>" });
    expect(() =>
      explainParagraph(broken, "word/document.xml", "/w:document/w:body/w:p"),
    ).not.toThrow();
  });

  it("explains a header paragraph using the main part's styles", () => {
    const src = handDocx("<w:p/>", {
      styles: STYLES,
      extra: {
        "word/header1.xml":
          '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr></w:p></w:hdr>',
      },
    });
    const e = explainParagraph(src, "word/header1.xml", "/w:hdr/w:p");
    expect(rowOf(e, "Left indent").source?.label).toBe('Style "Body Text"');
  });
});

describe("explainDocxBytes", () => {
  it("returns null instead of throwing for bytes that are not a zip", async () => {
    const ctx = { path: "x.docx", part: "word/document.xml", locator: "/w:document/w:body/w:p" };
    await expect(explainDocxBytes(new Uint8Array([1, 2, 3]), ctx)).resolves.toBeNull();
  });
});

describe("pictures in a paragraph", () => {
  it("lists a stored picture with its name, alternative text and size", () => {
    const src = handDocx(ANCHORED_PICTURE, { rels: { rIdImg: ["image", "media/wm.png"] } });
    const e = explainParagraph(src, "word/document.xml", "/w:document/w:body/w:p");
    expect(e?.pictures).toEqual([
      { part: "word/media/wm.png", name: "Picture 7", alt: "Watermark", size: "1.76 × 0.88 cm" },
    ]);
  });
  it("leaves out linked pictures and paragraphs without pictures", () => {
    const linked = handDocx(ANCHORED_PICTURE, {
      rels: { rIdImg: ["image", "https://example.com/a.png", true] },
    });
    expect(
      explainParagraph(linked, "word/document.xml", "/w:document/w:body/w:p")?.pictures,
    ).toBeUndefined();
    expect(explain("<w:p/>")?.pictures).toBeUndefined();
  });
});
