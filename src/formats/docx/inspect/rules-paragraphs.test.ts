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
