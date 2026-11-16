/**
 * A hand-written Word package for the repair end-to-end tests, written the way Word itself writes
 * one: tracked changes across runs and fields, nested insertions and deletions, moves with their
 * range markers, table row revisions, paragraph-mark revisions, formatting changes, comments with a
 * reply and a resolved thread (with the three comment extension parts), people.xml with sign-in
 * details, rsids everywhere, headers, footers, footnotes, custom and extended properties.
 *
 * Test-only: never imported by app code.
 */
import { zipSync } from "fflate";
import { NS } from "../test-helpers";

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MS = "http://schemas.microsoft.com/office";

/** The people in the sample, as their names appear in the file (decoded). */
export const SAMPLE_PEOPLE = ["Alice Example", "Bob O'Neil", "Zoë & Co", 'Carol "CJ" Jones'];
/** Other private strings in the sample, by where they are. */
export const SAMPLE_SECRETS = {
  email: "alice@example.com",
  title: "Secret Merger Plan",
  subject: "Project Falcon",
  keywords: "falcon, merger",
  description: "Draft for the board",
  category: "Legal hold",
  status: "Draft status",
  company: "Secret Co",
  manager: "Mary Manager",
  template: "AliceTemplate.dotm",
  hyperlinkBase: "https://intranet.secret.example/",
  custom: "Acme Secret Client",
  customName: "ClientName",
};

const D = 'w:date="2024-01-02T10:00:00Z"';
const ALICE = 'w:author="Alice Example"';
const BOB = 'w:author="Bob O\'Neil"';
const ZOE = 'w:author="Zo&#235; &amp; Co"';
const CAROL = "w:author='Carol \"CJ\" Jones'";

const p = (body: string, attrs = 'w:rsidR="00A10001" w:rsidRDefault="00A10001"') =>
  `<w:p ${attrs}>${body}</w:p>`;
const r = (text: string, rsid = "00A10001") =>
  `<w:r w:rsidR="${rsid}"><w:t xml:space="preserve">${text}</w:t></w:r>`;
const dr = (text: string) =>
  `<w:r w:rsidDel="00B20002"><w:delText xml:space="preserve">${text}</w:delText></w:r>`;

const cell = (body: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${body}</w:tc>`;

function body(): string {
  return [
    p(`<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${r("Contract terms")}`),
    // An insertion across two runs next to a deletion.
    p(
      r("The fee is ") +
        `<w:del w:id="1" ${ALICE} ${D}>${dr("ten")}</w:del>` +
        `<w:ins w:id="2" ${BOB} ${D}>${r("twelve", "00B20002")}<w:r w:rsidR="00B20002"><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> thousand</w:t></w:r></w:ins>` +
        r(" pounds."),
    ),
    // Nested: an insertion that was then deleted by someone else.
    p(
      r("Kept. ") +
        `<w:ins w:id="3" ${ALICE} ${D}><w:del w:id="4" ${BOB} ${D}>${dr("Added then removed.")}</w:del></w:ins>`,
    ),
    // A whole field inserted, and a whole field deleted.
    p(
      `<w:ins w:id="5" ${ZOE} ${D}><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("1")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:ins>` +
        r(" and ") +
        `<w:del w:id="6" ${ZOE} ${D}><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:delInstrText xml:space="preserve"> DATE </w:delInstrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${dr("1 May")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:del>`,
    ),
    // A change inside a field result only.
    p(
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF target </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:del w:id="7" ${CAROL} ${D}>${dr("old result")}</w:del><w:ins w:id="8" ${CAROL} ${D}>${r("new result")}</w:ins>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
    ),
    // A move: from here ...
    p(
      `<w:moveFromRangeStart w:id="10" ${ALICE} ${D} w:name="move1"/><w:moveFrom w:id="11" ${ALICE} ${D}>${r("Moved sentence.")}</w:moveFrom><w:moveFromRangeEnd w:id="10"/>` +
        r(" Stays."),
    ),
    // ... to here.
    p(
      r("Before. ") +
        `<w:moveToRangeStart w:id="12" ${ALICE} ${D} w:name="move1"/><w:moveTo w:id="13" ${ALICE} ${D}>${r("Moved sentence.")}</w:moveTo><w:moveToRangeEnd w:id="12"/>`,
    ),
    // Formatting changes on a run and a paragraph; an inserted paragraph mark.
    p(
      `<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="14" ${BOB} ${D}><w:pPr/></w:pPrChange></w:pPr>` +
        `<w:r><w:rPr><w:b/><w:rPrChange w:id="15" ${BOB} ${D}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>Made bold.</w:t></w:r>`,
    ),
    p(
      `<w:pPr><w:rPr><w:ins w:id="16" ${ALICE} ${D}/></w:rPr></w:pPr>` +
        `<w:ins w:id="17" ${ALICE} ${D}>${r("A new paragraph.")}</w:ins>`,
    ),
    // A comment with a reply on one range, and a resolved comment.
    p(
      `<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>${r("Fee schedule")}<w:commentRangeEnd w:id="0"/>` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>` +
        `<w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>` +
        r(" and ") +
        `<w:commentRangeStart w:id="2"/>${r("payment dates")}<w:commentRangeEnd w:id="2"/>` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="2"/></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`,
    ),
    // A table: one inserted row, one deleted row, one ordinary row.
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
      `<w:tr w:rsidR="00A10001"><w:trPr><w:ins w:id="20" ${ALICE} ${D}/></w:trPr>${cell(p(`<w:pPr><w:rPr><w:ins w:id="21" ${ALICE} ${D}/></w:rPr></w:pPr><w:ins w:id="22" ${ALICE} ${D}>${r("New row")}</w:ins>`))}${cell(p(`<w:pPr><w:rPr><w:ins w:id="23" ${ALICE} ${D}/></w:rPr></w:pPr>`))}</w:tr>` +
      `<w:tr w:rsidR="00A10001"><w:trPr><w:del w:id="24" ${BOB} ${D}/></w:trPr>${cell(p(`<w:pPr><w:rPr><w:del w:id="25" ${BOB} ${D}/></w:rPr></w:pPr><w:del w:id="26" ${BOB} ${D}>${dr("Old row")}</w:del>`))}${cell(p(`<w:pPr><w:rPr><w:del w:id="27" ${BOB} ${D}/></w:rPr></w:pPr>`))}</w:tr>` +
      `<w:tr w:rsidR="00A10001">${cell(p(r("Plain")))}${cell(p(r("Row")))}</w:tr>` +
      `</w:tbl>`,
    p(r("The end.")),
    `<w:sectPr w:rsidR="00A10001"><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`,
  ].join("\n");
}

const COMMENT = (id: number, author: string, initials: string, paraId: string, text: string) =>
  `<w:comment w:id="${id}" ${author} ${D} w:initials="${initials}"><w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="00A10001" w:rsidRDefault="00A10001"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${r(text)}</w:p></w:comment>`;

/** The parts of the sample, by name, in archive order. */
export function wordPackageParts(): Record<string, string> {
  const rel = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  return {
    "[Content_Types].xml": `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `${xml}<Relationships xmlns="${REL_NS}">${rel("rId1", `${OD}/officeDocument`, "word/document.xml")}${rel("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")}${rel("rId3", `${OD}/extended-properties`, "docProps/app.xml")}${rel("rId4", `${OD}/custom-properties`, "docProps/custom.xml")}</Relationships>`,
    "word/document.xml": `${xml}<w:document ${NS}><w:body>${body()}</w:body></w:document>`,
    "word/_rels/document.xml.rels": `${xml}<Relationships xmlns="${REL_NS}">${[
      rel("rIdStyles", `${OD}/styles`, "styles.xml"),
      rel("rIdSettings", `${OD}/settings`, "settings.xml"),
      rel("rIdHeader1", `${OD}/header`, "header1.xml"),
      rel("rIdFooter1", `${OD}/footer`, "footer1.xml"),
      rel("rIdFootnotes", `${OD}/footnotes`, "footnotes.xml"),
      rel("rIdComments", `${OD}/comments`, "comments.xml"),
      rel("rIdCex", `${MS}/2011/relationships/commentsExtended`, "commentsExtended.xml"),
      rel("rIdCid", `${MS}/2016/09/relationships/commentsIds`, "commentsIds.xml"),
      rel("rIdCext", `${MS}/2018/08/relationships/commentsExtensible`, "commentsExtensible.xml"),
      rel("rIdPeople", `${MS}/2011/relationships/people`, "people.xml"),
    ].join("")}</Relationships>`,
    "word/styles.xml": `${xml}<w:styles ${NS}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rsid w:val="00A10001"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rsid w:val="00A10001"/><w:rPr><w:b/><w:rPrChange w:id="90" ${CAROL} ${D}><w:rPr/></w:rPrChange></w:rPr></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/></w:style></w:styles>`,
    "word/settings.xml": `${xml}<w:settings ${NS}><w:trackRevisions/><w:attachedTemplate r:id="rIdTemplate"/><w:rsids><w:rsidRoot w:val="00A10001"/><w:rsid w:val="00A10001"/><w:rsid w:val="00B20002"/></w:rsids></w:settings>`,
    "word/_rels/settings.xml.rels": `${xml}<Relationships xmlns="${REL_NS}">${rel("rIdTemplate", `${OD}/attachedTemplate`, "file:///C:\\Users\\alice.example\\AppData\\Roaming\\Microsoft\\Templates\\AliceTemplate.dotm", true)}</Relationships>`,
    "word/header1.xml": `${xml}<w:hdr ${NS}>${p(`<w:ins w:id="30" ${ALICE} ${D}>${r("Draft header")}</w:ins>`)}</w:hdr>`,
    "word/footer1.xml": `${xml}<w:ftr ${NS}>${p(`<w:r><w:rPr><w:i/><w:rPrChange w:id="31" ${ZOE} ${D}><w:rPr/></w:rPrChange></w:rPr><w:t>Footer text</w:t></w:r>`)}</w:ftr>`,
    "word/footnotes.xml": `${xml}<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1">${p(`<w:r><w:separator/></w:r>`)}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${p(`<w:r><w:continuationSeparator/></w:r>`)}</w:footnote><w:footnote w:id="1">${p(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${r(" Source: ")}<w:del w:id="32" ${BOB} ${D}>${dr("unaudited")}</w:del>${r("figures.")}`)}</w:footnote></w:footnotes>`,
    "word/comments.xml": `${xml}<w:comments ${NS}>${COMMENT(0, ALICE, "AE", "00000A01", "Please check.")}${COMMENT(1, BOB, "BO", "00000A02", "Checked.")}${COMMENT(2, ZOE, "Z&amp;C", "00000A03", "Fixed now.")}</w:comments>`,
    "word/commentsExtended.xml": `${xml}<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15"><w15:commentEx w15:paraId="00000A01" w15:done="0"/><w15:commentEx w15:paraId="00000A02" w15:paraIdParent="00000A01" w15:done="0"/><w15:commentEx w15:paraId="00000A03" w15:done="1"/></w15:commentsEx>`,
    "word/commentsIds.xml": `${xml}<w16cid:commentsIds xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" mc:Ignorable="w16cid"><w16cid:commentId w16cid:paraId="00000A01" w16cid:durableId="11111111"/><w16cid:commentId w16cid:paraId="00000A02" w16cid:durableId="22222222"/><w16cid:commentId w16cid:paraId="00000A03" w16cid:durableId="33333333"/></w16cid:commentsIds>`,
    "word/commentsExtensible.xml": `${xml}<w16cex:commentsExtensible xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex" mc:Ignorable="w16cex"><w16cex:commentExtensible w16cex:durableId="11111111" w16cex:dateUtc="2024-01-02T10:00:00Z"/><w16cex:commentExtensible w16cex:durableId="22222222" w16cex:dateUtc="2024-01-02T10:00:00Z"/><w16cex:commentExtensible w16cex:durableId="33333333" w16cex:dateUtc="2024-01-02T10:00:00Z"/></w16cex:commentsExtensible>`,
    "word/people.xml": `${xml}<w15:people xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15"><w15:person w15:author="Alice Example"><w15:presenceInfo w15:providerId="AD" w15:userId="S::alice@example.com::0f0e0d0c"/></w15:person><w15:person w15:author="Bob O'Neil"><w15:presenceInfo w15:providerId="None" w15:userId="Bob O'Neil"/></w15:person><w15:person w15:author="Zo&#235; &amp; Co"><w15:presenceInfo w15:providerId="Windows Live" w15:userId="a1b2c3d4e5f6"/></w15:person></w15:people>`,
    "docProps/core.xml": `${xml}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${SAMPLE_SECRETS.title}</dc:title><dc:subject>${SAMPLE_SECRETS.subject}</dc:subject><dc:creator>Alice Example</dc:creator><cp:keywords>${SAMPLE_SECRETS.keywords}</cp:keywords><dc:description>${SAMPLE_SECRETS.description}</dc:description><cp:lastModifiedBy>Bob O'Neil</cp:lastModifiedBy><cp:revision>3</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created><cp:category>${SAMPLE_SECRETS.category}</cp:category><cp:contentStatus>${SAMPLE_SECRETS.status}</cp:contentStatus></cp:coreProperties>`,
    "docProps/app.xml": `${xml}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>${SAMPLE_SECRETS.template}</Template><TotalTime>5</TotalTime><Pages>1</Pages><Words>40</Words><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><Lines>2</Lines><Paragraphs>1</Paragraphs><ScaleCrop>false</ScaleCrop><Company>${SAMPLE_SECRETS.company}</Company><Manager>${SAMPLE_SECRETS.manager}</Manager><LinksUpToDate>false</LinksUpToDate><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${SAMPLE_SECRETS.title}</vt:lpstr></vt:vector></TitlesOfParts><HyperlinkBase>${SAMPLE_SECRETS.hyperlinkBase}</HyperlinkBase><AppVersion>16.0000</AppVersion></Properties>`,
    "docProps/custom.xml": `${xml}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="${SAMPLE_SECRETS.customName}"><vt:lpwstr>${SAMPLE_SECRETS.custom}</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Reviewed"><vt:bool>true</vt:bool></property></Properties>`,
  };
}

/** The sample as a zip, with optional overrides (a part's text, or its exact bytes). */
export function wordPackage(overrides: Record<string, string | Uint8Array> = {}): Uint8Array {
  const parts: Record<string, string | Uint8Array> = { ...wordPackageParts(), ...overrides };
  const input: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(parts)) {
    input[name] = typeof value === "string" ? new TextEncoder().encode(value) : value;
  }
  return zipSync(input, { mtime: new Date(2024, 0, 1) });
}
