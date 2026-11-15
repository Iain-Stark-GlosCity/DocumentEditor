import { describe, expect, it } from "vitest";
import {
  child,
  elements,
  locatorOf,
  parseXml,
  pathOf,
  sourceOf,
  textOf,
  type XElement,
} from "./xml";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

describe("parseXml", () => {
  it("keeps mixed content in document order and decodes entities", () => {
    const doc = parseXml(
      `<?xml version="1.0"?><a>x<b k="1 &amp; 2"/>y&lt;&#65;&#x42;<c><![CDATA[<raw>]]></c></a>`,
    );
    expect(doc.problems).toEqual([]);
    const a = doc.root!;
    expect(a.children.map((c) => (typeof c === "string" ? c : c.name))).toEqual([
      "x",
      "b",
      "y<AB",
      "c",
    ]);
    expect(child(a, "b")!.attrs.k).toBe("1 & 2");
    expect(textOf(child(a, "c"))).toBe("<raw>");
  });

  it("gives known namespaces their usual prefix, whatever the file calls them", () => {
    const doc = parseXml(
      `<x:document xmlns:x="${W}"><x:body><x:p x:rsidR="1"/></x:body></x:document>`,
    );
    expect(doc.root!.name).toBe("w:document");
    const p = child(child(doc.root, "w:body"), "w:p")!;
    expect(p.attrs).toEqual({ "w:rsidR": "1" });
    const strict = parseXml(
      `<document xmlns="http://purl.oclc.org/ooxml/wordprocessingml/main"><body/></document>`,
    );
    expect(strict.root!.name).toBe("w:document");
    expect(elements(strict.root)[0]!.name).toBe("w:body");
  });

  it("keeps unknown prefixes as written", () => {
    const doc = parseXml(`<w:p xmlns:w="${W}" xmlns:foo="urn:x"><foo:bar foo:a="1"/></w:p>`);
    expect(elements(doc.root)[0]!.name).toBe("foo:bar");
  });

  it("never throws on damaged XML and reports what it repaired", () => {
    for (const text of [
      "",
      "garbage",
      "<a><b></a>",
      "<a>",
      "</a>",
      "<a b='1>",
      "\u0000\u0001\uffff<<>>",
      "<a><b><c></a></b>",
    ]) {
      expect(() => parseXml(text)).not.toThrow();
    }
    const doc = parseXml("<a><b>text</a>");
    expect(doc.problems.join()).toMatch(/not closed/);
    expect(textOf(doc.root)).toBe("text");
  });

  it("knows each element's path and source", () => {
    const text = `<w:document xmlns:w="${W}"><w:body><w:p/><w:p><w:r/><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(text);
    const r = elements(elements(child(doc.root, "w:body"))[1])[1]!;
    expect(pathOf(r)).toBe("/w:document/w:body/w:p[2]/w:r[2]");
    expect(sourceOf(doc, r)).toBe("<w:r><w:t>x</w:t></w:r>");
  });
});

describe("locatorOf", () => {
  it("names elements as written, with positions among same-named siblings", () => {
    const doc = parseXml(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:p><w:r/><w:r/></w:p><w:sectPr/></w:body></w:document>',
    );
    const body = doc.root!.children[0] as XElement;
    const secondP = body.children[1] as XElement;
    const secondR = secondP.children[1] as XElement;
    expect(locatorOf(doc.root!)).toBe("/w:document");
    expect(locatorOf(body)).toBe("/w:document/w:body");
    expect(locatorOf(secondP)).toBe("/w:document/w:body/w:p[2]");
    expect(locatorOf(secondR)).toBe("/w:document/w:body/w:p[2]/w:r[2]");
    expect(locatorOf(body.children[2] as XElement)).toBe("/w:document/w:body/w:sectPr");
  });

  it("uses the prefix the file used, not the canonical one", () => {
    const doc = parseXml(
      '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p/><x:p/></x:body></x:document>',
    );
    const body = doc.root!.children[0] as XElement;
    expect((body.children[1] as XElement).name).toBe("w:p");
    expect(locatorOf(body.children[1] as XElement)).toBe("/x:document/x:body/x:p[2]");
  });
});
