import { describe, expect, it } from "vitest";
import { xmlProvider } from "./index";
import { locateElement, parseLocator } from "./locate";

/** The text the locator finds, or null. */
function found(text: string, locator: string): string | null {
  const r = locateElement(text, locator);
  return r ? text.slice(r.from, r.to) : null;
}

describe("parseLocator", () => {
  it("reads steps with and without positions", () => {
    expect(parseLocator("/w:document/w:body/w:p[12]")).toEqual([
      { name: "w:document", index: 1 },
      { name: "w:body", index: 1 },
      { name: "w:p", index: 12 },
    ]);
  });
  it("rejects what is not a locator", () => {
    for (const bad of [
      "",
      "/",
      "w:p",
      "//w:p",
      "/a/",
      "/a[0]",
      "/a[x]",
      "/a[1",
      "/a b",
      "/a[1][2]",
    ])
      expect(parseLocator(bad), bad).toBeNull();
  });
});

describe("locateElement", () => {
  const doc = `<?xml version="1.0"?><r><a>1</a><b><c/><c>x</c></b><a>2</a><a/></r>`;

  it("finds the root, nested elements and repeated siblings", () => {
    expect(found(doc, "/r")).toBe(doc.slice(doc.indexOf("<r>")));
    expect(found(doc, "/r/a")).toBe("<a>1</a>");
    expect(found(doc, "/r/a[1]")).toBe("<a>1</a>");
    expect(found(doc, "/r/a[2]")).toBe("<a>2</a>");
    expect(found(doc, "/r/b/c[2]")).toBe("<c>x</c>");
    expect(found(doc, "/r/b")).toBe("<b><c/><c>x</c></b>");
  });

  it("covers a self-closing element by its one tag", () => {
    expect(found(doc, "/r/b/c[1]")).toBe("<c/>");
    expect(found(doc, "/r/a[3]")).toBe("<a/>");
    expect(found(`<r><a /><a x="1"/></r>`, "/r/a[2]")).toBe(`<a x="1"/>`);
  });

  it("returns nothing for a missing element or a position past the count", () => {
    expect(found(doc, "/r/z")).toBeNull();
    expect(found(doc, "/r/a[4]")).toBeNull();
    expect(found(doc, "/r/b/c[3]")).toBeNull();
    expect(found(doc, "/r/a/b")).toBeNull();
    expect(found(doc, "/q")).toBeNull();
    expect(found(doc, "/r/a[3]/b")).toBeNull();
  });

  it("returns nothing for an empty or malformed locator, and never throws", () => {
    for (const bad of ["", "/", "r", "/r//a", "/r/a[0]", "/r/a[", "[1]"])
      expect(found(doc, bad), bad).toBeNull();
    expect(locateElement(doc, null as unknown as string)).toBeNull();
    expect(locateElement(doc, undefined as unknown as string)).toBeNull();
    expect(locateElement("", "/r")).toBeNull();
    expect(locateElement("<", "/r")).toBeNull();
    expect(locateElement("<r><a", "/r/a")).toBeNull();
  });

  it("counts siblings by the name as written, and ignores the same name deeper down", () => {
    const text = `<r><p><p>inner</p></p><p>second</p></r>`;
    expect(found(text, "/r/p[2]")).toBe("<p>second</p>");
    expect(found(text, "/r/p/p")).toBe("<p>inner</p>");
    const mixed = `<r><x:a/><y:a/><x:a>t</x:a></r>`;
    expect(found(mixed, "/r/x:a[2]")).toBe("<x:a>t</x:a>");
    expect(found(mixed, "/r/y:a")).toBe("<y:a/>");
    expect(found(mixed, "/r/a")).toBeNull();
  });

  it("reads mixed content", () => {
    const text = `<r>before <b>bold</b> middle <b>again</b> after</r>`;
    expect(found(text, "/r/b[2]")).toBe("<b>again</b>");
  });

  it("works with a prefix other than w and with namespaces declared in the file", () => {
    const text = `<d:document xmlns:d="http://x" xmlns="http://y"><d:body><d:p>1</d:p><d:p>2</d:p></d:body></d:document>`;
    expect(found(text, "/d:document/d:body/d:p[2]")).toBe("<d:p>2</d:p>");
    expect(found(text, "/w:document/w:body/w:p[2]")).toBeNull();
  });

  it("does not see tags inside comments", () => {
    const text = `<r><!-- <a>fake</a> <a/> --><a>real</a></r>`;
    expect(found(text, "/r/a")).toBe("<a>real</a>");
    expect(found(text, "/r/a[2]")).toBeNull();
    expect(found(`<r><a><!-- </a> --><b/></a><a>2</a></r>`, "/r/a[2]")).toBe("<a>2</a>");
  });

  it("does not see tags inside CDATA", () => {
    const text = `<r><a><![CDATA[</a><a>]]></a><a>real</a></r>`;
    expect(found(text, "/r/a")).toBe("<a><![CDATA[</a><a>]]></a>");
    expect(found(text, "/r/a[2]")).toBe("<a>real</a>");
    expect(found(text, "/r/a[3]")).toBeNull();
  });

  it("skips processing instructions and a DOCTYPE, even with an internal subset", () => {
    const text = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "<a>x</a>"><!-- > -->]><?pi <a/> ?><r><a>1</a></r>`;
    expect(found(text, "/r/a")).toBe("<a>1</a>");
    expect(found(text, "/r")).toBe("<r><a>1</a></r>");
  });

  it("is not fooled by > or / or tag-like text inside attribute values", () => {
    const text = `<r><a href="x>y/z" t='</a>'/><a title="a > b" d="<b>">text</a><a>3</a></r>`;
    expect(found(text, "/r/a[1]")).toBe(`<a href="x>y/z" t='</a>'/>`);
    expect(found(text, "/r/a[2]")).toBe(`<a title="a > b" d="<b>">text</a>`);
    expect(found(text, "/r/a[3]")).toBe("<a>3</a>");
  });

  it("handles a byte order mark, line breaks and indentation", () => {
    const text = "\uFEFF" + `<r>\n  <a>\n    1\n  </a>\n  <a>\n    2\n  </a>\n</r>\n`;
    expect(found(text, "/r/a[2]")).toBe("<a>\n    2\n  </a>");
  });

  it("returns the range in the text", () => {
    const text = "<r><a>1</a><a>2</a></r>";
    expect(locateElement(text, "/r/a[2]")).toEqual({ from: 11, to: 19 });
  });

  it("is wired into the XML provider", () => {
    expect(xmlProvider.locate?.("<r><a/></r>", "/r/a")).toEqual({ from: 3, to: 7 });
  });

  it("finds a deep element of a 3 MB single-line document quickly", () => {
    const para = (i: number) =>
      `<w:p w:rsidR="00A${i}"><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Paragraph ${i} &gt; text</w:t></w:r></w:p>`;
    const parts: string[] = [];
    for (let i = 1; i <= 20000; i++) parts.push(para(i));
    const text = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${parts.join("")}<w:sectPr/></w:body></w:document>`;
    expect(text.length).toBeGreaterThan(3_000_000);
    expect(text.includes("\n")).toBe(false);
    const start = performance.now();
    const hit = found(text, "/w:document/w:body/w:p[19990]/w:r/w:t");
    const ms = performance.now() - start;
    expect(hit).toContain("Paragraph 19990 &gt; text");
    expect(ms).toBeLessThan(100);
    expect(found(text, "/w:document/w:body/w:p[20001]")).toBeNull();
    expect(found(text, "/w:document/w:body/w:sectPr")).toBe("<w:sectPr/>");
  });
});

describe("locateElement in a damaged part", () => {
  it("finds an element that is never closed, up to the end of the text", () => {
    const damaged = "<w:hdr><w:p><w:r><w:t>x</w:t></w:r>\n</w:hdr>";
    expect(found(damaged, "/w:hdr")).toBe(damaged);
    expect(found(damaged, "/w:hdr/w:p")).toBe(damaged.slice(damaged.indexOf("<w:p>")));
  });

  it("still returns null for an element that is not there", () => {
    expect(found("<a><b>", "/a/c")).toBeNull();
    expect(found("<a><b></a>", "/a/b[2]")).toBeNull();
    expect(found("<a><b/>", "/a/b[2]")).toBeNull();
  });

  it("does not let a comment or CDATA cut off at the end of the text hide a closed element", () => {
    expect(found("<a><b/><!-- never closed", "/a/b")).toBe("<b/>");
    expect(found("<a><b><![CDATA[ x", "/a/b")).toBe("<b><![CDATA[ x");
  });
});
