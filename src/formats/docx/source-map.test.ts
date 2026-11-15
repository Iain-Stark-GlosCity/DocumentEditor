import { describe, expect, it } from "vitest";
import { sourceFor } from "../../core/source-map";
import { decodePartText } from "../../core/text-codec";
import { tidyXml } from "../xml/tidy";
import { locateElement } from "../xml/locate";
import * as H from "./hand-samples";
import { handDocx, NS, richSampleBytes, sourceFromZip, type HandOptions } from "./test-helpers";
import { generateDocxView, generateDocxViewMapped, LEGEND } from "./view";
import type { PartSource } from "./package";
import { parseXml, sourceOf, textOf, type XDocument, type XElement } from "./xml";

/** The element a locator names, resolved on a parsed tree (independent of the XML format's scan). */
function resolve(doc: XDocument, locator: string): XElement | undefined {
  const steps = locator.slice(1).split("/");
  let el: XElement | undefined;
  let siblings: XElement[] = doc.root ? [doc.root] : [];
  for (const step of steps) {
    const m = /^(.+?)(?:\[(\d+)\])?$/.exec(step)!;
    const index = m[2] ? Number(m[2]) : 1;
    el = siblings.filter((e) => e.rawName === m[1])[index - 1];
    if (!el) return undefined;
    siblings = el.children.filter((c): c is XElement => typeof c !== "string");
  }
  return el;
}

/** The part as the XML tab shows it: decoded the way a part is opened, line endings normalised. */
function tabText(source: PartSource, part: string): string {
  return decodePartText(new TextEncoder().encode(source.text(part) ?? "")).text;
}

/** The longest word in any one text node of the element (words never run across nodes). */
function longestWord(el: XElement): string | null {
  let best: string | null = null;
  const walk = (e: XElement) => {
    for (const c of e.children) {
      if (typeof c !== "string") walk(c);
      else
        for (const w of c.match(/[\p{L}\p{N}]{3,}/gu) ?? [])
          if (best === null || w.length > best.length) best = w;
    }
  };
  walk(el);
  return best;
}

/** What the view must show on the lines of this entry. */
function expectedSnippet(el: XElement): string | null {
  switch (el.name) {
    case "w:p":
    case "w:tbl":
    case "w:footnote":
    case "w:endnote":
    case "w:comment":
      return longestWord(el);
    case "w:style":
      return `id=${el.attrs["w:styleId"]}`;
    case "w:num":
      return `list ${el.attrs["w:numId"]}`;
    case "w:sectPr":
      return "section ";
    case "cp:coreProperties":
      return "properties ";
    case "ep:Properties":
      return "application ";
    case "w:settings":
      return "settings ";
    case "w:hdr":
    case "w:ftr":
      return "word/";
    default:
      return null;
  }
}

interface Checked {
  entries: number;
  kinds: Set<string>;
}

function checkSource(source: PartSource): Checked {
  const { text, sourceMap } = generateDocxViewMapped(source);
  const lines = text.split("\n");
  const kinds = new Set<string>();
  const docs = new Map<string, { text: string; doc: XDocument }>();
  const tabs = (part: string) => {
    let t = docs.get(part);
    if (!t) {
      const partText = tabText(source, part);
      t = { text: partText, doc: parseXml(partText) };
      docs.set(part, t);
    }
    return t;
  };
  for (const entry of sourceMap) {
    const where = `${entry.part} ${entry.locator} (${entry.label}) lines ${entry.fromLine}-${entry.toLine}`;
    const { text: partText, doc } = tabs(entry.part);
    const el = resolve(doc, entry.locator);
    expect(el, `the locator resolves: ${where}`).toBeDefined();
    kinds.add(el!.name);

    // (a) The lines show that element.
    expect(entry.fromLine, where).toBeGreaterThan(LEGEND.length);
    expect(entry.toLine, where).toBeGreaterThanOrEqual(entry.fromLine);
    expect(entry.toLine, where).toBeLessThanOrEqual(lines.length);
    const shown = lines.slice(entry.fromLine - 1, entry.toLine).join("\n");
    const snippet = expectedSnippet(el!);
    if (snippet !== null) expect(shown, `line accuracy: ${where}`).toContain(snippet);
    if (el!.name === "w:p" && textOf(el!).trim() === "")
      expect(shown.length, where).toBeGreaterThan(0);

    // (b) The XML format finds the same element in the part as the tab shows it.
    const range = locateElement(partText, entry.locator);
    expect(range, `locate: ${where}`).not.toBeNull();
    expect(partText.slice(range!.from, range!.to), `locate: ${where}`).toBe(sourceOf(doc, el!));

    // (c) After Tidy the element is still found, with the same name and text.
    const tidyPart = tidyCache(entry.part, partText);
    const moved = locateElement(tidyPart.text, entry.locator);
    expect(moved, `locate after Tidy: ${where}`).not.toBeNull();
    const again = parseXml(tidyPart.text.slice(moved!.from, moved!.to)).root;
    expect(again?.rawName, where).toBe(el!.rawName);
    expect(squash(textOf(again)), `text after Tidy: ${where}`).toBe(squash(textOf(el!)));
  }
  return { entries: sourceMap.length, kinds };
}

const tidied = new Map<string, { text: string }>();
function tidyCache(part: string, text: string): { text: string } {
  const key = `${part}\u0000${text.length}\u0000${text.slice(0, 50)}`;
  let t = tidied.get(key);
  if (!t) {
    const out = tidyXml(text, 2);
    expect(out, `${part} can be tidied`).not.toBeNull();
    t = { text: out! };
    tidied.set(key, t);
  }
  return t;
}

const squash = (s: string) => s.replace(/\s+/g, "");

const RICH: HandOptions = {
  styles: H.STYLES,
  numbering: H.NUMBERING,
  rels: {
    rIdImg: ["image", "media/image1.png"],
    rIdTheme: ["theme", "theme/theme1.xml"],
    rIdLink: ["hyperlink", "https://example.com/a b", true],
    rIdFn: ["footnotes", "footnotes.xml"],
    rIdEn: ["endnotes", "endnotes.xml"],
    rIdCm: ["comments", "comments.xml"],
    rIdH: ["header", "header1.xml"],
    rIdF: ["footer", "footer1.xml"],
    rIdSet: ["settings", "settings.xml"],
  },
  extra: {
    "word/theme/theme1.xml": H.THEME,
    "word/media/image1.png": "PNG",
    "word/footnotes.xml": `<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>First footnote text.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph of the footnote.</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Another footnote.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    "word/endnotes.xml": `<w:endnotes ${NS}><w:endnote w:id="1"><w:p><w:r><w:t>An endnote about origins.</w:t></w:r></w:p></w:endnote></w:endnotes>`,
    "word/comments.xml": `<w:comments ${NS}><w:comment w:id="0" w:author="Ravi" w:initials="R" w:date="2024-05-01T10:00:00Z"><w:p><w:r><w:t>Please check the figures.</w:t></w:r></w:p></w:comment></w:comments>`,
    "word/header1.xml": `<w:hdr ${NS}><w:p><w:r><w:t>Running header text</w:t></w:r></w:p></w:hdr>`,
    "word/footer1.xml": `<w:ftr ${NS}><w:p><w:r><w:t>Running footer text</w:t></w:r></w:p></w:ftr>`,
    "word/settings.xml": `<w:settings ${NS}><w:zoom w:percent="120"/><w:trackRevisions/></w:settings>`,
    "docProps/core.xml": `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plan</dc:title><cp:lastModifiedBy>Ann</cp:lastModifiedBy></cp:coreProperties>`,
    "docProps/app.xml": `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>3</Pages></Properties>`,
  },
  sectPr:
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
};

const p = (text: string, pPr = "") => H.P(text, pPr);

describe("the source map of the rich sample", () => {
  it("has accurate lines, locators that the XML format finds, and survives Tidy", async () => {
    const source = sourceFromZip(await richSampleBytes());
    const result = checkSource(source);
    expect(result.entries).toBeGreaterThan(40);
    for (const kind of ["w:p", "w:tbl", "w:sectPr", "w:style", "w:footnote", "w:comment"])
      expect(result.kinds, kind).toContain(kind);
  }, 60_000);

  it("leaves the text unchanged by the map", async () => {
    const source = sourceFromZip(await richSampleBytes());
    expect(generateDocxViewMapped(source).text).toBe(generateDocxView(source));
    expect([...generateDocxViewMapped(source).text].some((c) => c.charCodeAt(0) < 4)).toBe(false);
  }, 30_000);
});

describe("the source map of hand-written documents", () => {
  const body = [
    p("Intro paragraph with unique alpha", '<w:pStyle w:val="Heading1"/>'),
    p("Second paragraph bravo"),
    `<w:p/>`,
    H.MERGED_TABLE,
    H.NESTED_TABLE,
    `<w:tbl><w:tblPr><w:tblStyle w:val="GridTable4"/><w:tblLook w:val="04A0" w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Head one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Head two</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Cell charlie</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell delta</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    p("List item echo", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
    `<w:p><w:r><w:t>Note reference foxtrot</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:endnoteReference w:id="1"/></w:r></w:p>`,
    H.TOC,
    H.MOVES,
    H.COMPLEX_FIELDS,
    p("Section ends golf", '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'),
    p("After the break hotel"),
  ].join("");

  it("has accurate lines, locators that the XML format finds, and survives Tidy", () => {
    const result = checkSource(handDocx(body, RICH));
    expect(result.entries).toBeGreaterThan(40);
    for (const kind of [
      "w:p",
      "w:tbl",
      "w:sectPr",
      "w:style",
      "w:num",
      "w:footnote",
      "w:endnote",
      "w:comment",
      "w:hdr",
      "w:ftr",
      "w:settings",
      "cp:coreProperties",
      "ep:Properties",
    ])
      expect(result.kinds, kind).toContain(kind);
  });

  it("names the entries", () => {
    const { sourceMap } = generateDocxViewMapped(handDocx(body, RICH));
    const labels = sourceMap.map((e) => e.label);
    expect(labels).toContain("paragraph 1");
    expect(labels).toContain("paragraph 2");
    expect(labels).toContain("table 1");
    expect(labels).toContain("table 3, row 2, cell 1, paragraph 1");
    expect(labels).toContain("footnote 1");
    expect(labels).toContain("endnote 1");
    expect(labels).toContain("comment 0");
    expect(labels).toContain("style Heading 1");
    expect(labels).toContain("list 2");
    expect(labels).toContain("section 1");
  });

  it("maps a line to the paragraph and a table cell paragraph to its own element", () => {
    const { text, sourceMap } = generateDocxViewMapped(handDocx(body, RICH));
    const lines = text.split("\n");
    const lineOf = (needle: string) => lines.findIndex((l) => l.includes(needle)) + 1;
    expect(sourceFor(sourceMap, lineOf("Second paragraph bravo"))).toMatchObject({
      part: "word/document.xml",
      locator: "/w:document/w:body/w:p[2]",
    });
    const cell = sourceFor(sourceMap, lineOf("Cell delta"));
    expect(cell?.part).toBe("word/document.xml");
    expect(cell?.locator).toMatch(/w:tbl\[3\]\/w:tr\[2\]\/w:tc\[\d\]\/w:p$/);
    // A note of one paragraph is the note itself; in a longer note the paragraph is narrower.
    expect(sourceFor(sourceMap, lineOf("Another footnote"))).toMatchObject({
      part: "word/footnotes.xml",
      locator: "/w:footnotes/w:footnote[3]",
    });
    expect(sourceFor(sourceMap, lineOf("First footnote text"))).toMatchObject({
      part: "word/footnotes.xml",
      locator: "/w:footnotes/w:footnote[2]/w:p[1]",
    });
    expect(sourceFor(sourceMap, lineOf("Running header text"))?.part).toBe("word/header1.xml");
    expect(sourceFor(sourceMap, lineOf("Running footer text"))?.part).toBe("word/footer1.xml");
    expect(sourceFor(sourceMap, lineOf("<!-- properties "))?.part).toBe("docProps/core.xml");
  });

  it("gives every entry of a table cell paragraph a place inside its table", () => {
    const { sourceMap } = generateDocxViewMapped(handDocx(body, RICH));
    const table = sourceMap.find((e) => e.label === "table 3")!;
    const cells = sourceMap.filter((e) => e.label?.startsWith("table 3, "));
    expect(cells.length).toBe(4);
    for (const c of cells) {
      expect(c.fromLine).toBeGreaterThanOrEqual(table.fromLine);
      expect(c.toLine).toBeLessThanOrEqual(table.toLine);
    }
  });

  it("gives an unreadable package an empty map", () => {
    const view = generateDocxViewMapped({ names: () => [], text: () => undefined });
    expect(view.sourceMap).toEqual([]);
    expect(view.text).toContain("<!--");
  });
});

describe("source map performance", () => {
  it("adds little to 10,000 paragraphs", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10_000; i++)
      paragraphs.push(
        `<w:p w:rsidR="00A1"><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">Paragraph ${i} with some </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>`,
      );
    const source = handDocx(paragraphs.join(""), RICH);
    const start = performance.now();
    const { text, sourceMap } = generateDocxViewMapped(source);
    const ms = performance.now() - start;
    const mapped = sourceMap.filter(
      (e) => e.part === "word/document.xml" && e.label?.startsWith("paragraph"),
    );
    expect(mapped.length).toBe(10_000);
    expect(text.split("\n").length).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(4000);
  });
});
