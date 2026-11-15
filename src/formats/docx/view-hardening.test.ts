/**
 * Defects found by probing the Formatting view with awkward input: content that was hidden,
 * rows a pipe table could not hold, and lines that were split in two. Each test failed before the
 * fix next to it.
 */
import { describe, expect, it } from "vitest";
import { handDocx, type HandOptions } from "./test-helpers";
import { generateDocxView } from "./view";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (t: string) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;
const fc = (t: string) => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
const instr = (s: string) =>
  `<w:r><w:instrText xml:space="preserve">${esc(s)}</w:instrText></w:r>`;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const view = (body: string, options: HandOptions = {}) =>
  generateDocxView(handDocx(body, options));

describe("a field that is never closed", () => {
  const withNotes = (xml: string): HandOptions => ({
    rels: { rIdF: ["footnotes", "footnotes.xml"], rIdH: ["header", "header1.xml"] },
    sectPr: '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
    extra: {
      "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>NOTE TEXT</w:t></w:r></w:p></w:footnote></w:footnotes>`,
      "word/header1.xml": `<w:hdr ${W}><w:p><w:r><w:t>HEADER TEXT</w:t></w:r></w:p></w:hdr>`,
      ...(xml ? { "word/x.xml": xml } : {}),
    },
  });

  it("does not swallow the text that follows it in the body", () => {
    const out = view(
      p(run("before ") + fc("begin") + instr(" PAGE ") + run("after the field")) +
        p(run("second paragraph")),
    );
    expect(out).toContain("after the field");
    expect(out).toContain("second paragraph");
    expect(out).toContain("1 field(s) are not closed by the end of the document");
  });

  it("does not leak into the notes and headers that come after the body", () => {
    const out = view(p(run("x") + fc("begin") + instr(" PAGE ")), withNotes(""));
    expect(out).toContain("NOTE TEXT");
    expect(out).toContain("HEADER TEXT");
  });

  it("says so when a note or header leaves a field open", () => {
    const out = view(p(run("x")), {
      ...withNotes(""),
      extra: {
        "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:id="1"><w:p>${fc("begin")}${instr(" PAGE ")}${run("note body")}</w:p></w:footnote></w:footnotes>`,
        "word/header1.xml": `<w:hdr ${W}><w:p><w:r><w:t>HEADER TEXT</w:t></w:r></w:p></w:hdr>`,
      },
    });
    expect(out).toContain("note body");
    expect(out).toContain("HEADER TEXT");
    expect(out).toMatch(/1 field\(s\) are not closed by the end of word\/footnotes\.xml/);
  });

  it("still reads a complete field with its result", () => {
    const out = view(
      p(fc("begin") + instr(" PAGE ") + fc("separate") + run("3") + fc("end") + run(" after")),
    );
    expect(out).toContain('<field code="PAGE">3</field> after');
  });
});

describe("pipe tables", () => {
  const cell = (inner: string) => `<w:tc><w:p>${inner}</w:p></w:tc>`;
  const table = (...rows: string[]) =>
    `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1"/><w:gridCol w:w="1"/></w:tblGrid>${rows.join("")}</w:tbl>`;
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(run("H1"))}${cell(run("H2"))}</w:tr>`;

  it("falls back to an HTML table when a tag in a cell holds a pipe", () => {
    const out = view(
      table(
        header,
        `<w:tr>${cell(`<w:fldSimple w:instr=" IF a | b "><w:r><w:t>x</w:t></w:r></w:fldSimple>`)}${cell(run("y"))}</w:tr>`,
      ),
    );
    expect(out).toContain("<table");
    expect(out).not.toMatch(/^\| /m);
    expect(out).toContain('code="IF a | b"');
  });

  it("falls back for a link target or maths with a pipe", () => {
    const out = view(
      table(
        header,
        `<w:tr>${cell(`<w:hyperlink w:anchor="a|b"><w:r><w:t>l</w:t></w:r></w:hyperlink>`)}${cell(`<m:oMath><m:d><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:d></m:oMath>`)}</w:tr>`,
      ),
    );
    expect(out).toContain("<table");
  });

  it("keeps a pipe table when the only pipe is escaped text", () => {
    const out = view(table(header, `<w:tr>${cell(run("a|b"))}${cell(run("c"))}</w:tr>`));
    expect(out).toContain("| a\\|b | c |");
    expect(out).not.toContain("<table");
  });
});

describe("one paragraph is one line", () => {
  it("keeps a line break in picture alt text on the line", () => {
    const out = view(
      `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="n" descr="first&#10;second"/><a:graphic><a:graphicData uri="u"><pic:pic><pic:blipFill><a:blip r:embed="rIdNone"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    );
    expect(out).toContain("![first<br/>second](");
    expect(out).not.toMatch(/^second/m);
  });

  it("keeps a line break in a link target on the line", () => {
    const out = view(`<w:p><w:hyperlink r:id="rIdL"><w:r><w:t>l</w:t></w:r></w:hyperlink></w:p>`, {
      rels: { rIdL: ["hyperlink", "http://a/b\nc", true] },
    });
    expect(out).toContain("[l](<http://a/b%0Ac>)");
  });

  it("keeps a line break in an equation on the line", () => {
    const out = view(`<w:p><m:oMath><m:r><m:t>a\nb</m:t></m:r></m:oMath></w:p>`);
    expect(out).toContain("<math>a<br/>b</math>");
  });

  it("does not let a link tooltip open an HTML comment", () => {
    const out = view(
      `<w:p><w:hyperlink w:anchor="x" w:tooltip="a &lt;!-- b"><w:r><w:t>l</w:t></w:r></w:hyperlink></w:p>`,
    );
    expect(out).toContain('[l](#x "a \\<!-- b")');
  });
});

describe("equations with missing parts", () => {
  const eq = (inner: string) => view(`<w:p><m:oMath>${inner}</m:oMath></w:p>`);
  const sup = `<m:sup><m:r><m:t>2</m:t></m:r></m:sup>`;

  it("shows a superscript whose base is missing", () => {
    expect(eq(`<m:sSup>${sup}</m:sSup>`)).toContain("<math>^2</math>");
  });

  it("shows a root with a degree and no radicand", () => {
    expect(eq(`<m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg></m:rad>`)).toContain("<math>√(3&)</math>");
  });

  it("never reports a bare question mark for these shapes", () => {
    for (const inner of [
      `<m:nary>${sup}</m:nary>`,
      `<m:func></m:func>`,
      `<m:limLow></m:limLow>`,
      `<m:limUpp></m:limUpp>`,
      `<m:sSub></m:sSub>`,
      `<m:sSubSup></m:sSubSup>`,
      `<m:sPre></m:sPre>`,
    ]) {
      expect(eq(inner)).not.toContain("<math>?</math>");
    }
  });
});

describe("characters that change how a line reads", () => {
  const BIDI = "\u202e";

  it("names direction overrides and other invisible controls in text", () => {
    const out = view(p(run(`a${BIDI}b\u2066c\u0085d\u007fe\u061cf\u2062g`)));
    expect(out).toContain(
      'a<char code="202E"/>b<char code="2066"/>c<char code="0085"/>d<char code="007F"/>e<char code="061C"/>f<char code="2062"/>g',
    );
    expect(out).not.toContain(BIDI);
  });

  it("shows them by code in tag attributes and comments too", () => {
    const out = view(
      `<w:p><w:bookmarkStart w:id="1" w:name="a${BIDI}b"/><w:bookmarkEnd w:id="1"/><w:r><w:t>x</w:t></w:r></w:p>` +
        `<w:p><w:unknownThing w:val="v${BIDI}w"/></w:p>`,
    );
    expect(out).toContain('<bookmark name="aU+202Eb"/>');
    expect(out).not.toContain(BIDI);
  });
});
