/**
 * Test fixtures for the Formatting view. Real Word files are never committed: a rich sample is
 * built with the `docx` package, and edge cases the package cannot make are written by hand as
 * Word itself writes them.
 */
import { unzipSync } from "fflate";
import type { PartSource } from "./package";

export function sourceFromParts(parts: Record<string, string>): PartSource {
  return { names: () => Object.keys(parts), text: (name) => parts[name] };
}

export function sourceFromZip(bytes: Uint8Array): PartSource {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();
  return {
    names: () => Object.keys(files),
    text: (name) => (files[name] ? decoder.decode(files[name]) : undefined),
  };
}

export const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w14 w15"';

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface HandOptions {
  styles?: string;
  numbering?: string;
  /** Extra relationships of the main document: id -> [type, target, external?]. */
  rels?: Record<string, [string, string, boolean?]>;
  extra?: Record<string, string>;
  sectPr?: string;
}

/** A package around hand-written body XML, as Word writes it. */
export function handDocx(bodyXml: string, options: HandOptions = {}): PartSource {
  const rels: Record<string, [string, string, boolean?]> = { ...(options.rels ?? {}) };
  const parts: Record<string, string> = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${bodyXml}${options.sectPr ?? ""}</w:body></w:document>`,
  };
  if (options.styles !== undefined) {
    rels.rIdStyles = ["styles", "styles.xml"];
    parts["word/styles.xml"] = `<?xml version="1.0"?><w:styles ${NS}>${options.styles}</w:styles>`;
  }
  if (options.numbering !== undefined) {
    rels.rIdNumbering = ["numbering", "numbering.xml"];
    parts["word/numbering.xml"] =
      `<?xml version="1.0"?><w:numbering ${NS}>${options.numbering}</w:numbering>`;
  }
  Object.assign(parts, options.extra ?? {});
  parts["word/_rels/document.xml.rels"] =
    `<?xml version="1.0"?><Relationships xmlns="${REL_NS}">` +
    Object.entries(rels)
      .map(
        ([id, [type, target, external]]) =>
          `<Relationship Id="${id}" Type="${REL_TYPE}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`,
      )
      .join("") +
    "</Relationships>";
  return sourceFromParts(parts);
}

/** A 1x1 transparent PNG. */
export const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** A rich sample made with the `docx` package. Deterministic (fixed dates and ids). */
export async function richSampleBytes(): Promise<Uint8Array> {
  const d = await import("docx");
  const fixed = new Date("2024-05-01T10:00:00Z");
  const doc = new d.Document({
    creator: "Jane Smith",
    title: "Quarterly report",
    description: "A sample with most kinds of formatting",
    lastModifiedBy: "Jane Smith",
    revision: 3,
    features: { trackRevisions: true },
    numbering: {
      config: [
        {
          reference: "steps",
          levels: [
            {
              level: 0,
              format: d.LevelFormat.DECIMAL,
              text: "%1.",
              alignment: d.AlignmentType.START,
            },
            {
              level: 1,
              format: d.LevelFormat.LOWER_LETTER,
              text: "%2)",
              alignment: d.AlignmentType.START,
            },
            {
              level: 2,
              format: d.LevelFormat.LOWER_ROMAN,
              text: "%3.",
              alignment: d.AlignmentType.START,
            },
          ],
        },
        {
          reference: "bullets",
          levels: [
            { level: 0, format: d.LevelFormat.BULLET, text: "•", alignment: d.AlignmentType.LEFT },
            { level: 1, format: d.LevelFormat.BULLET, text: "◦", alignment: d.AlignmentType.LEFT },
          ],
        },
      ],
    },
    styles: {
      paragraphStyles: [
        {
          id: "Note",
          name: "Note",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { italics: true, color: "595959", size: 20 },
          paragraph: { indent: { left: 720 }, spacing: { before: 120, after: 120 } },
        },
      ],
    },
    comments: {
      children: [
        {
          id: 0,
          author: "Ravi Patel",
          initials: "RP",
          date: fixed,
          children: [new d.Paragraph({ children: [new d.TextRun("Is this figure final?")] })],
        },
      ],
    },
    footnotes: {
      1: { children: [new d.Paragraph("Source: internal sales data, unaudited.")] },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
          titlePage: true,
        },
        headers: {
          default: new d.Header({
            children: [
              new d.Paragraph({
                children: [
                  new d.TextRun("Quarterly report"),
                  new d.TextRun({ children: ["\tPage ", d.PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
          first: new d.Header({ children: [new d.Paragraph("Confidential")] }),
        },
        footers: {
          default: new d.Footer({
            children: [
              new d.Paragraph({
                alignment: d.AlignmentType.CENTER,
                children: [new d.TextRun("Acme Ltd")],
              }),
            ],
          }),
        },
        children: [
          new d.Paragraph({ text: "Quarterly report", heading: d.HeadingLevel.TITLE }),
          new d.Paragraph({ text: "Introduction", heading: d.HeadingLevel.HEADING_1 }),
          new d.Paragraph({
            children: [
              new d.TextRun("Sales rose "),
              new d.TextRun({ text: "12%", bold: true }),
              new d.TextRun(" in the quarter"),
              new d.FootnoteReferenceRun(1),
              new d.TextRun(", led by "),
              new d.TextRun({ text: "new markets", italics: true }),
              new d.TextRun(". "),
              new d.TextRun({ text: "Red text", color: "C00000" }),
              new d.TextRun(", "),
              new d.TextRun({ text: "highlighted", highlight: "yellow" }),
              new d.TextRun(", "),
              new d.TextRun({ text: "Courier 9pt", font: "Courier New", size: 18 }),
              new d.TextRun(", "),
              new d.TextRun({
                text: "double underline",
                underline: { type: d.UnderlineType.DOUBLE, color: "0000FF" },
              }),
              new d.TextRun(", H"),
              new d.TextRun({ text: "2", subScript: true }),
              new d.TextRun("O and E=mc"),
              new d.TextRun({ text: "2", superScript: true }),
              new d.TextRun(", "),
              new d.TextRun({ text: "struck", strike: true }),
              new d.TextRun(", "),
              new d.TextRun({ text: "small caps", smallCaps: true }),
              new d.TextRun("."),
            ],
          }),
          new d.Paragraph({
            alignment: d.AlignmentType.JUSTIFIED,
            spacing: { before: 240, after: 120, line: 360 },
            indent: { left: 720, hanging: 360 },
            keepNext: true,
            children: [
              new d.TextRun(
                "Literal characters: 2 * 3 = 6, file_name, <tag>, [x], # not a heading, a\ttab, ",
              ),
              new d.TextRun({ text: "a line", break: 0 }),
              new d.TextRun({ text: "break", break: 1 }),
              new d.TextRun(" and a non-breaking\u00a0space."),
            ],
          }),
          new d.Paragraph({
            children: [
              new d.CommentRangeStart(0),
              new d.TextRun("Revenue was 4.2 million."),
              new d.CommentRangeEnd(0),
              new d.TextRun({ children: [new d.CommentReference(0)] }),
              new d.TextRun(" See "),
              new d.ExternalHyperlink({
                link: "https://example.com/report",
                children: [new d.TextRun({ text: "the full report", style: "Hyperlink" })],
              }),
              new d.TextRun(" and "),
              new d.InternalHyperlink({
                anchor: "results",
                children: [new d.TextRun({ text: "the results", style: "Hyperlink" })],
              }),
              new d.TextRun("."),
            ],
          }),
          new d.Paragraph({
            children: [
              new d.InsertedTextRun({
                text: "Inserted words",
                id: 1,
                author: "Ravi Patel",
                date: "2024-05-02T09:00:00Z",
              }),
              new d.TextRun(" and "),
              new d.DeletedTextRun({
                text: "deleted words",
                id: 2,
                author: "Ravi Patel",
                date: "2024-05-02T09:05:00Z",
              }),
              new d.TextRun("."),
            ],
          }),
          new d.Paragraph({ text: "Steps", heading: d.HeadingLevel.HEADING_2 }),
          new d.Paragraph({ text: "Gather the data", numbering: { reference: "steps", level: 0 } }),
          new d.Paragraph({ text: "From sales", numbering: { reference: "steps", level: 1 } }),
          new d.Paragraph({ text: "Weekly figures", numbering: { reference: "steps", level: 2 } }),
          new d.Paragraph({ text: "From finance", numbering: { reference: "steps", level: 1 } }),
          new d.Paragraph({
            text: "Write the report",
            numbering: { reference: "steps", level: 0 },
          }),
          new d.Paragraph({ text: "Risks", numbering: { reference: "bullets", level: 0 } }),
          new d.Paragraph({ text: "Supply", numbering: { reference: "bullets", level: 1 } }),
          new d.Paragraph({ text: "A note in a custom style.", style: "Note" }),
          new d.Paragraph({
            text: "Results",
            heading: d.HeadingLevel.HEADING_2,
            children: [new d.Bookmark({ id: "results", children: [] })],
          }),
          new d.Table({
            width: { size: 9000, type: d.WidthType.DXA },
            columnWidths: [3000, 3000, 3000],
            rows: [
              new d.TableRow({
                tableHeader: true,
                children: ["Region", "Q1", "Q2"].map(
                  (t) => new d.TableCell({ children: [new d.Paragraph(t)] }),
                ),
              }),
              new d.TableRow({
                children: ["North", "1.2", "1.4"].map(
                  (t) => new d.TableCell({ children: [new d.Paragraph(t)] }),
                ),
              }),
              new d.TableRow({
                children: ["South", "0.9", "1.1"].map(
                  (t) => new d.TableCell({ children: [new d.Paragraph(t)] }),
                ),
              }),
            ],
          }),
          new d.Paragraph(""),
          new d.Table({
            rows: [
              new d.TableRow({
                children: [
                  new d.TableCell({
                    columnSpan: 2,
                    shading: { fill: "D9E2F3", type: d.ShadingType.CLEAR, color: "auto" },
                    children: [
                      new d.Paragraph({
                        children: [new d.TextRun({ text: "Merged across", bold: true })],
                      }),
                    ],
                  }),
                  new d.TableCell({
                    rowSpan: 2,
                    verticalAlign: d.VerticalAlign.CENTER,
                    children: [new d.Paragraph("Merged down")],
                  }),
                ],
              }),
              new d.TableRow({
                children: [
                  new d.TableCell({ children: [new d.Paragraph("A")] }),
                  new d.TableCell({ children: [new d.Paragraph("B")] }),
                ],
              }),
            ],
          }),
          new d.Paragraph({
            children: [
              new d.ImageRun({
                type: "png",
                data: TINY_PNG,
                transformation: { width: 96, height: 48 },
                altText: { name: "Logo", description: "The company logo", title: "Logo" },
              }),
              new d.TextRun(" Figure 1: the logo."),
            ],
          }),
          new d.Paragraph({ children: [new d.PageBreak()] }),
          new d.Paragraph({ text: "Conclusion", heading: d.HeadingLevel.HEADING_1 }),
          new d.Paragraph({ text: "A quotation from the board.", style: "IntenseQuote" }),
        ],
      },
    ],
  });
  void fixed;
  const buffer = await d.Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
