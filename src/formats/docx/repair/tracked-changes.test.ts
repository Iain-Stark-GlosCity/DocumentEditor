import { describe, expect, it } from "vitest";
import type { RepairPlan } from "../../../core/repair";
import { inspectDocx } from "../inspect";
import type { PartSource } from "../package";
import { handDocx, NS, richSampleBytes, sourceFromZip, type HandOptions } from "../test-helpers";
import { parseXml } from "../xml";
import { offersFor, planFor } from "./index";
import { trackedChangeRepairs } from "./tracked-changes";

const ACCEPT = "docx.accept-tracked-changes";
const REJECT = "docx.reject-tracked-changes";
const DOC = "word/document.xml";

/** The package with the plan's changes applied. */
function patched(src: PartSource, plan: RepairPlan): PartSource {
  const map = new Map(plan.changes.map((c) => [c.part, c.text]));
  return { names: () => src.names(), text: (n) => map.get(n) ?? src.text(n) };
}

function offer(src: PartSource, id: string): string | null {
  return offersFor(src, trackedChangeRepairs).find((o) => o.id === id)?.summary ?? null;
}

function errors(src: PartSource): string[] {
  return inspectDocx(src)
    .filter((f) => f.severity === "error")
    .map((f) => f.id)
    .sort();
}

/**
 * Plans a repair and checks what every repair must hold: well-formed parts, no new error from the
 * inspector, nothing offered again for the same repair (idempotent), no author names leaked.
 */
function run(src: PartSource, id: string) {
  const plan = planFor(src, id, trackedChangeRepairs);
  expect(plan).not.toBeNull();
  for (const c of plan!.changes) expect(parseXml(c.text).problems).toEqual([]);
  const after = patched(src, plan!);
  const before = errors(src);
  for (const e of errors(after)) expect(before).toContain(e);
  expect(offer(after, id)).toBeNull();
  expect(JSON.stringify([plan!.details, plan!.skipped])).not.toMatch(/Jane Smith|Ravi Patel/);
  const text = (part = DOC) => plan!.changes.find((c) => c.part === part)?.text;
  return { plan: plan!, after, text };
}

const A = 'w:id="1" w:author="Jane Smith" w:date="2024-05-02T09:00:00Z"';
const r = (t: string) => `<w:r><w:t>${t}</w:t></w:r>`;
const dr = (t: string) => `<w:r><w:delText xml:space="preserve">${t}</w:delText></w:r>`;
const ins = (inner: string) => `<w:ins ${A}>${inner}</w:ins>`;
const del = (inner: string) => `<w:del ${A}>${inner}</w:del>`;

/** A one-paragraph package and its document text. */
function body(xml: string, options?: HandOptions) {
  const src = handDocx(xml, options);
  return { src, doc: src.text(DOC)! };
}

describe("tracked changes: offers", () => {
  it("offers nothing for a clean file", () => {
    const { src } = body(`<w:p>${r("Plain")}</w:p>`);
    expect(offersFor(src, trackedChangeRepairs)).toEqual([]);
    expect(planFor(src, ACCEPT, trackedChangeRepairs)).toBeNull();
    expect(planFor(src, REJECT, trackedChangeRepairs)).toBeNull();
  });

  it("summarises counts only, never names or text", () => {
    const { src } = body(
      `<w:p>${ins(r("Secret one"))}${ins(r("Two"))}${del(dr("Gone"))}<w:r><w:rPr><w:b/><w:rPrChange ${A}><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    const offers = offersFor(src, trackedChangeRepairs);
    expect(offers.map((o) => o.id)).toEqual([ACCEPT, REJECT]);
    expect(offers[0]!.title).toBe("Accept all tracked changes");
    expect(offers[0]!.summary).toBe("2 insertions, 1 deletion and 1 formatting change");
    expect(offers[1]!.summary).toBe("2 insertions, 1 deletion and 1 formatting change");
    expect(JSON.stringify(offers)).not.toMatch(/Jane|Secret|Gone/);
  });

  it("is not offered when only changes it must leave alone exist", () => {
    const { src } = body(
      `<w:p><w:pPr><w:rPr><w:del ${A}/></w:rPr></w:pPr>${r("a")}</w:p><w:tbl><w:tr><w:tc><w:tcPr><w:cellIns ${A}/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`,
    );
    expect(offer(src, ACCEPT)).toBeNull();
    // Rejecting can remove the paragraph mark deletion marker.
    expect(offer(src, REJECT)).toBe("1 deletion (1 left as it is)");
  });
});

describe("tracked changes: insertions and deletions", () => {
  const xml = `<w:p>${r("Keep")}${ins(r("Added"))}${del(dr(" removed"))}<w:del ${A}><w:r><w:instrText>x</w:instrText><w:delInstrText xml:space="preserve"> PAGE </w:delInstrText></w:r></w:del></w:p>`;

  it("accepts: unwraps insertions and drops deletions, byte for byte elsewhere", () => {
    const { src, doc } = body(xml);
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toBe(
      doc
        .replace(ins(r("Added")), r("Added"))
        .replace(del(dr(" removed")), "")
        .replace(/<w:del [^>]*><w:r><w:instrText>.*?<\/w:del>/, ""),
    );
    expect(plan.details).toEqual([`${DOC}: accepts 1 insertion and 2 deletions`]);
    expect(plan.skipped).toEqual([]);
  });

  it("rejects: drops insertions and restores deleted text as plain text", () => {
    const { src, doc } = body(xml);
    const { text, plan } = run(src, REJECT);
    expect(text()).toBe(
      doc
        .replace(ins(r("Added")), "")
        .replace(del(dr(" removed")), '<w:r><w:t xml:space="preserve"> removed</w:t></w:r>')
        .replace(
          /<w:del [^>]*>(<w:r><w:instrText>x<\/w:instrText>)<w:delInstrText xml:space="preserve"> PAGE <\/w:delInstrText>(<\/w:r>)<\/w:del>/,
          '$1<w:instrText xml:space="preserve"> PAGE </w:instrText>$2',
        ),
    );
    expect(plan.details).toEqual([`${DOC}: rejects 1 insertion and 2 deletions`]);
  });

  it("keeps bookmarks and comment ranges that sat inside removed text", () => {
    const inner = `<w:bookmarkStart w:id="0" w:name="b"/>${r("x")}<w:bookmarkEnd w:id="0"/>`;
    const { src, doc } = body(`<w:p>${ins(inner)}</w:p>`);
    expect(run(src, REJECT).text()).toBe(
      doc.replace(ins(inner), '<w:bookmarkStart w:id="0" w:name="b"/><w:bookmarkEnd w:id="0"/>'),
    );
  });

  it("handles a prefix other than w: and a self-closing wrapper", () => {
    const src = handDocx("", {
      extra: {
        [DOC]: `<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:del x:id="1"><x:r><x:delText>a</x:delText></x:r></x:del><x:ins x:id="2"/></x:p></x:body></x:document>`,
      },
    });
    expect(run(src, REJECT).text()).toBe(
      `<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:r><x:t>a</x:t></x:r></x:p></x:body></x:document>`,
    );
  });
});

describe("tracked changes: nesting", () => {
  const cases: [string, string, string, string][] = [
    // [name, xml, accepted, rejected]
    ["a deletion inside an insertion", ins(del(dr("q"))), "", ""],
    ["an insertion inside a deletion", del(ins(dr("q"))), "", ""],
    ["kept and deleted runs inside an insertion", ins(r("a") + del(dr("b"))), r("a"), ""],
    [
      "deleted and inserted runs inside a deletion",
      del(dr("a") + ins(r("b"))),
      "",
      '<w:r><w:t xml:space="preserve">a</w:t></w:r>',
    ],
    [
      "a formatting change inside an insertion",
      ins(
        `<w:r><w:rPr><w:b/><w:rPrChange ${A}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>z</w:t></w:r>`,
      ),
      "<w:r><w:rPr><w:b/></w:rPr><w:t>z</w:t></w:r>",
      "",
    ],
    [
      "a formatting change inside a deletion",
      del(
        `<w:r><w:rPr><w:b/><w:rPrChange ${A}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:delText>z</w:delText></w:r>`,
      ),
      "",
      "<w:r><w:rPr><w:i/></w:rPr><w:t>z</w:t></w:r>",
    ],
  ];
  for (const [name, xml, accepted, rejected] of cases) {
    it(name, () => {
      const { src, doc } = body(`<w:p>${r("k")}${xml}</w:p>`);
      expect(run(src, ACCEPT).text()).toBe(doc.replace(xml, accepted));
      expect(run(src, REJECT).text()).toBe(doc.replace(xml, rejected));
    });
  }
});

describe("tracked changes: moves", () => {
  const from = `<w:moveFromRangeStart w:id="10" w:name="move1" w:author="Jane Smith"/><w:moveFrom w:id="11" w:author="Jane Smith">${r("moved")}</w:moveFrom><w:moveFromRangeEnd w:id="10"/>`;
  const to = `<w:moveToRangeStart w:id="12" w:name="move1" w:author="Jane Smith"/><w:moveTo w:id="13" w:author="Jane Smith">${r("moved")}</w:moveTo><w:moveToRangeEnd w:id="12"/>`;
  const xml = `<w:p>${from}${r("middle")}</w:p><w:p>${to}</w:p>`;

  it("accepts: drops the source, keeps the destination, drops the range markers", () => {
    const { src, doc } = body(xml);
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toBe(doc.replace(from, "").replace(to, r("moved")));
    expect(plan.details).toEqual([`${DOC}: accepts 2 moves`]);
  });

  it("rejects: keeps the source, drops the destination and the markers", () => {
    const { src, doc } = body(xml);
    expect(run(src, REJECT).text()).toBe(doc.replace(from, r("moved")).replace(to, ""));
  });

  it("restores moved-from text written as deleted text", () => {
    const x = `<w:moveFrom w:id="1">${dr("m")}</w:moveFrom>`;
    const { src, doc } = body(`<w:p>${x}</w:p>`);
    expect(run(src, REJECT).text()).toBe(
      doc.replace(x, '<w:r><w:t xml:space="preserve">m</w:t></w:r>'),
    );
  });
});

describe("tracked changes: fields", () => {
  const field =
    `<w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

  it("an insertion wrapping several runs and a whole field is unwrapped or removed whole", () => {
    const { src, doc } = body(`<w:p>${ins(field)}</w:p>`);
    expect(run(src, ACCEPT).text()).toBe(doc.replace(ins(field), field));
    expect(run(src, REJECT).text()).toBe(doc.replace(ins(field), ""));
  });

  it("leaves a change that covers only part of a field", () => {
    const half = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>`;
    const rest = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const { src } = body(`<w:p>${ins(half)}${rest}${del(dr("x"))}</w:p>`);
    const { plan, text } = run(src, REJECT);
    expect(text()).toContain(ins(half));
    expect(plan.skipped).toEqual([
      `${DOC}: 1 change left as it is (they cover only part of a field)`,
    ]);
  });
});

describe("tracked changes: paragraph marks", () => {
  const insMark = `<w:p><w:pPr><w:rPr><w:ins ${A}/><w:b/></w:rPr></w:pPr>${r("a")}</w:p>`;
  const delMark = `<w:p><w:pPr><w:rPr><w:del ${A}/></w:rPr></w:pPr>${r("b")}</w:p>`;

  it("accepts an inserted paragraph mark and leaves a deleted one", () => {
    const { src, doc } = body(insMark + delMark);
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toBe(doc.replace(`<w:ins ${A}/>`, ""));
    expect(plan.skipped).toEqual([
      `${DOC}: 1 paragraph mark deletion left as it is (accepting them would join paragraphs)`,
    ]);
  });

  it("rejects a deleted paragraph mark and leaves an inserted one", () => {
    const { src, doc } = body(insMark + delMark);
    const { text, plan } = run(src, REJECT);
    expect(text()).toBe(doc.replace(`<w:del ${A}/>`, ""));
    expect(plan.skipped).toEqual([
      `${DOC}: 1 paragraph mark insertion left as it is (rejecting them would join paragraphs)`,
    ]);
  });
});

describe("tracked changes: formatting changes", () => {
  const rPr = `<w:rPr><w:b/><w:i/><w:rPrChange ${A}><w:rPr><w:i/><w:u w:val="single"/></w:rPr></w:rPrChange></w:rPr>`;
  const pPr =
    `<w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/><w:rPr><w:del ${A}/><w:b/></w:rPr>` +
    `<w:pPrChange ${A}><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:pPrChange></w:pPr>`;
  const sectPr =
    `<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:sectPrChange ${A}><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:sectPrChange></w:sectPr>`;
  const tbl =
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblPrChange ${A}><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr></w:tblPrChange></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4000"/><w:tblGridChange w:id="3"><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid></w:tblGridChange></w:tblGrid>` +
    `<w:tr><w:tblPrEx><w:jc w:val="left"/><w:tblPrExChange ${A}><w:tblPrEx/></w:tblPrExChange></w:tblPrEx>` +
    `<w:trPr><w:cantSplit/><w:trPrChange ${A}><w:trPr><w:tblHeader/></w:trPr></w:trPrChange></w:trPr>` +
    `<w:tc><w:tcPr><w:tcW w:w="4000"/><w:tcPrChange ${A}><w:tcPr><w:tcW w:w="3000"/></w:tcPr></w:tcPrChange></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`;
  const numPr = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/><w:numberingChange ${A} w:original="%1."/></w:numPr></w:pPr></w:p>`;
  const xml = `<w:p>${pPr}<w:r>${rPr}<w:t>x</w:t></w:r></w:p>${tbl}<w:p/>`;

  it("accepts: removes each record and keeps the current properties", () => {
    const { src, doc } = body(xml + numPr, { sectPr });
    const { text, plan } = run(src, ACCEPT);
    const expected = doc
      .replace(/<w:(rPr|pPr|sectPr|tblPr|tblPrEx|trPr|tcPr|tblGrid)Change\b.*?<\/w:\1Change>/g, "")
      .replace(/<w:numberingChange [^>]*\/>/, "");
    expect(text()).toBe(expected);
    expect(plan.details).toEqual([`${DOC}: accepts 9 formatting changes`]);
    expect(plan.skipped).toEqual([
      `${DOC}: 1 paragraph mark deletion left as it is (accepting them would join paragraphs)`,
    ]);
  });

  it("rejects: restores exactly the old properties, keeping what the record does not cover", () => {
    const { src, doc } = body(xml, { sectPr });
    const { text } = run(src, REJECT);
    const expected = doc
      .replace(rPr, `<w:rPr><w:i/><w:u w:val="single"/></w:rPr>`)
      .replace(pPr, `<w:pPr><w:pStyle w:val="Normal"/><w:rPr><w:b/></w:rPr></w:pPr>`)
      .replace(
        sectPr,
        `<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`,
      )
      .replace(
        /<w:tblPr>.*?<\/w:tblPr>(?=<w:tblGrid>)/,
        `<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>`,
      )
      .replace(
        /<w:tblGrid>.*?<\/w:tblGrid><\/w:tblGridChange><\/w:tblGrid>/,
        `<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>`,
      )
      .replace(/<w:tblPrEx>.*?<\/w:tblPrEx>(?=<w:trPr>)/, "<w:tblPrEx></w:tblPrEx>")
      .replace(/<w:trPr>.*?<\/w:trPr>(?=<w:tc>)/, "<w:trPr><w:tblHeader/></w:trPr>")
      .replace(/<w:tcPr>.*?<\/w:tcPr>(?=<w:p\/>)/, `<w:tcPr><w:tcW w:w="3000"/></w:tcPr>`);
    expect(text()).toBe(expected);
  });

  it("leaves a numbering change on reject, and a record it cannot match", () => {
    const odd = `<w:p><w:pPr><w:jc w:val="left"/><w:pPrChange w:id="1"/></w:pPr></w:p>`;
    const { src } = body(numPr + odd + `<w:p>${del(dr("a"))}</w:p>`);
    const { plan } = run(src, REJECT);
    expect(plan.skipped).toEqual([
      `${DOC}: 1 numbering change left as it is (the earlier numbering cannot be rebuilt)`,
      `${DOC}: 1 formatting change left as it is (the earlier formatting could not be restored safely)`,
    ]);
  });
});

describe("tracked changes: tables", () => {
  const row = (trPr: string, t: string) => `<w:tr>${trPr}<w:tc><w:p>${r(t)}</w:p></w:tc></w:tr>`;
  const plain = row("", "plain");
  const added = row(`<w:trPr><w:ins ${A}/></w:trPr>`, "added");
  const gone = row(`<w:trPr><w:del ${A}/></w:trPr>`, "gone");
  const table = (rows: string) =>
    `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>${rows}</w:tbl>`;

  it("accepts row insertions and removes deleted rows", () => {
    const { src, doc } = body(table(plain + added + gone) + "<w:p/>");
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toBe(doc.replace(`<w:ins ${A}/>`, "").replace(gone, ""));
    expect(plan.details).toEqual([
      `${DOC}: accepts 1 insertion and 1 deletion, removing 1 table row`,
    ]);
  });

  it("rejects row insertions by removing the rows", () => {
    const { src, doc } = body(table(plain + added + gone) + "<w:p/>");
    expect(run(src, REJECT).text()).toBe(doc.replace(added, "").replace(`<w:del ${A}/>`, ""));
  });

  it("removes a table whose every row goes", () => {
    const t = table(added + added);
    const { src, doc } = body(t + "<w:p/>");
    expect(run(src, REJECT).text()).toBe(doc.replace(t, ""));
  });

  it("leaves rows with vertically merged cells and cell-level changes", () => {
    const merged = `<w:tr><w:trPr><w:del ${A}/></w:trPr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc></w:tr>`;
    const cell = `<w:tr><w:tc><w:tcPr><w:cellDel ${A}/></w:tcPr><w:p/></w:tc></w:tr>`;
    const { src } = body(table(plain + merged + cell) + `<w:p>${ins(r("x"))}</w:p>`);
    const { plan, text } = run(src, ACCEPT);
    expect(text()).toContain(merged);
    expect(text()).toContain(cell);
    expect(plan.skipped).toEqual([
      `${DOC}: 1 table row change left as it is (the rows have vertically merged cells or hold part of a field)`,
      `${DOC}: 1 table cell change left as it is (inserted, deleted or merged cells are not handled)`,
    ]);
  });
});

describe("tracked changes: text boxes and alternate content", () => {
  const box = (inner: string) =>
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p>${inner}</w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><v:textbox><w:txbxContent><w:p>${inner}</w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

  it("changes both copies alike and counts one", () => {
    const { src, doc } = body(`<w:p>${box(ins(r("t")))}</w:p>`);
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toBe(doc.split(ins(r("t"))).join(r("t")));
    expect(plan.details).toEqual([`${DOC}: accepts 1 insertion`]);
  });

  it("leaves copies that would not change alike", () => {
    const odd =
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent><w:p>${ins(r("t"))}</w:p></w:txbxContent></mc:Choice>` +
      `<mc:Fallback><w:txbxContent><w:p>${r("t")}</w:p></w:txbxContent></mc:Fallback></mc:AlternateContent></w:r>`;
    const { src, doc } = body(`<w:p>${odd}${del(dr("x"))}</w:p>`);
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toBe(doc.replace(del(dr("x")), ""));
    expect(plan.skipped).toEqual([
      `${DOC}: 1 change in a text box or drawing left as it is (its two stored copies do not change alike)`,
    ]);
  });
});

describe("tracked changes: every story part", () => {
  const story = (root: string, xml: string) =>
    `<?xml version="1.0"?><${root} ${NS}>${xml}</${root}>`;
  const options = (header: string): HandOptions => ({
    rels: {
      rId1: ["header", "header1.xml"],
      rId2: ["footer", "footer1.xml"],
      rId3: ["footnotes", "footnotes.xml"],
      rId4: ["comments", "comments.xml"],
      rId5: ["settings", "settings.xml"],
    },
    extra: {
      "word/header1.xml": header,
      "word/footer1.xml": story("w:ftr", `<w:p>${del(dr("f"))}</w:p>`),
      "word/footnotes.xml": story(
        "w:footnotes",
        `<w:footnote w:id="1"><w:p>${ins(r("n"))}</w:p></w:footnote>`,
      ),
      "word/comments.xml": story(
        "w:comments",
        `<w:comment w:id="0" w:author="Jane Smith"><w:p>${ins(r("c"))}</w:p></w:comment>`,
      ),
      "word/settings.xml": story("w:settings", "<w:trackRevisions/>"),
    },
  });

  it("accepts in headers, footers, footnotes and comments, and leaves settings alone", () => {
    const header = story("w:hdr", `<w:p>${ins(r("h"))}</w:p>`);
    const src = handDocx(`<w:p>${ins(r("d"))}</w:p>`, options(header));
    const { plan, text } = run(src, ACCEPT);
    expect(plan.changes.map((c) => c.part).sort()).toEqual([
      "word/comments.xml",
      DOC,
      "word/footer1.xml",
      "word/footnotes.xml",
      "word/header1.xml",
    ]);
    expect(text("word/header1.xml")).toBe(header.replace(ins(r("h")), r("h")));
    expect(text("word/footer1.xml")).not.toContain("w:del");
    expect(plan.details).toContain(
      "Track changes stays switched on (settings.xml is not changed), so new edits will still be tracked",
    );
    expect(offer(src, ACCEPT)).toBe("4 insertions and 1 deletion");
  });

  it("leaves a damaged part alone and says so", () => {
    const broken = `<w:hdr ${NS}><w:p>${ins(r("h"))}</w:hdr>`;
    const src = handDocx(`<w:p>${ins(r("d"))}</w:p>`, options(broken));
    const { plan } = run(src, ACCEPT);
    expect(plan.changes.map((c) => c.part)).not.toContain("word/header1.xml");
    expect(plan.skipped).toContain(
      "word/header1.xml: could not be read, so its tracked changes are left as they are",
    );
    expect(offer(src, REJECT)).toBe("3 insertions and 1 deletion (1 part could not be read)");
  });
});

describe("tracked changes: odd input", () => {
  it("never throws on a package without a document", () => {
    const src: PartSource = { names: () => [], text: () => undefined };
    expect(offersFor(src, trackedChangeRepairs)).toEqual([]);
  });

  it("leaves a wrapper that declares a namespace its content would lose", () => {
    const x = `<w:ins w:id="1" xmlns:q="urn:q"><w:r><q:x/></w:r></w:ins>`;
    const { src } = body(`<w:p>${x}${del(dr("a"))}</w:p>`);
    const { text, plan } = run(src, ACCEPT);
    expect(text()).toContain(x);
    expect(plan.skipped).toEqual([
      `${DOC}: 1 change left as it is (they are written in an unusual way)`,
    ]);
  });
});

describe("tracked changes: the rich sample", () => {
  it("accepts and rejects the sample's revisions cleanly", async () => {
    const src = sourceFromZip(await richSampleBytes());
    const doc = src.text(DOC)!;
    expect(doc).toContain("<w:ins ");
    expect(doc).toContain("<w:del ");
    expect(offer(src, ACCEPT)).toBe("1 insertion and 1 deletion");
    const accepted = run(src, ACCEPT).text()!;
    expect(accepted).not.toMatch(/<w:(ins|del|delText)\b/);
    expect(accepted).toContain("Inserted words");
    expect(accepted).not.toContain("deleted words");
    expect(accepted.length).toBeLessThan(doc.length);
    const rejected = run(src, REJECT).text()!;
    expect(rejected).not.toMatch(/<w:(ins|del|delText)\b/);
    expect(rejected).not.toContain("Inserted words");
    expect(rejected).toContain("deleted words");
  });
});
