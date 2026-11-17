/**
 * The styles of an exported document, written as Word writes its built-in ones (same ids and
 * names, so Word recognises Heading 1, Quote, Hyperlink and so on as its own and the Navigation
 * pane, a table of contents and "Change styles" all work). Everything the converter uses is
 * defined here by id; nothing falls back to a missing style.
 *
 * Page and type: A4, 2.54 cm margins, Calibri 11 pt, 1.15 line spacing, 8 pt after paragraphs,
 * British English for spelling and grammar.
 */

/** Style ids used by the converter. */
export const STYLE = {
  normal: "Normal",
  heading: (level: number) => `Heading${level}`,
  quote: "Quote",
  sourceCode: "SourceCode",
  code: "Code",
  hyperlink: "Hyperlink",
  listParagraph: "ListParagraph",
  tableGrid: "TableGrid",
  footnoteText: "FootnoteText",
  footnoteReference: "FootnoteReference",
} as const;

/** Page geometry in twips (1/20 pt). */
export const PAGE = {
  width: 11906,
  height: 16838,
  margin: 1440,
  headerFooter: 708,
} as const;

/** Width of the text column in twips. */
export const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;

export const CODE_FONT = "Consolas";
export const BODY_FONT = "Calibri";

/** Colours, as Word's own defaults use them. */
const HEADING_COLOUR = "2F5496";
const HEADING_DARK = "1F3763";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const fonts = (name: string) =>
  `<w:rFonts w:ascii="${name}" w:eastAsia="${name}" w:hAnsi="${name}" w:cs="${name}"/>`;

function heading(
  level: number,
  size: number,
  colour: string,
  before: number,
  italic = false,
): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
    `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
    `<w:uiPriority w:val="9"/>${level > 1 ? "<w:unhideWhenUsed/>" : ""}<w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="80"/>` +
    `<w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr>${italic ? "<w:i/><w:iCs/>" : ""}<w:color w:val="${colour}"/>` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  );
}

/** The whole `word/styles.xml`. */
export const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:docDefaults>` +
  `<w:rPrDefault><w:rPr>${fonts(BODY_FONT)}<w:sz w:val="22"/><w:szCs w:val="22"/>` +
  `<w:lang w:val="en-GB" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
  `</w:docDefaults>` +
  // Normal and the other default styles.
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
  `<w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>` +
  `<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>` +
  `<w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>` +
  `</w:tblCellMar></w:tblPr></w:style>` +
  `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/>` +
  `<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
  // Headings: Word's sizes and colours, in the body font.
  heading(1, 32, HEADING_COLOUR, 360) +
  heading(2, 28, HEADING_COLOUR, 240) +
  heading(3, 24, HEADING_DARK, 200) +
  heading(4, 22, HEADING_COLOUR, 160, true) +
  heading(5, 22, HEADING_COLOUR, 160) +
  heading(6, 22, HEADING_DARK, 160, true) +
  // Block quote: indented, with a bar on the left.
  `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>` +
  `<w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/>` +
  `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr>` +
  `<w:ind w:left="720" w:right="0"/></w:pPr><w:rPr><w:color w:val="404040"/></w:rPr></w:style>` +
  // Code blocks: monospace, single spaced, light shading, never spell-checked.
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SourceCode"><w:name w:val="Source Code"/>` +
  `<w:basedOn w:val="Normal"/><w:uiPriority w:val="39"/><w:qFormat/>` +
  `<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>` +
  `<w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `<w:rPr>${fonts(CODE_FONT)}<w:noProof/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>` +
  // Inline code.
  `<w:style w:type="character" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/>` +
  `<w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="39"/><w:qFormat/>` +
  `<w:rPr>${fonts(CODE_FONT)}<w:noProof/><w:sz w:val="20"/><w:szCs w:val="20"/>` +
  `<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:rPr></w:style>` +
  // Links.
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>` +
  `<w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>` +
  `<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  // Lists.
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>` +
  `<w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>` +
  `<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
  // Tables.
  `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>` +
  `<w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `<w:tblPr><w:tblBorders>` +
  ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
    .join("") +
  `</w:tblBorders></w:tblPr></w:style>` +
  // Footnotes.
  `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/>` +
  `<w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/>` +
  `<w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>` +
  `</w:styles>`;
