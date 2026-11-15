import { describe, expect, it } from "vitest";
import type { RepairPlan } from "../../../core/repair";
import { inspectDocx } from "../inspect";
import type { PartSource } from "../package";
import { handDocx, NS, richSampleBytes, sourceFromParts, sourceFromZip } from "../test-helpers";
import { parseXml } from "../xml";
import { offersFor, planFor } from "./index";

const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex";

const REF = (id: number) =>
  `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;

const BODY =
  `<w:p><w:commentRangeStart w:id="1"/><w:commentRangeStart w:id="2"/><w:r><w:t>Alpha</w:t></w:r>` +
  `<w:commentRangeEnd w:id="1"/>${REF(1)}<w:commentRangeEnd w:id="2"/>` +
  `<w:r><w:t>reply</w:t><w:commentReference w:id="2"/></w:r></w:p>\n` +
  `<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>Beta</w:t></w:r><w:r><w:t> more</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Gamma</w:t></w:r><w:commentRangeEnd w:id="3"/>${REF(3)}` +
  `<w:commentRangeStart w:id="4"/><w:commentRangeEnd w:id="4"/>${REF(4)}</w:p>` +
  `<w:p><w:commentRangeStart w:id="99"/><w:r><w:t>Orphan</w:t></w:r><w:commentRangeEnd w:id="99"/>${REF(99)}</w:p>`;

const comment = (id: number, para: string, text: string) =>
  `<w:comment w:id="${id}" w:author="Ravi" w:initials="R" w:date="2024-01-01T00:00:00Z">` +
  `<w:p w14:paraId="${para}0"><w:r><w:t>${text}</w:t></w:r></w:p>` +
  `<w:p w14:paraId="${para}"><w:r><w:t>last</w:t></w:r></w:p></w:comment>`;

const COMMENTS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:comments ${NS}>` +
  comment(1, "11111111", "Secret one") +
  comment(2, "22222222", "Secret two") +
  comment(3, "33333333", "Secret three") +
  comment(4, "44444444", "Secret four") +
  `</w:comments>`;

const EXTENDED =
  `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="11111111" w15:done="1"/>` +
  `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="1"/>` +
  `<w15:commentEx w15:paraId="33333333" w15:done="0"/>` +
  `<w15:commentEx w15:paraId="44444444" w15:paraIdParent="33333333" w15:done="0"/></w15:commentsEx>`;

const IDS =
  `<w16cid:commentsIds xmlns:w16cid="${CID}"><w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="AAAA0001"/>` +
  `<w16cid:commentId w16cid:paraId="22222222" w16cid:durableId="AAAA0002"/>` +
  `<w16cid:commentId w16cid:paraId="33333333" w16cid:durableId="AAAA0003"/>` +
  `<w16cid:commentId w16cid:paraId="44444444" w16cid:durableId="AAAA0004"/></w16cid:commentsIds>`;

const EXTENSIBLE =
  `<w16cex:commentsExtensible xmlns:w16cex="${CEX}">` +
  ["AAAA0001", "AAAA0002", "AAAA0003", "AAAA0004"]
    .map(
      (d) =>
        `<w16cex:commentExtensible w16cex:durableId="${d}" w16cex:dateUtc="2024-01-01T00:00:00Z"/>`,
    )
    .join("") +
  `</w16cex:commentsExtensible>`;

const HEADER = `<w:hdr ${NS}><w:p><w:commentRangeStart w:id="5"/><w:r><w:t>Head</w:t></w:r><w:commentRangeEnd w:id="5"/>${REF(5)}</w:p></w:hdr>`;
const FOOTNOTES = `<w:footnotes ${NS}><w:footnote w:id="1"><w:p><w:commentRangeStart w:id="6"/><w:r><w:t>Note</w:t></w:r><w:commentRangeEnd w:id="6"/>${REF(6)}</w:p></w:footnote></w:footnotes>`;

interface Opts {
  extended?: boolean;
  ids?: boolean;
  stories?: boolean;
}

function fixture(o: Opts = {}): PartSource {
  const extra: Record<string, string> = { "word/comments.xml": COMMENTS };
  const rels: Record<string, [string, string]> = { rC: ["comments", "comments.xml"] };
  if (o.extended !== false) {
    extra["word/commentsExtended.xml"] = EXTENDED;
    rels.rE = ["commentsExtended", "commentsExtended.xml"];
  }
  if (o.ids !== false) {
    extra["word/commentsIds.xml"] = IDS;
    rels.rI = ["commentsIds", "commentsIds.xml"];
    extra["word/commentsExtensible.xml"] = EXTENSIBLE;
    rels.rX = ["commentsExtensible", "commentsExtensible.xml"];
  }
  if (o.stories) {
    extra["word/header1.xml"] = HEADER;
    extra["word/footnotes.xml"] = FOOTNOTES;
    rels.rH = ["header", "header1.xml"];
    rels.rF = ["footnotes", "footnotes.xml"];
    extra["word/comments.xml"] = COMMENTS.replace(
      "</w:comments>",
      comment(5, "55555555", "h") + comment(6, "66666666", "f") + "</w:comments>",
    );
    if (o.extended !== false) {
      extra["word/commentsExtended.xml"] = EXTENDED.replace(
        "</w15:commentsEx>",
        `<w15:commentEx w15:paraId="55555555" w15:done="1"/><w15:commentEx w15:paraId="66666666" w15:done="0"/></w15:commentsEx>`,
      );
    }
  }
  return handDocx(BODY, { extra, rels });
}

function partsOf(src: PartSource): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const name of src.names()) parts[name] = src.text(name) ?? "";
  return parts;
}

function applyPlan(src: PartSource, plan: RepairPlan): PartSource {
  const parts = partsOf(src);
  for (const c of plan.changes) parts[c.part] = c.text;
  return sourceFromParts(parts);
}

const errors = (src: PartSource) => inspectDocx(src).filter((f) => f.severity === "error").length;

function wellFormed(plan: RepairPlan) {
  for (const c of plan.changes) {
    const doc = parseXml(c.text);
    expect(doc.problems, c.part).toEqual([]);
    expect(doc.root, c.part).not.toBeNull();
  }
}

const textOf = (src: PartSource, part: string) => src.text(part) ?? "";
const change = (plan: RepairPlan, part: string) => plan.changes.find((c) => c.part === part)?.text;
const offerOf = (src: PartSource, id: string) => offersFor(src).find((o) => o.id === id);

describe("docx.remove-comments", () => {
  it("is not offered for a file without comments, or planned", () => {
    const src = handDocx("<w:p><w:r><w:t>Hi</w:t></w:r></w:p>");
    expect(offersFor(src)).toEqual([]);
    expect(planFor(src, "docx.remove-comments")).toBeNull();
  });

  it("offers counts only, never text or names", () => {
    const offers = offersFor(fixture());
    const o = offers.find((x) => x.id === "docx.remove-comments")!;
    expect(o.title).toBe("Remove all comments");
    expect(o.summary).toBe("4 comments, 2 of them replies");
    expect(JSON.stringify(offers)).not.toMatch(/Secret|Ravi/);
  });

  it("removes every anchor, reference run, comment and extension entry, byte for byte elsewhere", () => {
    const src = fixture();
    const plan = planFor(src, "docx.remove-comments")!;
    wellFormed(plan);
    const body = textOf(src, "word/document.xml")
      .replace(/<w:commentRange(Start|End) w:id="\d+"\/>/g, "")
      .replace(
        /<w:r><w:rPr><w:rStyle w:val="CommentReference"\/><\/w:rPr><w:commentReference w:id="\d+"\/><\/w:r>/g,
        "",
      )
      .replace('<w:commentReference w:id="2"/>', "");
    expect(change(plan, "word/document.xml")).toBe(body);
    // The mixed run keeps its text.
    expect(body).toContain("<w:r><w:t>reply</w:t></w:r>");
    expect(change(plan, "word/comments.xml")).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:comments ${NS}></w:comments>`,
    );
    expect(change(plan, "word/commentsExtended.xml")).toBe(
      `<w15:commentsEx xmlns:w15="${W15}"></w15:commentsEx>`,
    );
    expect(change(plan, "word/commentsIds.xml")).toBe(
      `<w16cid:commentsIds xmlns:w16cid="${CID}"></w16cid:commentsIds>`,
    );
    expect(change(plan, "word/commentsExtensible.xml")).toBe(
      `<w16cex:commentsExtensible xmlns:w16cex="${CEX}"></w16cex:commentsExtensible>`,
    );
    expect(JSON.stringify(plan)).not.toMatch(/Secret|Ravi/);
    expect(plan.details.join(" ")).toMatch(/people\.xml/);
    expect(plan.details.join(" ")).toMatch(/Anonymise authors/);
  });

  it("covers headers and footnotes", () => {
    const src = fixture({ stories: true });
    const plan = planFor(src, "docx.remove-comments")!;
    wellFormed(plan);
    expect(change(plan, "word/header1.xml")).toBe(
      textOf(src, "word/header1.xml")
        .replace(/<w:commentRange(Start|End) w:id="5"\/>/g, "")
        .replace(REF(5), ""),
    );
    expect(change(plan, "word/footnotes.xml")).not.toMatch(/comment/);
    expect(offerOf(src, "docx.remove-comments")!.summary).toBe("6 comments, 2 of them replies");
  });

  it("works with a comments part and no extension parts", () => {
    const src = fixture({ extended: false, ids: false });
    const plan = planFor(src, "docx.remove-comments")!;
    wellFormed(plan);
    expect(plan.changes.map((c) => c.part).sort()).toEqual([
      "word/comments.xml",
      "word/document.xml",
    ]);
    expect(offerOf(src, "docx.remove-comments")!.summary).toBe("4 comments");
  });

  it("removes orphan markers and is idempotent", () => {
    const src = fixture();
    const after = applyPlan(src, planFor(src, "docx.remove-comments")!);
    expect(textOf(after, "word/document.xml")).not.toMatch(/comment(Range|Reference)/);
    expect(offersFor(after)).toEqual([]);
    expect(planFor(after, "docx.remove-comments")).toBeNull();
  });

  it("offers stray markers alone when there is no comments part", () => {
    const src = handDocx(
      `<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="7"/>${REF(7)}</w:p>`,
    );
    expect(offerOf(src, "docx.remove-comments")!.summary).toBe(
      "3 stray comment markers with no comment",
    );
    const plan = planFor(src, "docx.remove-comments")!;
    wellFormed(plan);
    expect(change(plan, "word/document.xml")).not.toMatch(/comment/);
  });

  it("does not introduce errors the inspector can see", () => {
    const src = fixture({ stories: true });
    const before = errors(src);
    const after = applyPlan(src, planFor(src, "docx.remove-comments")!);
    expect(errors(after)).toBeLessThanOrEqual(before);
  });

  it("leaves damaged parts alone and says so", () => {
    const parts = partsOf(fixture());
    parts["word/commentsExtended.xml"] = "<w15:commentsEx><w15:commentEx>";
    const plan = planFor(sourceFromParts(parts), "docx.remove-comments")!;
    expect(plan.changes.find((c) => c.part === "word/commentsExtended.xml")).toBeUndefined();
    expect(plan.skipped.join(" ")).toMatch(/commentsExtended/);
    parts["word/comments.xml"] = "<w:comments><w:comment>";
    const broken = sourceFromParts(parts);
    expect(offerOf(broken, "docx.remove-comments")).toBeUndefined();
    expect(planFor(broken, "docx.remove-comments")).toBeNull();
  });

  it("handles the rich sample", async () => {
    const src = sourceFromZip(await richSampleBytes());
    expect(offerOf(src, "docx.remove-comments")?.summary).toBe("1 comment");
    expect(offerOf(src, "docx.remove-resolved-comments")).toBeUndefined();
    const before = errors(src);
    const plan = planFor(src, "docx.remove-comments")!;
    wellFormed(plan);
    const after = applyPlan(src, plan);
    expect(textOf(after, "word/document.xml")).not.toMatch(/comment(Range|Reference)/);
    expect(textOf(after, "word/document.xml")).toContain("Revenue was 4.2 million.");
    expect(errors(after)).toBeLessThanOrEqual(before);
    expect(offerOf(after, "docx.remove-comments")).toBeUndefined();
  });
});

describe("docx.remove-resolved-comments", () => {
  it("is not offered when nothing is resolved", () => {
    const src = fixture({ extended: false });
    expect(offerOf(src, "docx.remove-resolved-comments")).toBeUndefined();
    expect(planFor(src, "docx.remove-resolved-comments")).toBeNull();
  });

  it("removes a resolved thread with its reply and keeps the unresolved one intact", () => {
    const src = fixture();
    expect(offerOf(src, "docx.remove-resolved-comments")!.summary).toBe("2 resolved comments");
    const plan = planFor(src, "docx.remove-resolved-comments")!;
    wellFormed(plan);
    const body = textOf(src, "word/document.xml")
      .replace(/<w:commentRange(Start|End) w:id="[12]"\/>/g, "")
      .replace(REF(1), "")
      .replace('<w:commentReference w:id="2"/>', "");
    expect(change(plan, "word/document.xml")).toBe(body);
    expect(change(plan, "word/comments.xml")).toBe(
      textOf(src, "word/comments.xml")
        .replace(comment(1, "11111111", "Secret one"), "")
        .replace(comment(2, "22222222", "Secret two"), ""),
    );
    expect(change(plan, "word/commentsExtended.xml")).toBe(
      EXTENDED.replace(/<w15:commentEx w15:paraId="(1111|2222)[^>]*\/>/g, ""),
    );
    expect(change(plan, "word/commentsIds.xml")).toBe(
      IDS.replace(/<w16cid:commentId w16cid:paraId="(11111111|22222222)" [^>]*\/>/g, ""),
    );
    expect(change(plan, "word/commentsExtensible.xml")).not.toMatch(/AAAA000[12]/);
    expect(change(plan, "word/commentsExtensible.xml")).toMatch(/AAAA0003/);
    expect(plan.details.join(" ")).toMatch(/2 other comments stay/);
    expect(JSON.stringify([plan.details, plan.skipped])).not.toMatch(/Secret|Ravi/);
  });

  it("keeps a resolved reply whose parent is open, and clears resolved ones in headers", () => {
    const parts = partsOf(fixture({ stories: true }));
    parts["word/commentsExtended.xml"] = parts["word/commentsExtended.xml"]!.replace(
      'w15:paraIdParent="33333333" w15:done="0"',
      'w15:paraIdParent="33333333" w15:done="1"',
    );
    const src = sourceFromParts(parts);
    // Comments 1, 2 and 5 only: the reply to the open thread stays.
    expect(offerOf(src, "docx.remove-resolved-comments")!.summary).toBe("3 resolved comments");
    const plan = planFor(src, "docx.remove-resolved-comments")!;
    wellFormed(plan);
    expect(change(plan, "word/comments.xml")).toContain('w:id="4"');
    expect(change(plan, "word/comments.xml")).toContain('w:id="6"');
    expect(change(plan, "word/comments.xml")).not.toContain('w:id="5"');
    expect(change(plan, "word/header1.xml")).not.toMatch(/comment/);
    expect(change(plan, "word/footnotes.xml")).toBeUndefined();
    expect(change(plan, "word/document.xml")).toContain('<w:commentRangeStart w:id="3"/>');
    expect(change(plan, "word/document.xml")).toContain('w:id="99"');
  });

  it("is idempotent and passes the inspector", () => {
    const src = fixture({ stories: true });
    const before = errors(src);
    const after = applyPlan(src, planFor(src, "docx.remove-resolved-comments")!);
    expect(offerOf(after, "docx.remove-resolved-comments")).toBeUndefined();
    expect(errors(after)).toBeLessThanOrEqual(before);
    expect(offerOf(after, "docx.remove-comments")!.summary).toBe("3 comments, 1 of them a reply");
  });
});
