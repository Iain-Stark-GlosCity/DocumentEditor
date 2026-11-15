import { describe, expect, it } from "vitest";
import { describeTwips, explainParagraph, findByLocator } from "./explain";
import { handDocx } from "./test-helpers";
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
