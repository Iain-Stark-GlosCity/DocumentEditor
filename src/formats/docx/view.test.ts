import { describe, expect, it } from "vitest";
import * as H from "./hand-samples";
import { handDocx, sourceFromParts, type HandOptions } from "./test-helpers";
import { generateDocxView, LEGEND } from "./view";

const RICH: HandOptions = {
  styles: H.STYLES,
  numbering: H.NUMBERING,
  rels: {
    rIdImg: ["image", "media/image1.png"],
    rIdTheme: ["theme", "theme/theme1.xml"],
    rIdLink: ["hyperlink", "https://example.com/a b", true],
  },
  extra: { "word/theme/theme1.xml": H.THEME, "word/media/image1.png": "PNG" },
};

/** The body of the view: what lies between the section line and the first appendix. */
function body(xml: string, options: HandOptions = RICH): string {
  const view = generateDocxView(handDocx(xml, options));
  const lines = view.split("\n");
  const start = lines.findIndex((l) => l.startsWith("<!-- section "));
  let end = lines.findIndex((l, i) => i > start && l.startsWith("<!-- ===="));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

describe("the view's frame", () => {
  it("starts with a short legend that points at the full one", () => {
    const view = generateDocxView(handDocx(H.P("x")));
    expect(LEGEND.length).toBeLessThanOrEqual(6);
    expect(view.startsWith(LEGEND.join("\n"))).toBe(true);
    expect(view).toContain("docs/docx-view.md");
    for (const line of LEGEND) expect(line.indexOf("-->")).toBe(line.length - 3);
  });

  it("is deterministic", () => {
    const xml = [H.P("a"), H.MERGED_TABLE, H.COMPLEX_FIELDS].join("");
    expect(generateDocxView(handDocx(xml, RICH))).toBe(generateDocxView(handDocx(xml, RICH)));
  });

  it("describes sections", () => {
    const view = generateDocxView(
      handDocx(
        H.P(
          "one",
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:type w:val="continuous"/></w:sectPr>',
        ) + H.P("two"),
        {
          ...RICH,
          sectPr:
            '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:num="2" w:space="708"/><w:titlePg/></w:sectPr>',
          rels: { ...RICH.rels, rIdH: ["header", "header1.xml"] },
          extra: {
            ...RICH.extra,
            "word/header1.xml": `<w:hdr ${'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'}><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:hdr>`,
          },
        },
      ),
    );
    expect(view).toContain(
      '<!-- section 1 of 2 page="612pt x 792pt Letter portrait" starts=continuous -->',
    );
    expect(view).toContain(
      '<!-- section 2 of 2 header-default=word/header1.xml page="841.9pt x 595.3pt A4 landscape" margins="72pt 72pt 72pt 72pt" header-distance=35.4pt footer-distance=35.4pt columns=2 column-gap=35.4pt title-page -->',
    );
    expect(view).toMatch(/one <!-- p section-ends -->\n\n<!-- section 2 of 2/);
    expect(view).toContain("<!-- word/header1.xml: section 2 header default -->\n\nHead");
  });

  it("shows document properties and settings that change meaning", () => {
    const source = handDocx(H.P("x"), {
      rels: { rIdS: ["settings", "settings.xml"] },
      extra: {
        "word/settings.xml": `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="120"/><w:trackRevisions/><w:documentProtection w:edit="readOnly" w:enforcement="1"/><w:defaultTabStop w:val="720"/><w:rsids><w:rsidRoot w:val="1"/></w:rsids></w:settings>`,
        "docProps/core.xml": `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plan</dc:title><cp:lastModifiedBy>Ann</cp:lastModifiedBy></cp:coreProperties>`,
        "docProps/app.xml": `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>3</Pages><TotalTime>12</TotalTime></Properties>`,
      },
    });
    const view = generateDocxView(source);
    expect(view).toContain("<!-- properties title=Plan last-modified-by=Ann -->");
    expect(view).toContain("<!-- application pages=3 total-time=12 -->");
    expect(view).toContain(
      '<!-- settings zoom=120% track-revisions protection="readOnly enforced" default-tab=36pt -->',
    );
    expect(view).toContain("<!-- other settings (no effect on content): w:rsids -->");
  });
});

describe("paragraphs", () => {
  it("writes headings from heading styles and outline levels, through basedOn chains", () => {
    expect(body(H.P("Intro", '<w:pStyle w:val="Heading1"/>'))).toBe(
      '# Intro <!-- p style="Heading 1" -->',
    );
    expect(body(H.P("Sub", '<w:pStyle w:val="ChapterSub"/>'))).toBe(
      '# Sub <!-- p style="Chapter Sub" -->',
    );
    expect(body(H.P("Direct", '<w:outlineLvl w:val="2"/>'))).toBe(
      "### Direct <!-- p outline-level=3 -->",
    );
  });

  it("writes quote styles as block quotes", () => {
    expect(body(H.P("Said", '<w:pStyle w:val="Quote"/>'))).toBe("> Said <!-- p style=Quote -->");
  });

  it("shows direct paragraph formatting in the trailing comment", () => {
    const pPr =
      '<w:keepNext/><w:pageBreakBefore/><w:widowControl w:val="0"/><w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="FF0000"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/><w:tabs><w:tab w:val="center" w:pos="4513"/></w:tabs><w:spacing w:before="120" w:after="240" w:line="240" w:lineRule="exact"/><w:ind w:left="720" w:firstLine="360"/><w:jc w:val="both"/>';
    expect(body(H.P("Text", pPr))).toBe(
      '"Text <!-- p keep-next page-break-before widow-control=off border-top="single 1pt FF0000 space 1pt" shading=EEEEEE tabs="center 225.65pt" spacing-before=6pt spacing-after=12pt line-spacing="exactly 12pt" indent-left=36pt first-line=18pt align=justify -->"'.slice(
        1,
        -1,
      ),
    );
  });

  it("shows an empty paragraph and keeps one line per paragraph", () => {
    expect(body("<w:p/>" + H.P("x"))).toBe("<!-- p empty -->\n\nx");
  });

  it("shows the paragraph mark's formatting and revisions", () => {
    const xml =
      '<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="Ann" w:date="2024-01-01T00:00:00Z"/><w:b/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>';
    expect(body(xml)).toBe('x <!-- p mark=bold mark-ins="Ann, 2024-01-01T00:00:00Z" -->');
  });
});

describe("lists", () => {
  it("numbers and nests lists as Word draws them, with overrides and style numbering", () => {
    const xml = [
      H.P("One", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
      H.P("One one", '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>'),
      H.P("One two", '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>'),
      H.P("Roman", '<w:numPr><w:ilvl w:val="2"/><w:numId w:val="2"/></w:numPr>'),
      H.P("Two", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
      H.P("Two one", '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>'),
      H.P("Five", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>'),
      H.P("Bullet", '<w:pStyle w:val="ListBullet"/>'),
      H.P(
        "Nested",
        '<w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>',
      ),
    ].join("");
    expect(body(xml).split("\n\n")).toEqual([
      "1. One <!-- p list=2 level=1 -->",
      "   1.1. One one <!-- p list=2 level=2 numbering=1.1. -->",
      "   1.2. One two <!-- p list=2 level=2 numbering=1.2. -->",
      "        (I) Roman <!-- p list=2 level=3 numbering=(I) -->",
      "2. Two <!-- p list=2 level=1 -->",
      "   2.1. Two one <!-- p list=2 level=2 numbering=2.1. -->",
      "5. Five <!-- p list=3 level=1 -->",
      '- Bullet <!-- p style="List Bullet" list=1 level=1 -->',
      '  - Nested <!-- p style="List Bullet" list=1 level=2 -->',
    ]);
  });

  it("lists the definitions in use, with overrides", () => {
    const view = generateDocxView(
      handDocx(
        H.P("x", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>') +
          H.P("y", '<w:pStyle w:val="ListBullet"/>'),
        RICH,
      ),
    );
    expect(view).toContain("<!-- list 3 definition=1 type=multilevel -->");
    expect(view).toContain(
      "<!--   level 1 format=decimal text=%1. start=1 start-override=5 align=left indent-left=18pt hanging=18pt -->",
    );
    expect(view).toContain(
      '<!--   level 1 format=bullet text=U+F0B7 start=1 align=left indent-left=36pt hanging=18pt number-format="font=Symbol font-hint=default" -->',
    );
  });
});

describe("runs", () => {
  it("uses Markdown for bold, italic and strike and tags for the rest", () => {
    const run = (rPr: string, text: string) =>
      `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const xml = `<w:p>${[
      run("<w:b/><w:bCs/>", "bold"),
      run("", " "),
      run("<w:i/>", "italic"),
      run("", " "),
      run("<w:strike/>", "gone"),
      run("", " "),
      run('<w:u w:val="wave" w:color="FF0000"/>', "wavy"),
      run("", " "),
      run('<w:vertAlign w:val="superscript"/>', "up"),
      run("", " "),
      run(
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="MS Mincho" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="20"/><w:color w:val="C00000"/><w:highlight w:val="yellow"/>',
        "fancy",
      ),
      run("", " "),
      run(
        '<w:b w:val="0"/><w:caps/><w:smallCaps/><w:vanish/><w:dstrike/><w:spacing w:val="20"/><w:w w:val="80"/><w:kern w:val="28"/><w:position w:val="6"/><w:lang w:val="fr-FR"/><w:emboss/>',
        "rest",
      ),
      run('<w:rStyle w:val="Strong"/>', "styled"),
    ].join("")}</w:p>`;
    expect(body(xml)).toBe(
      '**bold** *italic* ~~gone~~ <u type="wave" colour="FF0000">wavy</u> <sup>up</sup> <span font="Arial" font-east-asia="MS Mincho" size="12pt" size-cs="10pt" colour="C00000" highlight="yellow">fancy</span> <span bold="off" caps small-caps hidden double-strike letter-spacing="1pt" scale="80%" kern="from 14pt" raise="3pt" lang="fr-FR" emboss>rest</span><span style="Strong">styled</span>',
    );
  });

  it("shows theme colours, theme fonts and shading", () => {
    expect(body(H.THEME_COLOURS)).toBe(
      '<span colour="2F5496 (accent1, shade BF)">Shaded accent</span><span colour="ED7D31 (accent2)"> plain accent2</span><span font="+headings (Calibri Light)" shading="DAE3F3 (accent1, tint 33)"> heading font</span>',
    );
  });

  it("makes tabs, breaks, special characters and edge spaces visible", () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve">  a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:br w:type="page"/><w:cr/><w:sym w:font="Wingdings" w:char="F0FC"/><w:noBreakHyphen/><w:softHyphen/><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="dot"/><w:br w:type="column"/><w:t xml:space="preserve">d\u00a0e </w:t><w:lastRenderedPageBreak/></w:r></w:p>';
    expect(body(xml)).toBe(
      '<sp n="2"/>a<tab/>b<br/>c<br type="page"/><br/><sym font="Wingdings" char="F0FC"/><nbhy/><shy/><ptab align="right" relative-to="margin" leader="dot"/><br type="column"/>d<nbsp/>e<sp/>',
    );
  });

  it("escapes the document's own Markdown and HTML characters", () => {
    expect(body(H.P("1. *not* &lt;b>bold&lt;/b> [x](y) # \\ snake_case"))).toBe(
      "1\\. \\*not\\* \\<b>bold\\</b> \\[x\\](y) \\# \\\\ snake_case",
    );
  });

  it("shows hyperlinks and bookmarks", () => {
    const xml =
      '<w:p><w:bookmarkStart w:id="0" w:name="_Top"/><w:bookmarkEnd w:id="0"/><w:hyperlink r:id="rIdLink" w:tooltip="Go"><w:r><w:t>out</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> </w:t></w:r><w:bookmarkStart w:id="1" w:name="here"/><w:hyperlink w:anchor="_Top"><w:r><w:t>up</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="1"/><w:hyperlink r:id="rIdNone"><w:r><w:t>broken</w:t></w:r></w:hyperlink></w:p>';
    expect(body(xml)).toBe(
      '<bookmark name="_Top"/>[out](<https://example.com/a b> "Go") <bookmark-start name="here"/>[up](#_Top)<bookmark-end name="here"/>[broken](<rIdNone (missing relationship)>)',
    );
  });
});

describe("fields", () => {
  it("shows simple and complex fields with the code and the cached result", () => {
    const simple =
      '<w:p><w:fldSimple w:instr=" NUMPAGES  \\* MERGEFORMAT "><w:r><w:t>4</w:t></w:r></w:fldSimple></w:p>';
    expect(body(simple)).toBe('<field code="NUMPAGES \\* MERGEFORMAT">4</field>');
    expect(body(H.COMPLEX_FIELDS).split("\n\n")).toEqual([
      `Page <field code="PAGE"><span no-proof>3</span></field> printed <field code='DATE \\@ "d MMMM yyyy"'>1 May 2024</field>`,
      `<field code='IF { MERGEFIELD Gender } = "F" "Ms" "Mr"'>Ms</field>`,
    ]);
  });

  it("follows a field across paragraphs (a table of contents)", () => {
    expect(body(H.TOC).split("\n\n")).toEqual([
      '<!-- sdt type=building-block id=-1 gallery="Table of Contents" -->',
      `<field code='TOC \\o "1-3" \\h \\z \\u'>[Introduction<tab/><field code="PAGEREF _Toc1 \\h">1</field>](#_Toc1) <!-- p style=TOC1 tabs="right dot 450.8pt" -->`,
      "</field>",
      "<!-- /sdt -->",
    ]);
  });
});

describe("tables", () => {
  const cell = (text: string, tcPr = "") =>
    `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

  it("uses a pipe table when it is faithful", () => {
    const xml = `<w:tbl><w:tblPr><w:tblStyle w:val="GridTable4"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr>${cell("A|B")}${cell("1. x")}</w:tr><w:tr>${cell("c")}${cell("")}</w:tr></w:tbl>`;
    expect(body(xml)).toBe(
      [
        '<!-- table style="Grid Table 4" width=auto look="first-row first-column banded-rows" grid="50pt 50pt" header=style -->',
        "| A\\|B | 1. x |",
        "| --- | --- |",
        "| c |   |",
      ].join("\n"),
    );
  });

  it("uses an HTML table for merges, with rowspan and colspan", () => {
    expect(body(H.MERGED_TABLE)).toBe(
      [
        '<table style="Grid Table 4" width="100%" look="first-row first-column banded-rows" grid="100pt 100pt 100pt">',
        "  <tr header>",
        '    <td colspan="2" width="200pt">Wide</td>',
        '    <td rowspan="3" shading="FFFF00">Tall</td>',
        "  </tr>",
        "  <tr>",
        "    <td>a</td>",
        "    <td>b</td>",
        "    <!-- merged into the cell above -->",
        "  </tr>",
        "  <tr>",
        "    <td>c</td>",
        "    <td>d</td>",
        "    <!-- merged into the cell above -->",
        "  </tr>",
        "</table>",
      ].join("\n"),
    );
  });

  it("nests tables, and stops at a depth limit instead of failing", () => {
    expect(body(H.NESTED_TABLE)).toContain(
      '      <table width="auto" grid="100pt">\n        <tr>\n          <td>Inner</td>',
    );
    let deep = H.P("core");
    for (let i = 0; i < 200; i++) deep = `<w:tbl><w:tr><w:tc>${deep}</w:tc></w:tr></w:tbl>`;
    const out = body(deep);
    expect(out).toContain("table nested deeper than 40 levels");
    expect(out.split("\n").every((line) => line.trim() !== "")).toBe(true);
  });
});

describe("drawings, shapes and equations", () => {
  it("shows inline and anchored pictures with their size, alt text and target", () => {
    expect(body(H.ANCHORED_PICTURE)).toBe(
      '<drawing kind="picture" name="Picture 7" width="50pt" height="25pt" placement="anchored" horizontal="page right" vertical="page +20pt" wrap="none" behind-text>![Watermark](word/media/image1.png)</drawing>',
    );
  });

  it("shows the chosen branch of mc:AlternateContent and names the other", () => {
    expect(body(H.ALTERNATE_CONTENT)).toBe(
      '<!-- alternate-content showing Choice Requires=wps (w:drawing); also Fallback (w:pict) --><drawing kind="text box" name="Text Box 1" width="144pt" height="72pt" placement="anchored" horizontal="column +1pt" vertical="paragraph top" wrap="square bothSides" geometry="rect">Boxed text</drawing>',
    );
  });

  it("summarises VML and shows it raw", () => {
    const out = body(H.VML_PICT);
    expect(out).toMatch(
      /^<vml kind="vml" shape="shape" id="_x0000_i1025" style="width:100pt;height:50pt">!\[Old logo\]\(word\/media\/image1.png\)<\/vml> <!-- raw path="\/w:document\/w:body\/w:p\/w:r\/w:pict" <w:pict>/,
    );
  });

  it("gives equations a linear form and the raw OMML", () => {
    const out = body(H.MATH);
    expect(out).toMatch(/^<math display="block">x=\(-b±√\(b\^2-4ac\)\)\/2a<\/math> <!-- raw path=/);
    expect(out).toContain("(truncated: 350 characters in all)");
  });
});

describe("revisions, content controls and smart tags", () => {
  it("shows moves and formatting changes", () => {
    expect(body(H.MOVES + H.FORMAT_CHANGES).split("\n\n")).toEqual([
      '<move-from-range name="move1" id="1" author="Ann" date="2024-06-01T00:00:00Z"><move-from id="2" author="Ann" date="2024-06-01T00:00:00Z">Moved sentence.</move-from></move-from-range>',
      '<move-to-range name="move1" id="3" author="Ann" date="2024-06-01T00:00:00Z"><move-to id="4" author="Ann" date="2024-06-01T00:00:00Z">Moved sentence.</move-to></move-to-range>',
      '<format-change id="6" author="Bob" date="2024-06-02T00:00:00Z" was="italic">**Now bold, was italic**</format-change> <!-- p align=centre changed-by="Bob, 2024-06-02T00:00:00Z" was="align=left" -->',
    ]);
  });

  it("shows inline content controls with their type and placeholder state", () => {
    expect(body(H.SDT_INLINE)).toBe(
      'Date: <sdt type="date" alias="Signed on" tag="signDate" id="12345" placeholder-showing date-format="dd/MM/yyyy">Click to enter a date.</sdt> Agree: <sdt type="checkbox" id="99" checked="yes">☒</sdt>',
    );
  });

  it("shows smart tags with their properties", () => {
    expect(body(H.SMART_TAG)).toBe(
      'Meet in <smart-tag element="City" uri="urn:schemas-microsoft-com:office:smarttags" prop-country="UK">London</smart-tag>.',
    );
  });
});

describe("notes and comments", () => {
  const W =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
  it("shows footnotes as Markdown footnotes and comments with replies and their anchor", () => {
    const xml =
      '<w:p><w:r><w:t>Claim</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve"> disputed part</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>';
    const view = generateDocxView(
      handDocx(xml, {
        rels: {
          a: ["footnotes", "footnotes.xml"],
          b: ["comments", "comments.xml"],
          c: ["commentsExtended", "commentsExtended.xml"],
        },
        extra: {
          "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> First.</w:t></w:r></w:p><w:p><w:r><w:t>Second.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
          "word/comments.xml": `<w:comments ${W}><w:comment w:id="0" w:author="Ann" w:initials="A" w:date="2024-01-01T00:00:00Z"><w:p w14:paraId="11111111"><w:r><w:t>Why?</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="Bob" w:date="2024-01-02T00:00:00Z"><w:p w14:paraId="22222222"><w:r><w:t>Because.</w:t></w:r></w:p></w:comment></w:comments>`,
          "word/commentsExtended.xml": `<w15:commentsEx ${W}><w15:commentEx w15:paraId="11111111" w15:done="0"/><w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="1"/></w15:commentsEx>`,
        },
      }),
    );
    expect(view).toContain(
      'Claim<sup>[^1]</sup><comment id="0"> disputed part</comment><comment-ref id="0"/>',
    );
    expect(view).toContain(
      "<!-- footnote -1 type=separator (Word's separator line, not a note) -->\n<separator/>",
    );
    expect(view).toContain("[^1]: <note-number/> First.\n\n    Second.");
    expect(view).toContain(
      '<!-- comment id=0 author=Ann initials=A date=2024-01-01T00:00:00Z on=" disputed part" -->\n\nWhy?',
    );
    expect(view).toContain(
      "<!-- comment id=1 author=Bob date=2024-01-02T00:00:00Z reply-to=0 resolved -->\n\nBecause.",
    );
  });
});

describe("styles", () => {
  it("lists every style in use with what it defines and what it resolves to", () => {
    const view = generateDocxView(handDocx(H.P("x", '<w:pStyle w:val="ChapterSub"/>'), RICH));
    const styles = view.slice(view.indexOf("<!-- ==== Styles ==== -->"));
    expect(styles).toContain(
      '<!-- document defaults paragraph: spacing-after=8pt line-spacing=1.08 | text: font="+body (Calibri)" font-cs=+body size=11pt lang=en-GB lang-east-asia=en-US lang-cs=ar-SA -->',
    );
    // The chain: Chapter Sub -> Chapter -> Heading 1 -> Normal, and Heading 1's linked style.
    for (const name of [
      '"Chapter Sub"',
      '"Chapter"',
      '"Heading 1"',
      '"Heading 1 Char"',
      '"Normal"',
    ]) {
      expect(styles).toContain(`<!-- style ${name} `);
    }
    expect(styles).toContain("<!--   defines text: size=14pt -->");
    expect(styles).toMatch(
      /<!-- {3}resolved paragraph: spacing-before=12pt spacing-after=0pt line-spacing=1.08 keep-next keep-lines outline-level=1 align=centre \| text: .*colour="2F5496 \(accent1, shade BF\)".* caps size=14pt -->/,
    );
    expect(styles).not.toContain('style "Quote"');
  });

  it("shows table styles with their conditional formatting", () => {
    const view = generateDocxView(handDocx(H.MERGED_TABLE, RICH));
    expect(view).toContain(
      "<!--   when firstRow: text: bold colour=FFFFFF | cell: shading=000000 -->",
    );
  });
});

describe("robustness", () => {
  it("never throws, whatever the parts hold", () => {
    const garbage = Array.from({ length: 2000 }, (_, i) =>
      String.fromCharCode((i * 7919) % 65536),
    ).join("");
    const cases = [
      sourceFromParts({}),
      sourceFromParts({ "word/document.xml": "" }),
      sourceFromParts({ "word/document.xml": garbage }),
      sourceFromParts({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>unclosed" }),
      handDocx("<w:p><w:r><w:t>a</w:t></w:p></w:r><w:tbl><w:tr></w:tbl>"),
      handDocx(H.P("x"), {
        styles: "<w:style w:styleId='A'><w:basedOn w:val='A'/></w:style>",
        numbering: garbage,
      }),
      handDocx(H.P("x", '<w:numPr><w:ilvl w:val="99"/><w:numId w:val="77"/></w:numPr>'), {
        numbering: "",
      }),
      handDocx(
        `<w:p><w:r><w:fldChar w:fldCharType="end"/><w:fldChar w:fldCharType="begin"/></w:r></w:p>`,
      ),
      {
        names: () => ["word/document.xml"],
        text: () => {
          throw new Error("boom");
        },
      },
      {
        names: () => {
          throw new Error("boom");
        },
        text: () => undefined,
      },
    ];
    for (const source of cases) {
      expect(() => generateDocxView(source)).not.toThrow();
      expect(generateDocxView(source).startsWith(LEGEND[0]!)).toBe(true);
    }
  });

  it("says when the XML is damaged and still shows what it can", () => {
    const view = generateDocxView(
      sourceFromParts({
        "word/document.xml":
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>kept</w:t></w:r>',
      }),
    );
    expect(view).toContain("the XML of word/document.xml is damaged");
    expect(view).toContain("kept");
  });

  it("works without styles, numbering, rels or theme", () => {
    const view = generateDocxView(
      sourceFromParts({
        "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
      }),
    );
    expect(view).toContain('x <!-- p style=Heading1 list=1 level=1 numbering="not defined" -->');
    expect(view).toContain("<!-- styles used but not defined in styles.xml: Heading1 -->");
    expect(view).toContain("<!-- list 1: not defined in numbering.xml -->");
  });

  it("shows unknown elements as raw placeholders with their path, truncating long ones", () => {
    const big = `<w:p><w:customThing w:a="1">${"<w:x/>".repeat(500)}</w:customThing></w:p>`;
    const out = body(big);
    expect(out).toMatch(
      /^<!-- raw path="\/w:document\/w:body\/w:p\/w:customThing" <w:customThing w:a="1"><w:x\/>/,
    );
    expect(out).toMatch(/… \(truncated: 3,039 characters in all\) -->$/);
  });

  it("never lets document text end a comment or open a tag", () => {
    const out = body(H.P("x --&gt; &lt;!-- y", '<w:pStyle w:val="Heading1"/>'));
    expect(out).toBe('# x --> \\<!-- y <!-- p style="Heading 1" -->');
    const attr = body(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="A-->B"/></w:rPr><w:t>t</w:t></w:r></w:p>',
    );
    expect(attr).toBe('<span font="A-\u2010&gt;B">t</span>');
  });

  it("handles enormous paragraphs", () => {
    const text = "word ".repeat(200_000);
    const out = body(H.P(text));
    expect(out.length).toBeGreaterThan(text.length - 10);
  });

  it("refuses a main part over the size limit with a short notice", () => {
    const view = generateDocxView(handDocx(H.P("x".repeat(2000))), { maxMainPartSize: 1000 });
    expect(view).toContain("more than the 0 MB the Formatting view reads");
    expect(view.split("\n").length).toBeLessThan(10);
  });
});

describe("performance", () => {
  it("renders 10,000 paragraphs quickly", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      paragraphs.push(
        i % 50 === 0
          ? H.P(`Heading ${i}`, '<w:pStyle w:val="Heading1"/>')
          : `<w:p w:rsidR="00A1"><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">Paragraph ${i} with some </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve"> and coloured text, long enough to be realistic for a report.</w:t></w:r></w:p>`,
      );
    }
    const source = handDocx(paragraphs.join(""), RICH);
    const start = performance.now();
    const view = generateDocxView(source);
    const ms = performance.now() - start;
    expect(view.split("\n").length).toBeGreaterThan(20_000);
    // The target is about 1.5 s; the bound leaves room for slow CI machines.
    expect(ms).toBeLessThan(4000);
  });
});
