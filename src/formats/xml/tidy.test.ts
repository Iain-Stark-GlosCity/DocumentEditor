import { describe, expect, it } from "vitest";
import { applyChanges, tidyChanges, tidyXml } from "./tidy";

const tidy = (text: string, indent = 2) => tidyXml(text, indent);

/** The DOM of `xml` with whitespace-only text nodes dropped, as a comparable outline. */
function outline(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  const out: string[] = [];
  const walk = (node: Node, depth: number) => {
    for (const child of Array.from(node.childNodes)) {
      const pad = "|".repeat(depth);
      if (child.nodeType === 3 && (child.nodeValue ?? "").trim() === "") continue;
      if (child instanceof Element) {
        const attrs = Array.from(child.attributes)
          .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
          .join(",");
        out.push(`${pad}<${child.nodeName} ${attrs}>`);
        walk(child, depth + 1);
      } else {
        out.push(`${pad}#${child.nodeType}:${JSON.stringify(child.nodeValue)}`);
      }
    }
  };
  walk(doc, 0);
  return out.join("\n");
}

describe("tidy", () => {
  it("indents nested elements that hold only elements", () => {
    expect(tidy("<a><b><c/></b><d/></a>")).toBe("<a>\n  <b>\n    <c/>\n  </b>\n  <d/>\n</a>");
  });

  it("uses the indent it is given", () => {
    expect(tidy("<a><b/></a>", 4)).toBe("<a>\n    <b/>\n</a>");
    expect(tidy("<a><b/></a>", 1)).toBe("<a>\n <b/>\n</a>");
  });

  it("replaces existing whitespace between elements, including tabs and blank lines", () => {
    expect(tidy("<a>\n\n\t<b/>   <c/>\n</a>")).toBe("<a>\n  <b/>\n  <c/>\n</a>");
  });

  it("is idempotent", () => {
    const once = tidy('<a x="1"><b><c>t</c></b><!-- n --><?pi x?><d/></a>') as string;
    expect(tidy(once)).toBe(once);
    expect(tidyChanges(once, 2)).toEqual([]);
  });

  it("never touches text: an element with text is left as it is, with all that is inside it", () => {
    const mixed = "<w:t>a <b>b</b> c</w:t>";
    expect(tidy(mixed)).toBe(mixed);
    const nested = "<p>Hello <span><i>a</i><i>b</i></span> world</p>";
    expect(tidy(nested)).toBe(nested);
    expect(tidy("<a><p>x <b/></p><q/></a>")).toBe("<a>\n  <p>x <b/></p>\n  <q/>\n</a>");
  });

  it("leaves whitespace-only text alone when the element has no child element", () => {
    expect(tidy("<a><t> </t><u>\n</u><v></v></a>")).toBe(
      "<a>\n  <t> </t>\n  <u>\n</u>\n  <v></v>\n</a>",
    );
  });

  it("leaves CDATA, comments, processing instructions and the DOCTYPE exactly as written", () => {
    const text =
      '<?xml version="1.0"  encoding="UTF-8" ?><!DOCTYPE r [<!ENTITY e "x > y">]><r><!--  a  <b/>  --><?p  a  b ?><c><![CDATA[ <x>  ]]></c><d/></r>';
    const out = tidy(text) as string;
    expect(out).toContain('<?xml version="1.0"  encoding="UTF-8" ?>');
    expect(out).toContain('<!DOCTYPE r [<!ENTITY e "x > y">]>');
    expect(out).toContain("<!--  a  <b/>  -->");
    expect(out).toContain("<?p  a  b ?>");
    expect(out).toContain("<c><![CDATA[ <x>  ]]></c>");
    expect(out).toBe(
      '<?xml version="1.0"  encoding="UTF-8" ?>\n<!DOCTYPE r [<!ENTITY e "x > y">]>\n<r>\n  <!--  a  <b/>  -->\n  <?p  a  b ?>\n  <c><![CDATA[ <x>  ]]></c>\n  <d/>\n</r>',
    );
  });

  it("does not treat an element with CDATA as element-only", () => {
    const text = "<a><b/><![CDATA[x]]><c/></a>";
    expect(tidy(text)).toBe(text);
  });

  it('leaves xml:space="preserve" regions alone, and indents around them', () => {
    const text = '<a><p xml:space="preserve"><b/>  <c/>\n<d/></p><q><r/></q></a>';
    expect(tidy(text)).toBe(
      '<a>\n  <p xml:space="preserve"><b/>  <c/>\n<d/></p>\n  <q>\n    <r/>\n  </q>\n</a>',
    );
    // Single-quoted, and nested elements inside inherit it.
    const single = "<a xml:space='preserve'><b><c/></b> </a>";
    expect(tidy(single)).toBe(single);
  });

  it("is not fooled by xml:space inside an attribute value", () => {
    const text = `<a title="x xml:space='preserve'"><b/></a>`;
    expect(tidy(text)).toBe(`<a title="x xml:space='preserve'">\n  <b/>\n</a>`);
  });

  it("keeps attribute values, with > and newlines in them, byte for byte", () => {
    const text = '<a x="1 > 0\n  and  more" y=\'say "hi"\'><b z="&lt;&amp;"/></a>';
    expect(tidy(text)).toBe(
      '<a x="1 > 0\n  and  more" y=\'say "hi"\'>\n  <b z="&lt;&amp;"/>\n</a>',
    );
  });

  it("handles self-closing tags with and without a space, namespaces and prefixes", () => {
    expect(tidy('<w:a xmlns:w="u"><w:b/><w:c /><w:d a="1"/></w:a>')).toBe(
      '<w:a xmlns:w="u">\n  <w:b/>\n  <w:c />\n  <w:d a="1"/>\n</w:a>',
    );
  });

  it("treats entity references as text", () => {
    const text = "<a>&amp;<b/></a>";
    expect(tidy(text)).toBe(text);
    expect(tidy("<a><b>&#10;</b><c/></a>")).toBe("<a>\n  <b>&#10;</b>\n  <c/>\n</a>");
  });

  it("keeps the XML declaration and leading and trailing whitespace outside the root", () => {
    expect(tidy('<?xml version="1.0"?><a><b/></a>\n')).toBe(
      '<?xml version="1.0"?>\n<a>\n  <b/>\n</a>\n',
    );
    expect(tidy('  <?xml version="1.0"?>\n\n<a/>  ')).toBe('  <?xml version="1.0"?>\n\n<a/>  ');
  });

  it("is not fooled by text that looks like markup inside comments, PIs and CDATA", () => {
    const text = "<a><!-- </a> --><b><![CDATA[ </b> <b> ]]></b><?x </a> ?></a>";
    expect(tidy(text)).toBe(
      "<a>\n  <!-- </a> -->\n  <b><![CDATA[ </b> <b> ]]></b>\n  <?x </a> ?>\n</a>",
    );
  });

  it("returns null for text that is not well-formed, whatever the problem", () => {
    for (const bad of [
      "",
      "plain text",
      "<a><b></a>",
      "<a></b>",
      "<a>",
      "<a/><b/>",
      "<a",
      "<a b=c/>",
      '<a b="1/>',
      "<a><!-- x</a>",
      "<a><![CDATA[ x</a>",
      "<a><?pi</a>",
      "<a>text</a>trailing",
      "<a/></a>",
    ]) {
      expect(tidyChanges(bad, 2), bad).toBeNull();
    }
  });

  it("produces changes that never overlap and are in order", () => {
    const text = "<a> <b>  <c/> </b>\n</a>";
    const changes = tidyChanges(text, 2) ?? [];
    for (let i = 1; i < changes.length; i++) {
      expect((changes[i] as { from: number }).from).toBeGreaterThanOrEqual(
        (changes[i - 1] as { to: number }).to,
      );
    }
    expect(applyChanges(text, changes)).toBe("<a>\n  <b>\n    <c/>\n  </b>\n</a>");
  });

  describe("invariants against the DOM", () => {
    const samples = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://x/w"><w:body><w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> Hello </w:t></w:r><w:r><w:t>wor</w:t></w:r><w:r><w:t>ld &amp; more</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>',
      '<r a="1 &gt; 0"><x>a <b>b</b> c</x><y><![CDATA[<z/>]]></y><!--c--><?p d?><s xml:space="preserve">  <t/>  </s></r>',
      '<!DOCTYPE r [<!ENTITY e "v">]><r>&e;<k>&e;</k><k/>\n</r>',
      "<a>\n  <b>\n\n</b>\n<c> <d/> </c></a>",
    ];
    for (const [i, sample] of samples.entries()) {
      it(`sample ${i + 1}: same DOM apart from whitespace between elements, and stable`, () => {
        const out = tidy(sample) as string;
        expect(outline(out)).toBe(outline(sample));
        expect(tidy(out)).toBe(out);
        // Every text run that is not whitespace-only, and every attribute value, survives.
        const strip = (s: string) => s.replace(/>\s+</g, "><");
        const meaningful = (s: string) => strip(s).replace(/<(\w[^>]*)\/>/g, "<$1/>");
        expect(meaningful(out)).toBe(meaningful(sample));
      });
    }
  });

  it("handles a realistic one-line Word document.xml", () => {
    const paras = Array.from({ length: 40 }, (_, i) =>
      `<w:p w14:paraId="0000${i}"><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:lang w:val="en-GB"/></w:rPr><w:t xml:space="preserve">Paragraph ${i} with  <&amp;> text </w:t></w:r></w:p>`.replace(
        "<&amp;>",
        "&amp;",
      ),
    ).join("");
    const text = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
    const out = tidy(text) as string;
    expect(out.split("\n").length).toBeGreaterThan(300);
    expect(out).toContain(
      '      <w:r>\n        <w:rPr>\n          <w:lang w:val="en-GB"/>\n        </w:rPr>\n        <w:t xml:space="preserve">Paragraph 0 with  &amp; text </w:t>\n      </w:r>',
    );
    expect(outline(out)).toBe(outline(text));
    expect(tidy(out)).toBe(out);
  });

  it("tidies a 2 MB single-line document well inside a second", () => {
    const row =
      '<w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">some text</w:t></w:r>';
    const text = `<?xml version="1.0"?><w:document xmlns:w="u"><w:body><w:p>${row.repeat(Math.ceil(2_000_000 / row.length))}</w:p></w:body></w:document>`;
    expect(text.length).toBeGreaterThan(2_000_000);
    const started = performance.now();
    const changes = tidyChanges(text, 2);
    const elapsed = performance.now() - started;
    expect(changes).not.toBeNull();
    expect((changes ?? []).length).toBeGreaterThan(100_000);
    expect(elapsed).toBeLessThan(1000);
  });
});
