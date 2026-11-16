/**
 * End to end: every repair applied to real-looking Word files through the real save path
 * (`ContainerPlatform.replaceParts` over an in-memory disk), then checked from the outside: the
 * archive reads, only the listed parts changed, each changed part is well-formed, the Formatting
 * view still generates, the inspector reports nothing new, a second run changes nothing, and the
 * private data a repair claims to clear is gone from every part.
 */
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { readZip } from "../../../core/archive";
import type { FormatProvider } from "../../../core/format";
import { FormatRegistry } from "../../../core/registry";
import type { RepairPlan } from "../../../core/repair";
import { ContainerPlatform } from "../../../platform/containers";
import { MemoryPlatform } from "../../../platform/memory";
import { xmlProblem } from "../../../platform/xml-check";
import { decodeDocx } from "../decode";
import { runDocxOp } from "../docx-ops";
import { inspectDocx, partSourceFromZip } from "../inspect";
import { NS, richSampleBytes } from "../test-helpers";
import { decodeEntities } from "../xml";
import { docxRepairOffers, docxRepairPlan, REPAIRS } from "./index";
import { SAMPLE_PEOPLE, SAMPLE_SECRETS, wordPackage, wordPackageParts } from "./word-package";

const CONTAINER = "/demo/sample.docx";

const zipProvider: FormatProvider = {
  kind: "text",
  id: "docx",
  name: "Word document",
  fileExtensions: ["docx"],
  viewModes: ["source"],
  readOnly: true,
  binary: { archive: "zip", decode: async () => "view" },
  editorExtensions: () => [],
};

/** Applies one repair through the real save path; returns the plan and the file afterwards. */
async function applyRepair(
  bytes: Uint8Array,
  id: string,
): Promise<{ plan: RepairPlan | null; after: Uint8Array }> {
  const registry = new FormatRegistry();
  registry.register(zipProvider);
  const memory = new MemoryPlatform();
  memory.seedBinary(CONTAINER, bytes);
  const platform = new ContainerPlatform(memory, registry);
  const plan = await docxRepairPlan(bytes, id);
  if (plan) await platform.containers.replaceParts(CONTAINER, plan.changes, { basis: bytes });
  const after = memory.binaryFiles.get(CONTAINER);
  if (!after) throw new Error("the file disappeared");
  return { plan, after };
}

/** Every part's text, decoded as the app decodes it, by name. */
function texts(bytes: Uint8Array): Map<string, string> {
  const source = partSourceFromZip(bytes);
  const out = new Map<string, string>();
  for (const name of source.names()) out.set(name, source.text(name) ?? "");
  return out;
}

/** Problems that matter: errors and warnings, counted per rule. */
function problemCounts(bytes: Uint8Array): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of inspectDocx(partSourceFromZip(bytes))) {
    if (f.severity !== "error" && f.severity !== "warning") continue;
    counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  }
  return counts;
}

function rules(bytes: Uint8Array): Set<string> {
  return new Set(inspectDocx(partSourceFromZip(bytes)).map((f) => f.rule));
}

/** The parts of `text` (decoded, with entities decoded too) that contain `needle`. */
function partsContaining(bytes: Uint8Array, needle: string): string[] {
  const out: string[] = [];
  for (const [name, text] of texts(bytes)) {
    if (text.includes(needle) || decodeEntities(text).includes(needle)) out.push(name);
  }
  return out;
}

/** The checks every repair must pass on every file. */
async function checkRepair(before: Uint8Array, id: string): Promise<Uint8Array> {
  const { plan, after } = await applyRepair(before, id);
  expect(plan, `${id} should apply`).not.toBeNull();
  if (!plan) return after;

  // The archive reads, with our reader and with fflate.
  const zipBefore = readZip(before);
  const zipAfter = readZip(after);
  expect(() => unzipSync(after)).not.toThrow();

  // Only the listed parts changed; everything else is byte for byte the same.
  const listed = new Set(plan.changes.map((c) => c.part));
  expect(zipAfter.entries.map((e) => e.name)).toEqual(zipBefore.entries.map((e) => e.name));
  for (const entry of zipBefore.entries) {
    if (entry.isDirectory) continue;
    const same = Buffer.from(zipAfter.bytes(entry.name)).equals(
      Buffer.from(zipBefore.bytes(entry.name)),
    );
    expect(same, `${id}: ${entry.name}`).toBe(!listed.has(entry.name));
  }

  // Each changed part is well-formed XML.
  const now = texts(after);
  for (const part of listed) expect(xmlProblem(now.get(part) ?? ""), `${id}: ${part}`).toBeNull();

  // The Formatting view still generates.
  const view = await decodeDocx(after, { path: CONTAINER });
  expect(view.text.length).toBeGreaterThan(0);

  // No new problem from the inspector.
  const was = problemCounts(before);
  for (const [rule, n] of problemCounts(after)) {
    expect(n, `${id}: new or more ${rule}`).toBeLessThanOrEqual(was.get(rule) ?? 0);
  }

  // Idempotent: a second run has nothing to do (or does it again identically).
  const again = await docxRepairPlan(after, id);
  expect(again, `${id} offered again after it was applied`).toBeNull();

  // Plain words only: no document text or names in what the user is shown.
  for (const line of [...plan.details, ...plan.skipped, plan.title]) {
    for (const person of SAMPLE_PEOPLE) expect(line).not.toContain(person);
    for (const secret of Object.values(SAMPLE_SECRETS)) expect(line).not.toContain(secret);
  }
  return after;
}

describe("every repair on a hand-written Word package", () => {
  const sample = wordPackage();

  it("offers every repair on the sample", async () => {
    const offers = await docxRepairOffers(sample);
    expect(offers.map((o) => o.id).sort()).toEqual(REPAIRS.map((r) => r.id).sort());
    for (const o of offers) {
      for (const person of SAMPLE_PEOPLE) expect(o.summary).not.toContain(person);
    }
  });

  it("the worker routes give the same offers and plans", async () => {
    expect(await runDocxOp("repairOffers", sample, { path: CONTAINER })).toEqual(
      await docxRepairOffers(sample),
    );
    const id = "docx.accept-tracked-changes";
    expect(await runDocxOp("repairPlan", sample, { path: CONTAINER, id })).toEqual(
      await docxRepairPlan(sample, id),
    );
    expect(await runDocxOp("repairPlan", sample, { path: CONTAINER, id: "nope" })).toBeNull();
    expect(await runDocxOp("repairOffers", new Uint8Array([1, 2, 3]), { path: CONTAINER })).toEqual(
      [],
    );
  });

  for (const repair of REPAIRS) {
    it(`${repair.id}: safe, surgical, idempotent`, async () => {
      await checkRepair(sample, repair.id);
    });
  }

  it("accept all: no tracked changes left for the inspector, and the accepted text reads right", async () => {
    const after = await checkRepair(sample, "docx.accept-tracked-changes");
    const { plan } = await applyRepair(sample, "docx.accept-tracked-changes");
    // In the content nothing is left; the formatting change in a style definition is reported.
    expect(plan?.skipped).toEqual([
      "word/styles.xml: tracked changes in the style definitions are left as they are (only the document's content is covered)",
    ]);
    expect(rules(after).has("revisions.tracked-changes")).toBe(false);
    const view = (await decodeDocx(after, { path: CONTAINER })).text;
    expect(view).toContain("The fee is twelve **thousand** pounds.");
    expect(view).not.toContain("Added then removed");
    expect(view).not.toContain("Old row");
    expect(view).toContain("New row");
    expect(view).toContain("new result");
    expect(view).not.toContain("old result");
    expect(view.match(/Moved sentence/g)?.length).toBe(1);
  });

  it("reject all: the earlier text comes back, and what it leaves is listed", async () => {
    const after = await checkRepair(sample, "docx.reject-tracked-changes");
    const { plan } = await applyRepair(sample, "docx.reject-tracked-changes");
    const view = (await decodeDocx(after, { path: CONTAINER })).text;
    expect(view).toContain("The fee is ten pounds.");
    expect(view).not.toContain("twelve");
    expect(view).toContain("Old row");
    expect(view).not.toContain("New row");
    expect(view).toContain("old result");
    expect(view).not.toContain("new result");
    expect(view.match(/Moved sentence/g)?.length).toBe(1);
    // Left alone: the inserted paragraph mark (would join paragraphs).
    expect(plan?.skipped.join("\n")).toMatch(/paragraph mark insertion/);
    const doc = texts(after).get("word/document.xml") ?? "";
    expect(doc).not.toMatch(/<w:delText|<w:delInstrText/);
  });

  it("remove all comments: no anchors, references, comments or extension entries left", async () => {
    const after = await checkRepair(sample, "docx.remove-comments");
    const t = texts(after);
    for (const part of ["word/document.xml", "word/footnotes.xml", "word/header1.xml"]) {
      expect(t.get(part)).not.toMatch(/commentRange|commentReference/);
    }
    expect(t.get("word/comments.xml")).not.toMatch(/<w:comment\b/);
    expect(t.get("word/commentsExtended.xml")).not.toMatch(/commentEx\b/);
    expect(t.get("word/commentsIds.xml")).not.toMatch(/commentId\b/);
    expect(t.get("word/commentsExtensible.xml")).not.toMatch(/commentExtensible\b/);
    for (const rule of rules(after)) expect(rule).not.toMatch(/comment/);
  });

  it("remove resolved comments: only the resolved thread goes", async () => {
    const after = await checkRepair(sample, "docx.remove-resolved-comments");
    const t = texts(after);
    expect(t.get("word/comments.xml")).toMatch(/w:id="0"/);
    expect(t.get("word/comments.xml")).toMatch(/w:id="1"/);
    expect(t.get("word/comments.xml")).not.toMatch(/w:id="2"/);
    expect(t.get("word/document.xml")).not.toMatch(/commentRangeStart w:id="2"/);
    expect(t.get("word/commentsIds.xml")).not.toMatch(/33333333/);
    expect(t.get("word/commentsExtensible.xml")).not.toMatch(/33333333/);
  });

  it("anonymise authors: no author name or sign-in id left anywhere but the document properties", async () => {
    const after = await checkRepair(sample, "docx.anonymise-authors");
    const { plan } = await applyRepair(sample, "docx.anonymise-authors");
    for (const person of SAMPLE_PEOPLE) {
      const left = partsContaining(after, person).filter((p) => p !== "docProps/core.xml");
      expect(left, person).toEqual([]);
    }
    expect(partsContaining(after, SAMPLE_SECRETS.email)).toEqual([]);
    // The properties are another clean-up's job, and the plan says so.
    expect(plan?.details.join("\n")).toMatch(/document properties/);
  });

  it("names: anonymise authors then remove names from the properties leaves no name at all", async () => {
    const once = (await applyRepair(sample, "docx.anonymise-authors")).after;
    const twice = await checkRepair(once, "docx.scrub-properties");
    for (const person of SAMPLE_PEOPLE) expect(partsContaining(twice, person), person).toEqual([]);
  });

  it("remove names from the properties: creator, last editor, company and manager are gone", async () => {
    const after = await checkRepair(sample, "docx.scrub-properties");
    const t = texts(after);
    expect(t.get("docProps/core.xml")).not.toContain("Alice Example");
    expect(t.get("docProps/core.xml")).not.toContain("O'Neil");
    expect(partsContaining(after, SAMPLE_SECRETS.company)).toEqual([]);
    expect(partsContaining(after, SAMPLE_SECRETS.manager)).toEqual([]);
  });

  it("clear descriptive properties: no title, subject, keywords or description left anywhere", async () => {
    const after = await checkRepair(sample, "docx.clear-descriptive-properties");
    for (const key of [
      "title",
      "subject",
      "keywords",
      "description",
      "category",
      "status",
    ] as const) {
      expect(partsContaining(after, SAMPLE_SECRETS[key]), key).toEqual([]);
    }
  });

  it("remove custom properties: values, template and hyperlink base are gone; the template path is reported", async () => {
    const after = await checkRepair(sample, "docx.remove-custom-properties");
    const { plan } = await applyRepair(sample, "docx.remove-custom-properties");
    expect(partsContaining(after, SAMPLE_SECRETS.custom)).toEqual([]);
    expect(partsContaining(after, SAMPLE_SECRETS.customName)).toEqual([]);
    expect(partsContaining(after, SAMPLE_SECRETS.hyperlinkBase)).toEqual([]);
    // The attached template's path (with a user name in it) lives in a relationship, which this
    // clean-up does not change: it must say so rather than claim the template is gone.
    expect(partsContaining(after, SAMPLE_SECRETS.template)).toEqual([
      "word/_rels/settings.xml.rels",
    ]);
    expect(plan?.skipped.join("\n")).toMatch(/settings\.xml\.rels/);
  });

  it("remove rsids: no rsid attribute or list left in the parts it covers", async () => {
    const after = await checkRepair(sample, "docx.remove-rsids");
    for (const [name, text] of texts(after)) {
      if (!name.endsWith(".xml")) continue;
      expect(text, name).not.toMatch(/w:rsid\w*=|<w:rsids|<w:rsid /);
    }
  });
});

describe("every repair on a file made by the docx package", () => {
  let sample: Uint8Array;
  beforeAll(async () => {
    sample = await richSampleBytes();
  });

  it("applies each offered repair safely", async () => {
    const offers = await docxRepairOffers(sample);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) await checkRepair(sample, offer.id);
  });

  it("anonymise authors leaves no revision or comment author", async () => {
    const after = await checkRepair(sample, "docx.anonymise-authors");
    for (const name of ["word/document.xml", "word/comments.xml"]) {
      expect(texts(after).get(name), name).not.toContain("Ravi Patel");
    }
  });
});

describe("encodings and line endings survive a repair", () => {
  const parts = wordPackageParts();

  it("a CRLF part keeps CRLF everywhere and only the changed lines differ", async () => {
    const crlf = parts["docProps/core.xml"]!.replaceAll("><", ">\r\n<");
    const before = wordPackage({ "docProps/core.xml": crlf });
    const after = await checkRepair(before, "docx.scrub-properties");
    const raw = new TextDecoder().decode(readZip(after).bytes("docProps/core.xml"));
    expect(raw.split("\r\n").length).toBe(crlf.split("\r\n").length);
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/\n/);
    expect(raw).toContain("<dc:creator></dc:creator>");
  });

  it("a UTF-16LE part with a BOM stays UTF-16LE with its BOM", async () => {
    const text = parts["word/comments.xml"]!.replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const body = new Uint8Array(2 + text.length * 2);
    const view = new DataView(body.buffer);
    view.setUint16(0, 0xfeff, true);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
    const before = wordPackage({ "word/comments.xml": body });
    const after = await checkRepair(before, "docx.anonymise-authors");
    const bytes = readZip(after).bytes("word/comments.xml");
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
    const decoded = new TextDecoder("utf-16le").decode(bytes.subarray(2));
    expect(decoded).toContain('w:author="Author 1"');
    expect(decoded).not.toContain("Alice Example");
  });

  it("a UTF-8 part with a BOM keeps its BOM", async () => {
    const before = wordPackage({ "docProps/app.xml": `\ufeff${parts["docProps/app.xml"]!}` });
    const after = await checkRepair(before, "docx.scrub-properties");
    expect(Array.from(readZip(after).bytes("docProps/app.xml").subarray(0, 3))).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });
});

describe("odd but valid XML", () => {
  const parts = wordPackageParts();
  const withBody = (bodyXml: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`;
  const docWith = (bodyXml: string) => wordPackage({ "word/document.xml": withBody(bodyXml) });
  const documentAfter = async (bytes: Uint8Array, id: string) =>
    texts(await checkRepair(bytes, id)).get("word/document.xml") ?? "";

  it("a `>` inside an attribute value does not end the tag (accept, reject, clear)", async () => {
    const body =
      `<w:p><w:ins w:id="1" w:author="Ann > Bob" w:date="2024-01-01T00:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins>` +
      `<w:del w:id="2" w:author="x>y"><w:r><w:delText xml:space="preserve">old</w:delText></w:r></w:del></w:p>`;
    const accepted = await documentAfter(docWith(body), "docx.accept-tracked-changes");
    expect(accepted).toContain("<w:body><w:p><w:r><w:t>new</w:t></w:r></w:p></w:body>");
    const rejected = await documentAfter(docWith(body), "docx.reject-tracked-changes");
    expect(rejected).toContain(
      '<w:body><w:p><w:r><w:t xml:space="preserve">old</w:t></w:r></w:p></w:body>',
    );
    const core = parts["docProps/core.xml"]!.replace("<dc:title>", '<dc:title xml:lang="a>b">');
    const after = await checkRepair(
      wordPackage({ "docProps/core.xml": core }),
      "docx.clear-descriptive-properties",
    );
    expect(texts(after).get("docProps/core.xml")).toContain('<dc:title xml:lang="a>b"></dc:title>');
  });

  it("single-quoted attributes and entity-encoded names are replaced whole", async () => {
    const body = `<w:p><w:ins w:id='1' w:author='J&#xF6;rg &lt;j@x.example&gt;' w:date='2024-01-01T00:00:00Z'><w:r><w:t>a</w:t></w:r></w:ins></w:p>`;
    const doc = await documentAfter(docWith(body), "docx.anonymise-authors");
    expect(doc).toMatch(/w:author='Author \d'/);
    expect(doc).not.toMatch(/F6|j@x/);
  });

  it("another prefix for the WordprocessingML namespace", async () => {
    const ns = NS.replace('xmlns:w="', 'xmlns:x="');
    const xml =
      `<?xml version="1.0"?><x:document ${ns}><x:body><x:p><x:del x:id="1" x:author="Ann"><x:r><x:delText>old</x:delText></x:r></x:del>` +
      `<x:ins x:id="2" x:author="Ann"><x:r><x:t>new</x:t></x:r></x:ins></x:p></x:body></x:document>`;
    const bytes = wordPackage({ "word/document.xml": xml });
    const rejected = await documentAfter(bytes, "docx.reject-tracked-changes");
    expect(rejected).toContain("<x:p><x:r><x:t>old</x:t></x:r></x:p>");
    const anonymous = await documentAfter(bytes, "docx.anonymise-authors");
    expect(anonymous).not.toContain('"Ann"');
  });

  it("look-alike tags in comments and CDATA are text, not markup", async () => {
    const body =
      `<!-- <w:ins w:author="Ann"> --><w:p><w:r><w:t><![CDATA[<w:del w:author="Ann">x</w:del>]]></w:t></w:r>` +
      `<w:ins w:id="1" w:author="Bea"><w:r><w:t>y</w:t></w:r></w:ins></w:p>`;
    const accepted = await documentAfter(docWith(body), "docx.accept-tracked-changes");
    expect(accepted).toContain(
      `<!-- <w:ins w:author="Ann"> --><w:p><w:r><w:t><![CDATA[<w:del w:author="Ann">x</w:del>]]></w:t></w:r><w:r><w:t>y</w:t></w:r></w:p>`,
    );
  });

  it("a part with a DOCTYPE is left alone (its entities could hold anything)", async () => {
    const xml = withBody(
      `<w:p><w:ins w:id="1" w:author="&who;"><w:r><w:t>a</w:t></w:r></w:ins></w:p>`,
    ).replace(
      "\n<w:document",
      '\n<!DOCTYPE w:document [<!ENTITY who "Hidden Name">]>\n<w:document',
    );
    const bytes = wordPackage({ "word/document.xml": xml });
    for (const id of ["docx.anonymise-authors", "docx.accept-tracked-changes"]) {
      const { plan, after } = await applyRepair(bytes, id);
      expect(readZip(after).bytes("word/document.xml")).toEqual(
        readZip(bytes).bytes("word/document.xml"),
      );
      if (plan) expect(plan.skipped.join("\n")).toContain("word/document.xml");
    }
  });

  it("a text box's two copies (mc:Choice and mc:Fallback) change alike, or not at all", async () => {
    const box = (choice: string, fallback: string) =>
      `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${choice}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${fallback}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    const ins = `<w:p><w:ins w:id="1" w:author="Ann"><w:r><w:t>boxed</w:t></w:r></w:ins></w:p>`;
    const alike = await documentAfter(docWith(box(ins, ins)), "docx.accept-tracked-changes");
    expect(alike.match(/<w:p><w:r><w:t>boxed<\/w:t><\/w:r><\/w:p>/g)?.length).toBe(2);
    expect(alike).not.toContain("<w:ins");
    const unlike = docWith(
      box(ins, `<w:p><w:r><w:t>boxed</w:t></w:r></w:p>`) +
        `<w:p><w:ins w:id="2" w:author="Ann"><w:r><w:t>z</w:t></w:r></w:ins></w:p>`,
    );
    const { plan } = await applyRepair(unlike, "docx.accept-tracked-changes");
    expect(plan?.skipped.join("\n")).toMatch(/text box/);
    const doc = await documentAfter(unlike, "docx.accept-tracked-changes");
    expect(doc).toContain('<w:ins w:id="1" w:author="Ann">');
  });

  it("removed content that holds a footnote or comment reference is left alone, not orphaning the note", async () => {
    const parts = wordPackageParts();
    const body =
      `<w:p><w:r><w:t>Text</w:t></w:r><w:del w:id="90" w:author="Ann"><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:del>` +
      `<w:ins w:id="91" w:author="Ann"><w:commentRangeStart w:id="0"/><w:r><w:t>said</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:ins></w:p>` +
      `<w:p><w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r><w:commentRangeStart w:id="2"/><w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r></w:p>`;
    const bytes = wordPackage({
      "word/document.xml": withBody(body),
      "word/footnotes.xml": parts["word/footnotes.xml"]!,
    });
    for (const id of ["docx.accept-tracked-changes", "docx.reject-tracked-changes"]) {
      const doc = await documentAfter(bytes, id);
      expect(doc, id).toContain('<w:footnoteReference w:id="1"/>');
      expect(doc, id).toContain('<w:commentReference w:id="0"/>');
      const { plan } = await applyRepair(bytes, id);
      expect(plan?.skipped.join("\n"), id).toMatch(/footnote, endnote or comment/);
    }
  });

  it("a bookmark inside nested removed changes survives, so its other end is not left alone", async () => {
    const body = `<w:p><w:bookmarkStart w:id="5" w:name="b"/><w:del w:id="1" w:author="Ann"><w:ins w:id="2" w:author="Bea"><w:bookmarkEnd w:id="5"/><w:r><w:delText>x</w:delText></w:r></w:ins></w:del><w:r><w:t>y</w:t></w:r></w:p>`;
    const doc = await documentAfter(docWith(body), "docx.accept-tracked-changes");
    expect(doc).toContain('<w:bookmarkStart w:id="5" w:name="b"/><w:bookmarkEnd w:id="5"/>');
  });

  it("a numbering insertion marker: accepted by removing it, left alone on reject", async () => {
    const body = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/><w:ins w:id="1" w:author="Ann" w:date="2024-01-01T00:00:00Z"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>`;
    const accepted = await documentAfter(docWith(body), "docx.accept-tracked-changes");
    expect(accepted).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    const reject = await docxRepairPlan(docWith(body), "docx.reject-tracked-changes");
    expect(reject?.changes.map((c) => c.part)).not.toContain("word/document.xml");
    expect(reject?.skipped.join("\n")).toMatch(/word\/document\.xml: 1 numbering change/);
  });

  it("content controls: changes inside them are accepted, the control stays", async () => {
    const body = `<w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent><w:p><w:ins w:id="1" w:author="Ann"><w:r><w:t>in a control</w:t></w:r></w:ins></w:p></w:sdtContent></w:sdt>`;
    const doc = await documentAfter(docWith(body), "docx.accept-tracked-changes");
    expect(doc).toContain(
      "<w:sdtContent><w:p><w:r><w:t>in a control</w:t></w:r></w:p></w:sdtContent>",
    );
  });
});
