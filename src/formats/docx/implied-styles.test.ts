import { describe, expect, it } from "vitest";
import { isImpliedStyle } from "./notation";
import { handDocx } from "./test-helpers";
import { generateDocxView } from "./view";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';

const style = (type: string, id: string, name: string, extra = "", attrs = "") =>
  `<w:style w:type="${type}"${attrs} w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;

const STYLES =
  style("paragraph", "Normal", "Normal", "", ' w:default="1"') +
  style("paragraph", "Heading1", "heading 1", '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>') +
  style("paragraph", "FootnoteText", "footnote text") +
  style("paragraph", "Header", "header") +
  style("paragraph", "CommentText", "annotation text") +
  style("character", "Hyperlink", "Hyperlink") +
  style("character", "fr", "Followed Hyperlink") +
  style("character", "FootnoteReference", "footnote reference") +
  style("character", "CommentReference", "annotation reference") +
  style("character", "PlaceholderText", "Placeholder Text") +
  style("character", "Strong", "Strong");

const run = (inner: string, rStyle?: string) =>
  `<w:r>${rStyle ? `<w:rPr><w:rStyle w:val="${rStyle}"/></w:rPr>` : ""}${inner}</w:r>`;
const text = (t: string) => `<w:t xml:space="preserve">${t}</w:t>`;

function view(
  body: string,
  extra: Record<string, string> = {},
  rels: Record<string, [string, string, boolean?]> = {},
): string {
  return generateDocxView(
    handDocx(body, {
      styles: STYLES,
      rels: { rIdLink: ["hyperlink", "https://example.com/", true], ...rels },
      extra,
    }),
  );
}

/** The view without its Styles appendix. */
const withoutAppendix = (v: string) => v.slice(0, v.indexOf("<!-- ==== Styles ==== -->"));

describe("implied styles", () => {
  it("matches by id or by resolved name, ignoring case and spacing", () => {
    expect(isImpliedStyle(["Footnote Text"], "FootnoteText", "x")).toBe(true);
    expect(isImpliedStyle(["Footnote Text"], "zzz", "footnote text")).toBe(true);
    expect(isImpliedStyle(["Footnote Text"], "Strong", "Strong")).toBe(false);
  });

  it("prints no style for hyperlink text, but still lists the style in the appendix", () => {
    const v = view(
      `<w:p><w:hyperlink r:id="rIdLink">${run(text("the report"), "Hyperlink")}</w:hyperlink> and <w:hyperlink r:id="rIdLink">${run(text("seen"), "fr")}</w:hyperlink></w:p>`,
    );
    const body = withoutAppendix(v);
    expect(body).toContain("[the report](https://example.com/)");
    expect(body).toContain("[seen](https://example.com/)");
    expect(body).not.toContain('style="Hyperlink"');
    expect(body).not.toContain("Followed Hyperlink");
    expect(v).toContain('<!-- style "Hyperlink"');
  });

  it("still prints a style that is not the implied one on the same construct", () => {
    const v = view(
      `<w:p><w:hyperlink r:id="rIdLink">${run(text("bold link"), "Strong")}</w:hyperlink></w:p>`,
    );
    expect(withoutAppendix(v)).toContain(
      '[<span style="Strong">bold link</span>](https://example.com/)',
    );
    // The same style outside a hyperlink is not implied.
    const plain = view(`<w:p>${run(text("plain"), "Hyperlink")}</w:p>`);
    expect(withoutAppendix(plain)).toContain('<span style="Hyperlink">plain</span>');
  });

  it("omits reference styles on note and comment references and on placeholders", () => {
    const body =
      `<w:p>${run(text("Claim"))}${run('<w:footnoteReference w:id="1"/>', "FootnoteReference")}` +
      `${run('<w:commentReference w:id="0"/>', "CommentReference")}` +
      `<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent>${run(text("Click here"), "PlaceholderText")}</w:sdtContent></w:sdt></w:p>`;
    const v = withoutAppendix(
      view(
        body,
        {
          "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:id="1"><w:p>${run("<w:footnoteRef/>", "FootnoteReference")}${run(text(" Note."))}</w:p></w:footnote></w:footnotes>`,
        },
        { rF: ["footnotes", "footnotes.xml"] },
      ),
    );
    expect(v).toContain("Claim[^1]<comment-ref");
    expect(v).toContain("[^1]: <note-number/> Note.");
    expect(v).not.toContain("Footnote Reference");
    expect(v).not.toContain("Annotation Reference");
    expect(v).not.toContain("Placeholder Text");
    expect(v).toContain("Click here");
  });

  it("omits Footnote Text in notes, Header in headers and Annotation Text in comments", () => {
    const v = withoutAppendix(
      view(
        `<w:p>${run(text("x"))}</w:p>`,
        {
          "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${run(text("Note."))}</w:p></w:footnote></w:footnotes>`,
          "word/header1.xml": `<w:hdr ${W}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${run(text("Top"))}</w:p></w:hdr>`,
          "word/comments.xml": `<w:comments ${W}><w:comment w:id="0" w:author="Ann"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${run(text("Why?"))}</w:p></w:comment></w:comments>`,
        },
        {
          rF: ["footnotes", "footnotes.xml"],
          rH: ["header", "header1.xml"],
          rC: ["comments", "comments.xml"],
        },
      ),
    );
    expect(v).toContain("[^1]: Note.");
    expect(v).toContain("Top");
    expect(v).toContain("Why?");
    expect(v).not.toMatch(/style="?(Footnote Text|Header|Annotation Text)/i);
  });

  it("still prints Heading 1 inside a footnote, and Footnote Text in the body", () => {
    const v = withoutAppendix(
      view(
        `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${run(text("Body use"))}</w:p>`,
        {
          "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(text("Odd"))}</w:p></w:footnote></w:footnotes>`,
        },
        { rF: ["footnotes", "footnotes.xml"] },
      ),
    );
    expect(v).toContain('<!-- p style="Footnote Text" -->');
    expect(v).toMatch(/Odd <!-- p style="Heading 1"/);
  });
});
