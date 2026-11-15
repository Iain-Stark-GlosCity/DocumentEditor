/**
 * Test fixtures for the integrity inspector (imported by tests only). Real Word files are never
 * committed: `cleanParts()` is a hand-written package as Word writes one, with the messy but legal
 * things real files contain (latent styles, `mc:AlternateContent`, `numId 0`, hidden bookmarks, a
 * header used by two sections, an external hyperlink). `MUTATIONS` each inject one defect.
 */
import { NS, sourceFromParts } from "../test-helpers";
import type { PartSource } from "../package";

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.wordprocessingml";

export type Parts = Record<string, string>;

const rels = (list: [string, string, string, boolean?][]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">` +
  list
    .map(
      ([id, type, target, external]) =>
        `<Relationship Id="${id}" Type="${type.includes("/") ? type : `${REL}/${type}`}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("") +
  "</Relationships>";

const xml = (root: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${root} ${NS}>${body}</${root}>`;

const LATENT = [
  "Normal",
  "heading 1",
  "heading 2",
  "heading 3",
  "Title",
  "Subtitle",
  "Strong",
  "Emphasis",
  "Quote",
  "Intense Quote",
  "List Paragraph",
  "Table Grid",
]
  .map((n, i) => `<w:lsdException w:name="${n}" w:uiPriority="${i + 1}" w:qFormat="1"/>`)
  .join("");

export const STYLES_BODY = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0" w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="376">${LATENT}</w:latentStyles>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:semiHidden/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1Char"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:link w:val="Heading2Char"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Heading1"/><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="Heading2Char"><w:name w:val="Heading 2 Char"/><w:basedOn w:val="Heading1Char"/><w:link w:val="Heading2"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Disclaimer"><w:name w:val="Disclaimer"/><w:basedOn w:val="Note"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:link w:val="FootnoteTextChar"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="FootnoteTextChar"><w:name w:val="Footnote Text Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="FootnoteText"/></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/></w:style>
<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style>`;

export const NUMBERING_BODY = (() => {
  const formats = ["decimal", "lowerLetter", "lowerRoman"];
  const lvl = (i: number, fmt: string, text: string) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  const multi = Array.from({ length: 9 }, (_, i) => lvl(i, formats[i % 3]!, `%${i + 1}.`)).join("");
  const bullets = Array.from({ length: 9 }, (_, i) => lvl(i, "bullet", "•")).join("");
  return (
    `<w:abstractNum w:abstractNumId="0" w15:restartNumberingAfterBreak="0"><w:nsid w:val="1A2B3C4D"/><w:multiLevelType w:val="multilevel"/><w:tmpl w:val="0409001D"/>${multi}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:nsid w:val="5E6F7A8B"/><w:multiLevelType w:val="hybridMultilevel"/>${bullets}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`
  );
})();

const p = (text: string, pPr = "", rPr = "") =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const TEXT_BOX = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="914400"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="2" name="Text Box 2"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent><w:p><w:bookmarkStart w:id="9" w:name="BoxNote"/><w:r><w:t>Boxed</w:t></w:r><w:bookmarkEnd w:id="9"/></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="Text Box 2" o:spid="_x0000_s1026" style="position:absolute;width:2in;height:1in"><v:textbox><w:txbxContent><w:p><w:bookmarkStart w:id="9" w:name="BoxNote"/><w:r><w:t>Boxed</w:t></w:r><w:bookmarkEnd w:id="9"/></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;

const IMAGE = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Picture 1" descr="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const FIELD = `<w:p><w:r><w:t xml:space="preserve">See section </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _Ref123 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

const SECTION_1 = `<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:headerReference w:type="first" r:id="rId9"/><w:footerReference w:type="default" r:id="rId10"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:titlePg/><w:docGrid w:linePitch="360"/></w:sectPr>`;

const SECTION_2 = `<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:footerReference w:type="default" r:id="rId10"/><w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

export const BODY = [
  p("Annual review", `<w:pStyle w:val="Title"/>`),
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="0" w:name="_Toc100"/><w:bookmarkStart w:id="1" w:name="_Ref123"/><w:r><w:t>Summary</w:t></w:r><w:bookmarkEnd w:id="0"/><w:bookmarkEnd w:id="1"/></w:p>`,
  `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">Revenue grew</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:r><w:t xml:space="preserve"> and costs fell</w:t></w:r><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="1"/></w:r><w:bookmarkStart w:id="2" w:name="_GoBack"/><w:bookmarkEnd w:id="2"/></w:p>`,
  `<w:p><w:r><w:t xml:space="preserve">Details are on </w:t></w:r><w:hyperlink r:id="rId21" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the website</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> and in </w:t></w:r><w:hyperlink w:anchor="Results" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the results</w:t></w:r></w:hyperlink></w:p>`,
  p(
    "First step",
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`,
  ),
  p(
    "Sub step",
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>`,
  ),
  p(
    "Point",
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>`,
  ),
  p("Numbered by its style", `<w:pStyle w:val="ListNumber"/>`),
  p(
    "Style says numbered, this one is not",
    `<w:pStyle w:val="ListNumber"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>`,
  ),
  p("Results", `<w:pStyle w:val="Heading2"/>`)
    .replace("<w:r>", `<w:bookmarkStart w:id="3" w:name="Results"/><w:r>`)
    .replace("</w:r></w:p>", `</w:r><w:bookmarkEnd w:id="3"/></w:p>`),
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="4508"/><w:gridCol w:w="4508"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4508" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:tcPr>${p("Region", "", `<w:color w:val="FFFFFF"/>`)}</w:tc><w:tc><w:tcPr><w:tcW w:w="4508" w:type="dxa"/></w:tcPr>${p("Total")}</w:tc></w:tr></w:tbl>`,
  `<w:p><w:r><w:t xml:space="preserve">Signed: </w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Signature"/><w:tag w:val="sig"/><w:id w:val="-1234567"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:t>Click here.</w:t></w:r></w:sdtContent></w:sdt></w:p>`,
  FIELD,
  IMAGE,
  TEXT_BOX,
  p("Closing note", `<w:pStyle w:val="Note"/>`),
  `<w:p><w:pPr>${SECTION_1}</w:pPr></w:p>`,
  p("Appendix", `<w:pStyle w:val="Heading1"/>`),
  p("Plain text in the second section."),
  SECTION_2,
].join("\n");

const HEADER_DEFAULT = `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

const separators = (kind: "footnote" | "endnote") =>
  `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;

/** A clean, realistic Word package as parts. Inspecting it gives info findings at most. */
export function cleanParts(): Parts {
  return {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/><Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/><Override PartName="/word/header2.xml" ContentType="${CT}.header+xml"/><Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/><Override PartName="/word/comments.xml" ContentType="${CT}.comments+xml"/><Override PartName="/word/footnotes.xml" ContentType="${CT}.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="${CT}.endnotes+xml"/><Override PartName="/word/fontTable.xml" ContentType="${CT}.fontTable+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    "_rels/.rels": rels([
      ["rId3", "extended-properties", "docProps/app.xml"],
      [
        "rId2",
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "docProps/core.xml",
      ],
      ["rId1", "officeDocument", "word/document.xml"],
    ]),
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Annual review</dc:title></cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>`,
    "word/document.xml": xml("w:document", `<w:body>${BODY}</w:body>`),
    "word/_rels/document.xml.rels": rels([
      ["rId1", "styles", "styles.xml"],
      ["rId2", "numbering", "numbering.xml"],
      ["rId3", "settings", "settings.xml"],
      ["rId4", "fontTable", "fontTable.xml"],
      ["rId5", "footnotes", "footnotes.xml"],
      ["rId6", "endnotes", "endnotes.xml"],
      ["rId7", "comments", "comments.xml"],
      ["rId8", "header", "header1.xml"],
      ["rId9", "header", "header2.xml"],
      ["rId10", "footer", "footer1.xml"],
      ["rId11", "theme", "theme/theme1.xml"],
      ["rId20", "image", "media/image1.png"],
      ["rId21", "hyperlink", "https://example.com/annual%20review", true],
    ]),
    "word/styles.xml": xml("w:styles", STYLES_BODY),
    "word/numbering.xml": xml("w:numbering", NUMBERING_BODY),
    "word/settings.xml": xml(
      "w:settings",
      `<w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:rsids><w:rsidRoot w:val="00A1B2C3"/></w:rsids>`,
    ),
    "word/header1.xml": xml("w:hdr", HEADER_DEFAULT),
    "word/header2.xml": xml("w:hdr", p("Confidential", `<w:pStyle w:val="Header"/>`)),
    "word/footer1.xml": xml("w:ftr", p("Annual review", `<w:pStyle w:val="Footer"/>`)),
    "word/comments.xml": xml(
      "w:comments",
      `<w:comment w:id="0" w:author="A Reviewer" w:date="2024-05-01T10:00:00Z" w:initials="AR"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment>`,
    ),
    "word/footnotes.xml": xml(
      "w:footnotes",
      separators("footnote") +
        `<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Unaudited.</w:t></w:r></w:p></w:footnote>`,
    ),
    "word/endnotes.xml": xml(
      "w:endnotes",
      separators("endnote") +
        `<w:endnote w:id="1"><w:p><w:pPr><w:pStyle w:val="EndnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> Source.</w:t></w:r></w:p></w:endnote>`,
    ),
    "word/fontTable.xml": xml(
      "w:fonts",
      `<w:font w:name="Calibri"><w:panose1 w:val="020F0502020204030204"/></w:font>`,
    ),
    "word/theme/theme1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    "word/media/image1.png": "\u0089PNG\r\n",
  };
}

export function toSource(parts: Parts): PartSource {
  return sourceFromParts(parts);
}

/** Replaces exactly one occurrence of `from` in a part, failing loudly if it is not there. */
export function replaceOnce(parts: Parts, part: string, from: string, to: string): Parts {
  const text = parts[part];
  if (text === undefined) throw new Error(`no part ${part}`);
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`"${from}" not found in ${part}`);
  return { ...parts, [part]: text.slice(0, at) + to + text.slice(at + from.length) };
}

const without = (parts: Parts, name: string): Parts => {
  const out = { ...parts };
  delete out[name];
  return out;
};

const DOC = "word/document.xml";
const STYLES = "word/styles.xml";
const NUMBERING = "word/numbering.xml";
const SETTINGS = "word/settings.xml";
const DOC_RELS = "word/_rels/document.xml.rels";
const CT_PART = "[Content_Types].xml";
const LAST_P =
  '<w:p><w:r><w:t xml:space="preserve">Plain text in the second section.</w:t></w:r></w:p>';
const addToBody = (parts: Parts, xmlText: string) =>
  replaceOnce(parts, DOC, LAST_P, LAST_P + xmlText);

export interface Mutation {
  /** What the defect is, for the test name. */
  name: string;
  rule: string;
  severity: "error" | "warning" | "info";
  /** The part the first location must name. */
  part: string;
  /** The written name of the element the first location's locator must point at (none: no locator). */
  element?: string;
  apply(parts: Parts): Parts;
}

/** One defect each, covering every rule code the inspector reports. */
export const MUTATIONS: Mutation[] = [
  // package
  {
    name: "no officeDocument relationship",
    rule: "package.no-main-document",
    severity: "error",
    part: "_rels/.rels",
    element: "Relationships",
    apply: (p) =>
      replaceOnce(
        p,
        "_rels/.rels",
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`,
        "",
      ),
  },
  {
    name: "image part deleted",
    rule: "package.relationship-target-missing",
    severity: "error",
    part: DOC_RELS,
    element: "Relationship",
    apply: (p) => without(p, "word/media/image1.png"),
  },
  {
    name: "attached template not marked external",
    rule: "package.relationship-target-missing",
    severity: "warning",
    part: "word/_rels/settings.xml.rels",
    element: "Relationship",
    apply: (p) => ({
      ...p,
      "word/_rels/settings.xml.rels": rels([
        ["rId1", "attachedTemplate", "file:///C:/Templates/Normal.dotm"],
      ]),
    }),
  },
  {
    name: "duplicate relationship id",
    rule: "package.duplicate-relationship-id",
    severity: "error",
    part: DOC_RELS,
    element: "Relationship",
    apply: (p) => replaceOnce(p, DOC_RELS, `Id="rId4"`, `Id="rId3"`),
  },
  {
    name: "relationships of a deleted part",
    rule: "package.relationship-source-missing",
    severity: "info",
    part: "word/_rels/header9.xml.rels",
    element: "Relationships",
    apply: (p) => ({
      ...p,
      "word/_rels/header9.xml.rels": rels([["rId1", "image", "media/image1.png"]]),
    }),
  },
  {
    name: "no [Content_Types].xml",
    rule: "package.content-types-missing",
    severity: "error",
    part: CT_PART,
    apply: (p) => without(p, CT_PART),
  },
  {
    name: "no content type for png",
    rule: "package.missing-content-type",
    severity: "error",
    part: "word/media/image1.png",
    apply: (p) => replaceOnce(p, CT_PART, `<Default Extension="png" ContentType="image/png"/>`, ""),
  },
  {
    name: "override for a missing part",
    rule: "package.override-part-missing",
    severity: "warning",
    part: CT_PART,
    element: "Override",
    apply: (p) =>
      replaceOnce(
        p,
        CT_PART,
        "</Types>",
        `<Override PartName="/word/glossary/document.xml" ContentType="${CT}.document.glossary+xml"/></Types>`,
      ),
  },
  {
    name: "image refers to an unknown relationship id",
    rule: "package.unresolved-relationship-reference",
    severity: "error",
    part: DOC,
    element: "a:blip",
    apply: (p) => replaceOnce(p, DOC, `r:embed="rId20"`, `r:embed="rId99"`),
  },
  {
    name: "unreferenced part",
    rule: "package.orphan-part",
    severity: "info",
    part: "word/media/old-logo.png",
    apply: (p) => ({ ...p, "word/media/old-logo.png": "\u0089PNG" }),
  },
  {
    name: "two parts differ only in case",
    rule: "package.part-name-case-collision",
    severity: "error",
    part: "word/Media/image1.png",
    apply: (p) => ({ ...p, "word/Media/image1.png": "\u0089PNG" }),
  },
  {
    name: "damaged header XML",
    rule: "package.malformed-xml",
    severity: "error",
    part: "word/header2.xml",
    element: "w:hdr",
    apply: (p) => replaceOnce(p, "word/header2.xml", "</w:p>", ""),
  },
  // styles
  {
    name: "custom paragraph style not defined",
    rule: "styles.undefined-style",
    severity: "warning",
    part: DOC,
    element: "w:pStyle",
    apply: (p) =>
      replaceOnce(p, DOC, `<w:pStyle w:val="Note"/>`, `<w:pStyle w:val="LegalSmallPrint"/>`),
  },
  {
    name: "built-in style used but not defined",
    rule: "styles.undefined-style",
    severity: "info",
    part: DOC,
    element: "w:pStyle",
    apply: (p) =>
      replaceOnce(p, DOC, `<w:pStyle w:val="Note"/>`, `<w:pStyle w:val="IntenseQuote"/>`),
  },
  {
    name: "styles part missing while styles are used",
    rule: "styles.styles-part-missing",
    severity: "warning",
    part: DOC,
    element: "w:pStyle",
    apply: (p) =>
      replaceOnce(
        without(p, STYLES),
        DOC_RELS,
        `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`,
        "",
      ),
  },
  {
    name: "basedOn a missing style",
    rule: "styles.based-on-missing",
    severity: "warning",
    part: STYLES,
    element: "w:basedOn",
    apply: (p) => replaceOnce(p, STYLES, `<w:basedOn w:val="Note"/>`, `<w:basedOn w:val="Ghost"/>`),
  },
  {
    name: "link to a missing style",
    rule: "styles.link-missing",
    severity: "info",
    part: STYLES,
    element: "w:link",
    apply: (p) =>
      replaceOnce(p, STYLES, `<w:link w:val="Heading2Char"/>`, `<w:link w:val="Heading2Kar"/>`),
  },
  {
    name: "next names a missing style",
    rule: "styles.next-missing",
    severity: "info",
    part: STYLES,
    element: "w:next",
    apply: (p) =>
      replaceOnce(
        p,
        STYLES,
        `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:i/>`,
        `<w:basedOn w:val="Normal"/><w:next w:val="BodyCopy"/><w:rPr><w:i/>`,
      ),
  },
  {
    name: "basedOn cycle",
    rule: "styles.based-on-cycle",
    severity: "warning",
    part: STYLES,
    element: "w:basedOn",
    apply: (p) =>
      replaceOnce(
        p,
        STYLES,
        `<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>`,
        `<w:name w:val="heading 1"/><w:basedOn w:val="Heading2"/>`,
      ),
  },
  {
    name: "duplicate style id",
    rule: "styles.duplicate-id",
    severity: "warning",
    part: STYLES,
    element: "w:style",
    apply: (p) =>
      replaceOnce(
        p,
        STYLES,
        `w:styleId="Disclaimer"><w:name w:val="Disclaimer"/>`,
        `w:styleId="Note"><w:name w:val="Disclaimer"/>`,
      ),
  },
  {
    name: "two styles with the same name",
    rule: "styles.duplicate-name",
    severity: "warning",
    part: STYLES,
    element: "w:style",
    apply: (p) => replaceOnce(p, STYLES, `<w:name w:val="Disclaimer"/>`, `<w:name w:val="Note"/>`),
  },
  {
    name: "very deep basedOn chain",
    rule: "styles.deep-based-on-chain",
    severity: "info",
    part: STYLES,
    element: "w:style",
    apply: (p) =>
      replaceOnce(
        p,
        STYLES,
        "</w:styles>",
        Array.from(
          { length: 12 },
          (_, i) =>
            `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Deep${i}"><w:name w:val="Deep ${i}"/><w:basedOn w:val="${i === 0 ? "Normal" : `Deep${i - 1}`}"/></w:style>`,
        ).join("") + "</w:styles>",
      ),
  },
  {
    name: "no default paragraph style",
    rule: "styles.no-default-paragraph-style",
    severity: "info",
    part: STYLES,
    element: "w:styles",
    apply: (p) => replaceOnce(p, STYLES, `w:type="paragraph" w:default="1"`, `w:type="paragraph"`),
  },
  {
    name: "styles defined but not used (in the clean base)",
    rule: "styles.unused-styles",
    severity: "info",
    part: STYLES,
    element: "w:style",
    apply: (p) => p,
  },
  // numbering
  {
    name: "paragraph uses an undefined list",
    rule: "numbering.undefined-num",
    severity: "error",
    part: DOC,
    element: "w:numId",
    apply: (p) => replaceOnce(p, DOC, `<w:numId w:val="2"/>`, `<w:numId w:val="7"/>`),
  },
  {
    name: "list instance without its definition",
    rule: "numbering.missing-abstract",
    severity: "error",
    part: NUMBERING,
    element: "w:abstractNumId",
    apply: (p) =>
      replaceOnce(
        p,
        NUMBERING,
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>`,
        `<w:num w:numId="2"><w:abstractNumId w:val="9"/>`,
      ),
  },
  {
    name: "paragraph on list level 9",
    rule: "numbering.level-out-of-range",
    severity: "warning",
    part: DOC,
    element: "w:ilvl",
    apply: (p) => replaceOnce(p, DOC, `<w:ilvl w:val="1"/>`, `<w:ilvl w:val="9"/>`),
  },
  {
    name: "numbering proliferation",
    rule: "numbering.proliferation",
    severity: "info",
    part: NUMBERING,
    element: "w:numbering",
    apply: (p) =>
      replaceOnce(
        p,
        NUMBERING,
        "</w:numbering>",
        Array.from(
          { length: 60 },
          (_, i) => `<w:num w:numId="${100 + i}"><w:abstractNumId w:val="0"/></w:num>`,
        ).join("") + "</w:numbering>",
      ),
  },
  {
    name: "unused list instance",
    rule: "numbering.unused-definitions",
    severity: "info",
    part: NUMBERING,
    element: "w:num",
    apply: (p) =>
      replaceOnce(
        p,
        NUMBERING,
        "</w:numbering>",
        `<w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
      ),
  },
  {
    name: "list restarted by a start override",
    rule: "numbering.restart-overrides",
    severity: "info",
    part: NUMBERING,
    element: "w:lvlOverride",
    apply: (p) =>
      replaceOnce(
        p,
        NUMBERING,
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`,
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`,
      ),
  },
  {
    name: "direct numbering differs from the style's list",
    rule: "numbering.direct-differs-from-style",
    severity: "info",
    part: DOC,
    element: "w:numPr",
    apply: (p) => replaceOnce(p, DOC, `<w:numId w:val="0"/>`, `<w:numId w:val="2"/>`),
  },
  // sections
  {
    name: "header reference to an unknown relationship",
    rule: "sections.header-footer-missing",
    severity: "error",
    part: DOC,
    element: "w:headerReference",
    apply: (p) =>
      replaceOnce(
        p,
        DOC,
        `<w:headerReference w:type="first" r:id="rId9"/>`,
        `<w:headerReference w:type="first" r:id="rId77"/>`,
      ),
  },
  {
    name: "header part deleted",
    rule: "sections.header-footer-missing",
    severity: "error",
    part: DOC,
    element: "w:headerReference",
    apply: (p) => without(p, "word/header2.xml"),
  },
  {
    name: "title page without a first-page header",
    rule: "sections.title-page-without-first-header",
    severity: "info",
    part: DOC,
    element: "w:titlePg",
    apply: (p) => replaceOnce(p, DOC, `<w:headerReference w:type="first" r:id="rId9"/>`, ""),
  },
  {
    name: "even header while odd/even is off",
    rule: "sections.even-headers-unused",
    severity: "info",
    part: DOC,
    element: "w:headerReference",
    apply: (p) =>
      replaceOnce(
        p,
        DOC,
        `<w:headerReference w:type="first" r:id="rId9"/>`,
        `<w:headerReference w:type="first" r:id="rId9"/><w:headerReference w:type="even" r:id="rId9"/>`,
      ),
  },
  {
    name: "odd/even on without even headers",
    rule: "sections.even-headers-missing",
    severity: "info",
    part: SETTINGS,
    element: "w:evenAndOddHeaders",
    apply: (p) =>
      replaceOnce(p, SETTINGS, `<w:defaultTabStop`, `<w:evenAndOddHeaders/><w:defaultTabStop`),
  },
  {
    name: "landscape second section",
    rule: "sections.page-setup-differs",
    severity: "info",
    part: DOC,
    element: "w:pgSz",
    apply: (p) =>
      replaceOnce(
        p,
        DOC,
        `<w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/>`,
        `<w:type w:val="nextPage"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>`,
      ),
  },
  {
    name: "page numbering restarts",
    rule: "sections.page-numbering-restart",
    severity: "info",
    part: DOC,
    element: "w:pgNumType",
    apply: (p) =>
      replaceOnce(
        p,
        DOC,
        `<w:type w:val="nextPage"/>`,
        `<w:type w:val="nextPage"/><w:pgNumType w:start="1"/>`,
      ),
  },
  {
    name: "body without final sectPr",
    rule: "sections.missing-final-sectpr",
    severity: "warning",
    part: DOC,
    element: "w:body",
    apply: (p) => replaceOnce(p, DOC, SECTION_2, ""),
  },
  // formatting
  {
    name: "hidden run",
    rule: "formatting.hidden-text",
    severity: "info",
    part: DOC,
    element: "w:r",
    apply: (p) => addToBody(p, `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Secret</w:t></w:r></w:p>`),
  },
  {
    name: "white text on a white page",
    rule: "formatting.invisible-text",
    severity: "warning",
    part: DOC,
    element: "w:r",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>Hidden words</w:t></w:r></w:p>`,
      ),
  },
  {
    name: "text coloured as its shading",
    rule: "formatting.invisible-text",
    severity: "warning",
    part: DOC,
    element: "w:r",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:r><w:rPr><w:color w:val="1F3864"/><w:shd w:val="clear" w:color="auto" w:fill="1f3864"/></w:rPr><w:t>Hidden words</w:t></w:r></w:p>`,
      ),
  },
  {
    name: "1 pt text",
    rule: "formatting.tiny-text",
    severity: "info",
    part: DOC,
    element: "w:r",
    apply: (p) =>
      addToBody(p, `<w:p><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t>Small print</w:t></w:r></w:p>`),
  },
  {
    name: "field without an end",
    rule: "formatting.unbalanced-field",
    severity: "warning",
    part: DOC,
    element: "w:fldChar",
    apply: (p) =>
      replaceOnce(
        p,
        DOC,
        `<w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`,
        `<w:r><w:t>2</w:t></w:r>`,
      ),
  },
  {
    name: "duplicate bookmark name",
    rule: "formatting.duplicate-bookmark-name",
    severity: "warning",
    part: DOC,
    element: "w:bookmarkStart",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:bookmarkStart w:id="50" w:name="results"/><w:r><w:t>Again</w:t></w:r><w:bookmarkEnd w:id="50"/></w:p>`,
      ),
  },
  {
    name: "duplicate bookmark id",
    rule: "formatting.duplicate-bookmark-id",
    severity: "warning",
    part: DOC,
    element: "w:bookmarkStart",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:bookmarkStart w:id="3" w:name="Other"/><w:r><w:t>Again</w:t></w:r><w:bookmarkEnd w:id="3"/></w:p>`,
      ),
  },
  {
    name: "bookmark without an end",
    rule: "formatting.unclosed-bookmark",
    severity: "warning",
    part: DOC,
    element: "w:bookmarkStart",
    apply: (p) => replaceOnce(p, DOC, `<w:bookmarkEnd w:id="3"/>`, ""),
  },
  {
    name: "two content controls with one id",
    rule: "formatting.duplicate-sdt-id",
    severity: "warning",
    part: DOC,
    element: "w:id",
    apply: (p) =>
      addToBody(
        p,
        `<w:sdt><w:sdtPr><w:id w:val="-1234567"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Copy</w:t></w:r></w:p></w:sdtContent></w:sdt>`,
      ),
  },
  {
    name: "paragraph full of direct formatting",
    rule: "formatting.direct-formatting-hotspots",
    severity: "info",
    part: DOC,
    element: "w:p",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="0"/><w:ind w:left="360"/><w:keepNext/><w:keepLines/><w:shd w:val="clear" w:fill="EEEEEE"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:i/><w:color w:val="333333"/><w:sz w:val="23"/><w:u w:val="single"/><w:caps/></w:rPr><w:t>Loud</w:t></w:r></w:p>`,
      ),
  },
  // revisions and notes
  {
    name: "tracked insertion and deletion",
    rule: "revisions.tracked-changes",
    severity: "info",
    part: DOC,
    element: "w:ins",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:ins w:id="101" w:author="A Reviewer" w:date="2024-05-02T09:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins><w:del w:id="102" w:author="B Editor" w:date="2024-05-02T09:00:00Z"><w:r><w:delText>old</w:delText></w:r></w:del></w:p>`,
      ),
  },
  {
    name: "track changes switched on",
    rule: "revisions.tracking-on",
    severity: "info",
    part: SETTINGS,
    element: "w:trackRevisions",
    apply: (p) =>
      replaceOnce(p, SETTINGS, `<w:defaultTabStop`, `<w:trackRevisions/><w:defaultTabStop`),
  },
  {
    name: "two tracked changes with one id",
    rule: "revisions.duplicate-id",
    severity: "warning",
    part: DOC,
    element: "w:ins",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:ins w:id="101" w:author="A" w:date="2024-05-02T09:00:00Z"><w:r><w:t>one</w:t></w:r></w:ins><w:ins w:id="101" w:author="A" w:date="2024-05-02T09:00:00Z"><w:r><w:t>two</w:t></w:r></w:ins></w:p>`,
      ),
  },
  {
    name: "move source never ends",
    rule: "revisions.unbalanced-move-range",
    severity: "warning",
    part: DOC,
    element: "w:moveFromRangeStart",
    apply: (p) =>
      addToBody(
        p,
        `<w:p><w:moveFromRangeStart w:id="201" w:author="A" w:date="2024-05-02T09:00:00Z" w:name="move1"/><w:moveFrom w:id="202" w:author="A" w:date="2024-05-02T09:00:00Z"><w:r><w:t>Shifted words</w:t></w:r></w:moveFrom></w:p><w:p><w:moveToRangeStart w:id="203" w:author="A" w:date="2024-05-02T09:00:00Z" w:name="move1"/><w:moveTo w:id="204" w:author="A" w:date="2024-05-02T09:00:00Z"><w:r><w:t>Shifted words</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="203"/></w:p>`,
      ),
  },
  {
    name: "comment reference without a comment",
    rule: "notes.comment-missing",
    severity: "error",
    part: DOC,
    element: "w:commentReference",
    apply: (p) => addToBody(p, `<w:p><w:r><w:commentReference w:id="5"/></w:r></w:p>`),
  },
  {
    name: "comment not anchored in the text",
    rule: "notes.comment-unreferenced",
    severity: "info",
    part: "word/comments.xml",
    element: "w:comment",
    apply: (p) =>
      replaceOnce(
        p,
        "word/comments.xml",
        "</w:comments>",
        `<w:comment w:id="3" w:author="A" w:date="2024-05-01T10:00:00Z"><w:p><w:r><w:t>Forgotten.</w:t></w:r></w:p></w:comment></w:comments>`,
      ),
  },
  {
    name: "comment range never ends",
    rule: "notes.comment-range-unclosed",
    severity: "warning",
    part: DOC,
    element: "w:commentRangeStart",
    apply: (p) => replaceOnce(p, DOC, `<w:commentRangeEnd w:id="0"/>`, ""),
  },
  {
    name: "footnote reference without a footnote",
    rule: "notes.note-missing",
    severity: "error",
    part: DOC,
    element: "w:footnoteReference",
    apply: (p) =>
      replaceOnce(p, DOC, `<w:footnoteReference w:id="1"/>`, `<w:footnoteReference w:id="9"/>`),
  },
  {
    name: "footnote never referenced",
    rule: "notes.note-unreferenced",
    severity: "info",
    part: "word/footnotes.xml",
    element: "w:footnote",
    apply: (p) =>
      replaceOnce(
        p,
        "word/footnotes.xml",
        "</w:footnotes>",
        `<w:footnote w:id="2"><w:p><w:r><w:t>Orphan.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
      ),
  },
];

/** A large document: `paragraphs` paragraphs with styles, lists, runs and bookmarks. */
export function largeParts(paragraphs: number): Parts {
  const parts = cleanParts();
  const body: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    const style = i % 10 === 0 ? "Heading1" : i % 7 === 0 ? "Note" : undefined;
    const list =
      i % 5 === 1 ? `<w:numPr><w:ilvl w:val="${i % 3}"/><w:numId w:val="1"/></w:numPr>` : "";
    const pPr =
      style || list ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${list}</w:pPr>` : "";
    body.push(
      `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3">${pPr}<w:bookmarkStart w:id="${1000 + i}" w:name="_Ref${i}"/><w:r><w:t xml:space="preserve">Paragraph ${i} has some text, </w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr><w:t>bold red</w:t></w:r><w:r><w:t xml:space="preserve"> and more text.</w:t></w:r><w:bookmarkEnd w:id="${1000 + i}"/></w:p>`,
    );
  }
  return replaceOnce(parts, DOC, LAST_P, LAST_P + body.join("\n"));
}
