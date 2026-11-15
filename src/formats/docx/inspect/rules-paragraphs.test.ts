import { describe, expect, it } from "vitest";
import { handDocx } from "../test-helpers";
import { inspectWith } from "./index";
import { paragraphRules } from "./rules-paragraphs";

const NUMBERING = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
  <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
const SECT =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr>';

const run = (body: string) =>
  inspectWith(handDocx(body, { numbering: NUMBERING, sectPr: SECT }), paragraphRules);
const list = (ind: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${ind}</w:pPr></w:p>`;

describe("formatting.indent-overrides-list", () => {
  it("flags a list item whose own indent differs from its level, and points at it", () => {
    const f = run(list("") + list('<w:ind w:left="1440" w:hanging="360"/>'));
    const finding = f.find((x) => x.rule === "formatting.indent-overrides-list");
    expect(finding?.severity).toBe("info");
    expect(finding?.facts?.count).toBe(1);
    expect(finding?.locations[0]?.locator).toBe("/w:document/w:body/w:p[2]");
  });
  it("is quiet when the indent matches the level or there is none", () => {
    const f = run(list("") + list('<w:ind w:left="720" w:hanging="360"/>'));
    expect(f.filter((x) => x.rule === "formatting.indent-overrides-list")).toEqual([]);
  });
  it("ignores paragraphs outside lists", () => {
    const f = run('<w:p><w:pPr><w:ind w:left="1440"/></w:pPr></w:p>');
    expect(f).toEqual([]);
  });
});

describe("formatting.extreme-indent", () => {
  it("flags a negative indent and one that eats the page", () => {
    const f = run(
      '<w:p><w:pPr><w:ind w:left="-500"/></w:pPr></w:p><w:p><w:pPr><w:ind w:left="8000"/></w:pPr></w:p><w:p><w:pPr><w:ind w:left="720"/></w:pPr></w:p>',
    );
    const finding = f.find((x) => x.rule === "formatting.extreme-indent");
    expect(finding?.severity).toBe("warning");
    expect(finding?.facts?.count).toBe(2);
  });
  it("says nothing without a page size, and skips table paragraphs", () => {
    const noPage = inspectWith(
      handDocx('<w:p><w:pPr><w:ind w:left="90000"/></w:pPr></w:p>'),
      paragraphRules,
    );
    expect(noPage).toEqual([]);
    const inTable = run(
      '<w:tbl><w:tr><w:tc><w:p><w:pPr><w:ind w:left="90000"/></w:pPr></w:p></w:tc></w:tr></w:tbl>',
    );
    expect(inTable).toEqual([]);
  });
});

describe("indent rules, further cases", () => {
  const find = (f: ReturnType<typeof run>, rule: string) => f.find((x) => x.rule === rule);

  it("flags a direct first-line indent that replaces the level's hanging indent", () => {
    const f = run(list('<w:ind w:left="720" w:firstLine="0"/>'));
    expect(find(f, "formatting.indent-overrides-list")?.facts?.count).toBe(1);
  });
  it("compares start with left and treats an equal hanging indent as equal", () => {
    const f = run(list('<w:ind w:start="720" w:hanging="360"/>'));
    expect(find(f, "formatting.indent-overrides-list")).toBeUndefined();
  });
  it("does not call a direct indent an override when the level sets none", () => {
    const bare = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
    const f = inspectWith(
      handDocx(list('<w:ind w:left="1440"/>'), { numbering: bare, sectPr: SECT }),
      paragraphRules,
    );
    expect(find(f, "formatting.indent-overrides-list")).toBeUndefined();
  });

  it("skips text boxes, which have their own width", () => {
    const f = run(
      '<w:p><w:r><w:pict><w:txbxContent><w:p><w:pPr><w:ind w:left="9000"/></w:pPr></w:p></w:txbxContent></w:pict></w:r></w:p>',
    );
    expect(find(f, "formatting.extreme-indent")).toBeUndefined();
  });
  it("uses the width of the section the paragraph is in, not the last one", () => {
    const narrow =
      '<w:p><w:pPr><w:ind w:left="3000"/><w:sectPr><w:pgSz w:w="6000" w:h="8000"/><w:pgMar w:left="500" w:right="500"/></w:sectPr></w:pPr></w:p>';
    // 3000 of 5000 is fine for the narrow first section; the wide last section would also be fine.
    expect(find(run(narrow + "<w:p/>"), "formatting.extreme-indent")).toBeUndefined();
    const tooMuch = narrow.replace('w:left="3000"', 'w:left="4500"');
    // 4500 of 5000 is extreme in its own section, though only 4500 of 9026 in the last one.
    expect(find(run(tooMuch + "<w:p/>"), "formatting.extreme-indent")?.facts?.count).toBe(1);
  });
  it("is not fooled by the old properties inside a section change", () => {
    const sect =
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1440" w:right="1440"/><w:sectPrChange w:id="1"><w:sectPr><w:pgSz w:w="2000" w:h="3000"/></w:sectPr></w:sectPrChange></w:sectPr>';
    const f = inspectWith(
      handDocx('<w:p><w:pPr><w:ind w:left="3000"/></w:pPr></w:p>', { sectPr: sect }),
      paragraphRules,
    );
    expect(find(f, "formatting.extreme-indent")).toBeUndefined();
  });
  it("measures against the column width in a multi-column section", () => {
    const cols =
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1440" w:right="1440"/><w:cols w:num="3" w:space="720"/></w:sectPr>';
    const f = inspectWith(
      handDocx('<w:p><w:pPr><w:ind w:left="2400"/></w:pPr></w:p>', { sectPr: cols }),
      paragraphRules,
    );
    // Column width is (9026 - 1440) / 3 = 2528; 2400 of it is extreme.
    expect(find(f, "formatting.extreme-indent")?.facts?.count).toBe(1);
  });
  it("does not flag a hanging indent or ignore a style-set indent", () => {
    const f = run('<w:p><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:p>');
    expect(find(f, "formatting.extreme-indent")).toBeUndefined();
  });
  it("leaves an indent stated in characters alone, since the twips are not used", () => {
    const f = run('<w:p><w:pPr><w:ind w:left="9000" w:leftChars="100"/></w:pPr></w:p>');
    expect(find(f, "formatting.extreme-indent")).toBeUndefined();
  });
  it("ignores non-numeric and empty values", () => {
    const f = run('<w:p><w:pPr><w:ind w:left="" w:right="abc"/></w:pPr></w:p>');
    expect(f).toEqual([]);
  });
});
