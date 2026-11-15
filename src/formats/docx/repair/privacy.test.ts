import { describe, expect, it } from "vitest";
import type { PartEdit } from "../../../core/repair";
import { inspectDocx } from "../inspect";
import type { PartSource } from "../package";
import { handDocx, richSampleBytes, sourceFromZip } from "../test-helpers";
import { parseXml } from "../xml";
import { offersFor, planFor } from "./index";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

/** The package with a plan's changes applied. */
function applied(src: PartSource, changes: PartEdit[]): PartSource {
  const replaced = new Map(changes.map((c) => [c.part, c.text]));
  return {
    names: () => src.names(),
    text: (n) => replaced.get(n) ?? src.text(n),
  };
}

function textOfPart(src: PartSource, part: string): string {
  return src.text(part) ?? "";
}

function errorIds(src: PartSource): string[] {
  return inspectDocx(src)
    .filter((f) => f.severity === "error")
    .map((f) => f.rule)
    .sort();
}

function changeOf(changes: PartEdit[], part: string): string {
  const c = changes.find((x) => x.part === part);
  if (!c) throw new Error(`no change for ${part}`);
  return c.text;
}

/* ---------- anonymise authors ---------- */

const BODY =
  `<w:p><w:ins w:id="1" w:author="Jane Smith" w:date="2024-01-01T00:00:00Z"><w:r><w:t>a</w:t></w:r></w:ins>` +
  `<w:del w:id="2" w:author='Bob Jones' w:date="2024-01-01T00:00:00Z"><w:r><w:delText>b</w:delText></w:r></w:del>` +
  `<w:moveFrom w:id="3" w:author="Jane Smith"><w:r><w:t>c</w:t></w:r></w:moveFrom>` +
  `<w:pPr><w:pPrChange w:id="4" w:author="O&apos;Neil &amp; Co" w:date="x"><w:pPr/></w:pPrChange></w:pPr></w:p>`;
const COMMENTS =
  `<?xml version="1.0"?>\r\n<w:comments ${W}>` +
  `<w:comment w:id="0" w:author='Bob Jones' w:date="d" w:initials="BJ"><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:comment>` +
  `<w:comment w:id="1" w:author="Carol White" w:initials="CW"><w:p/></w:comment></w:comments>`;
const PEOPLE =
  `<?xml version="1.0"?>\n<w15:people ${W}>` +
  `<w15:person w15:author="Carol White"><w15:presenceInfo w15:providerId="AD" w15:userId="S::carol@example.org::1234"/></w15:person>` +
  `<w15:person w15:author='Jane Smith'><w15:presenceInfo w15:providerId="None" w15:userId="Jane Smith"/></w15:person>` +
  `</w15:people>`;

const authorsPkg = () =>
  handDocx(BODY, {
    rels: { rIdC: ["comments", "comments.xml"] },
    extra: { "word/comments.xml": COMMENTS, "word/people.xml": PEOPLE },
  });

const NAMES = /Jane|Smith|Bob|Jones|Carol|White|Neil|example\.org|1234/;

describe("docx.anonymise-authors", () => {
  it("is not offered for a clean package", () => {
    expect(offersFor(handDocx("<w:p/>")).map((o) => o.id)).not.toContain("docx.anonymise-authors");
    expect(planFor(handDocx("<w:p/>"), "docx.anonymise-authors")).toBeNull();
  });

  it("gives the same pseudonym to the same name across parts and quote styles, in part order", () => {
    const plan = planFor(authorsPkg(), "docx.anonymise-authors")!;
    const doc = changeOf(plan.changes, "word/document.xml");
    // Fixed part order: document first (Jane = 1, Bob = 2, O'Neil = 3), then comments (Carol = 4).
    const expectedDoc = textOfPart(authorsPkg(), "word/document.xml")
      .replace('w:author="Jane Smith" w:date', 'w:author="Author 1" w:date')
      .replace("w:author='Bob Jones'", "w:author='Author 2'")
      .replace(
        'w:moveFrom w:id="3" w:author="Jane Smith"',
        'w:moveFrom w:id="3" w:author="Author 1"',
      )
      .replace('w:author="O&apos;Neil &amp; Co"', 'w:author="Author 3"');
    expect(doc).toBe(expectedDoc);
    const comments = changeOf(plan.changes, "word/comments.xml");
    expect(comments).toBe(
      COMMENTS.replace(
        'w:author=\'Bob Jones\' w:date="d" w:initials="BJ"',
        'w:author=\'Author 2\' w:date="d" w:initials="A2"',
      ).replace('w:author="Carol White" w:initials="CW"', 'w:author="Author 4" w:initials="A4"'),
    );
    const people = changeOf(plan.changes, "word/people.xml");
    expect(people).toBe(
      PEOPLE.replace(
        'w15:author="Carol White"><w15:presenceInfo w15:providerId="AD" w15:userId="S::carol@example.org::1234"',
        'w15:author="Author 4"><w15:presenceInfo w15:providerId="None" w15:userId="Author 4"',
      ).replace(
        'w15:author=\'Jane Smith\'><w15:presenceInfo w15:providerId="None" w15:userId="Jane Smith"',
        'w15:author=\'Author 1\'><w15:presenceInfo w15:providerId="None" w15:userId="Author 1"',
      ),
    );
    expect(comments).toContain("\r\n");
    for (const c of plan.changes) expect(parseXml(c.text).problems).toEqual([]);
  });

  it("keeps summary and details free of names, and is idempotent", () => {
    const src = authorsPkg();
    const offer = offersFor(src).find((o) => o.id === "docx.anonymise-authors")!;
    expect(offer.summary).toMatch(/^\d+ author values for 4 people$/);
    const plan = planFor(src, "docx.anonymise-authors")!;
    expect(JSON.stringify([offer, plan.details, plan.skipped])).not.toMatch(NAMES);
    const after = applied(src, plan.changes);
    expect(offersFor(after).map((o) => o.id)).not.toContain("docx.anonymise-authors");
    expect(planFor(after, "docx.anonymise-authors")).toBeNull();
  });

  it("leaves a comment's initials alone when it has no author, and says so", () => {
    const src = handDocx("<w:p/>", {
      rels: { rIdC: ["comments", "comments.xml"] },
      extra: {
        "word/comments.xml": `<w:comments ${W}><w:comment w:id="0" w:author="Ann" w:initials="A"/><w:comment w:id="1" w:initials="ZZ"/></w:comments>`,
      },
    });
    const plan = planFor(src, "docx.anonymise-authors")!;
    expect(changeOf(plan.changes, "word/comments.xml")).toBe(
      `<w:comments ${W}><w:comment w:id="0" w:author="Author 1" w:initials="A1"/><w:comment w:id="1" w:initials="ZZ"/></w:comments>`,
    );
    expect(plan.skipped.join(" ")).toMatch(/1 comment has initials but no author/);
  });

  it("works with another prefix for the main namespace", () => {
    const body = `<x:p xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:ins x:author="Zed Q" x:id="1"/></x:p>`;
    const src = handDocx(body);
    const plan = planFor(src, "docx.anonymise-authors")!;
    expect(changeOf(plan.changes, "word/document.xml")).toContain('x:author="Author 1"');
    expect(changeOf(plan.changes, "word/document.xml")).not.toContain("Zed");
  });

  it("leaves a damaged part alone and lists it", () => {
    const src = handDocx(BODY, {
      rels: { rIdC: ["comments", "comments.xml"] },
      extra: { "word/comments.xml": `<w:comments ${W}><w:comment w:author="Bob"></w:comments>` },
    });
    const plan = planFor(src, "docx.anonymise-authors")!;
    expect(plan.changes.map((c) => c.part)).toEqual(["word/document.xml"]);
    expect(plan.skipped.join(" ")).toContain("word/comments.xml");
  });

  it("does not throw on odd input", () => {
    const src = handDocx(`<w:p><w:ins w:author="" w:id="1"/><w:ins w:author="  "/></w:p>`);
    expect(() => offersFor(src)).not.toThrow();
  });
});

/* ---------- remove rsids ---------- */

const RSID_BODY =
  `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3" w15:paraId="1"><w:r w:rsidRPr="00112233"><w:t>x</w:t></w:r></w:p>` +
  `<w:p w:rsidP='00AABBCC'><w:r><w:t>y</w:t></w:r></w:p>` +
  `<w:p w:rsidR="00000001"/><w:tbl><w:tr w:rsidTr="00000002" w:rsidDel="00000003"/></w:tbl>`;
const RSID_SECT = `<w:sectPr w:rsidSect="00000004"><w:pgSz w:w="1"/></w:sectPr>`;
const SETTINGS = `<?xml version="1.0"?>\n<w:settings ${W}><w:zoom w:percent="100"/><w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/></w:rsids><w:compat/></w:settings>`;
const STYLES = `<w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:rsid w:val="00A1B2C3"/><w:pPr/></w:style>`;

const rsidPkg = () =>
  handDocx(RSID_BODY, {
    sectPr: RSID_SECT,
    styles: STYLES,
    extra: { "word/settings.xml": SETTINGS },
  });

describe("docx.remove-rsids", () => {
  it("is not offered when there are none", () => {
    expect(planFor(handDocx("<w:p/>"), "docx.remove-rsids")).toBeNull();
  });

  it("removes attributes with their space, whatever the quotes, and keeps tags valid", () => {
    const src = rsidPkg();
    const plan = planFor(src, "docx.remove-rsids")!;
    const doc = changeOf(plan.changes, "word/document.xml");
    expect(doc).toBe(
      textOfPart(src, "word/document.xml")
        .replace(' w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3"', "")
        .replace(' w:rsidRPr="00112233"', "")
        .replace(" w:rsidP='00AABBCC'", "")
        .replace(' w:rsidR="00000001"', "")
        .replace(' w:rsidTr="00000002" w:rsidDel="00000003"', "")
        .replace(' w:rsidSect="00000004"', ""),
    );
    expect(doc).toContain('<w:p w15:paraId="1">');
    expect(doc).toContain("<w:p><w:r><w:t>y</w:t>");
    expect(doc).toContain("<w:p/>");
    expect(changeOf(plan.changes, "word/settings.xml")).toBe(
      SETTINGS.replace(/<w:rsids>.*<\/w:rsids>/, ""),
    );
    expect(changeOf(plan.changes, "word/styles.xml")).toBe(
      textOfPart(src, "word/styles.xml").replace('<w:rsid w:val="00A1B2C3"/>', ""),
    );
    for (const c of plan.changes) expect(parseXml(c.text).problems).toEqual([]);
  });

  it("has counts-only text, is idempotent and adds no inspector errors", () => {
    const src = rsidPkg();
    const offer = offersFor(src).find((o) => o.id === "docx.remove-rsids")!;
    expect(offer.summary).toBe("10 editing-session ids in 3 parts");
    const plan = planFor(src, "docx.remove-rsids")!;
    expect(JSON.stringify(plan.details)).not.toMatch(/00A1B2C3|00AABBCC/);
    const after = applied(src, plan.changes);
    expect(planFor(after, "docx.remove-rsids")).toBeNull();
    expect(errorIds(after).filter((id) => !errorIds(src).includes(id))).toEqual([]);
  });

  it("leaves a damaged part alone", () => {
    const src = handDocx(RSID_BODY, { extra: { "word/settings.xml": "<w:settings><w:rsids>" } });
    const plan = planFor(src, "docx.remove-rsids")!;
    expect(plan.changes.map((c) => c.part)).toEqual(["word/document.xml"]);
    expect(plan.skipped.join(" ")).toContain("word/settings.xml");
  });
});

/* ---------- custom properties ---------- */

const CUSTOM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Secret"><vt:lpwstr>classified</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Other"><vt:i4>3</vt:i4></property></Properties>`;
const APP = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>C:\\Users\\jane\\Normal.dotm</Template><HyperlinkBase>https://intranet.example</HyperlinkBase><Pages>3</Pages></Properties>`;

describe("docx.remove-custom-properties", () => {
  const src = () =>
    handDocx("<w:p/>", { extra: { "docProps/custom.xml": CUSTOM, "docProps/app.xml": APP } });

  it("removes the properties and empties the path fields, nothing else", () => {
    const plan = planFor(src(), "docx.remove-custom-properties")!;
    const custom = changeOf(plan.changes, "docProps/custom.xml");
    expect(custom).toBe(CUSTOM.replace(/<property[\s\S]*<\/property>/, ""));
    expect(parseXml(custom).problems).toEqual([]);
    expect(changeOf(plan.changes, "docProps/app.xml")).toBe(
      APP.replace("C:\\Users\\jane\\Normal.dotm", "").replace("https://intranet.example", ""),
    );
    expect(custom).toContain("\r\n");
  });

  it("keeps summary and details free of values, and is idempotent", () => {
    const s = src();
    const offer = offersFor(s).find((o) => o.id === "docx.remove-custom-properties")!;
    expect(offer.summary).toBe("2 custom properties and 2 template or address fields");
    const plan = planFor(s, "docx.remove-custom-properties")!;
    expect(JSON.stringify([offer, plan.details, plan.skipped])).not.toMatch(
      /Secret|classified|jane|intranet/,
    );
    const after = applied(s, plan.changes);
    expect(planFor(after, "docx.remove-custom-properties")).toBeNull();
    expect(errorIds(after).filter((id) => !errorIds(s).includes(id))).toEqual([]);
  });

  it("is not offered for an empty properties list, and skips a damaged part", () => {
    const empty = handDocx("<w:p/>", {
      extra: {
        "docProps/custom.xml": `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>`,
      },
    });
    expect(planFor(empty, "docx.remove-custom-properties")).toBeNull();
    const broken = handDocx("<w:p/>", {
      extra: { "docProps/custom.xml": "<Properties><property>", "docProps/app.xml": APP },
    });
    const plan = planFor(broken, "docx.remove-custom-properties")!;
    expect(plan.skipped.join(" ")).toContain("docProps/custom.xml");
    expect(plan.changes.map((c) => c.part)).toEqual(["docProps/app.xml"]);
  });
});

/* ---------- descriptive properties ---------- */

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Budget plan</dc:title><dc:subject>Finance</dc:subject><dc:creator>Jane</dc:creator><cp:keywords>a, b</cp:keywords><dc:description>Notes &amp; more</dc:description><cp:category/><cp:contentStatus>Draft</cp:contentStatus></cp:coreProperties>`;

describe("docx.clear-descriptive-properties", () => {
  const src = (extra: Record<string, string> = {}) =>
    handDocx("<w:p/>", { extra: { "docProps/core.xml": CORE, ...extra } });

  it("empties only the descriptive fields and explains the file-list title", () => {
    const plan = planFor(src(), "docx.clear-descriptive-properties")!;
    const core = changeOf(plan.changes, "docProps/core.xml");
    expect(core).toBe(
      CORE.replace("Budget plan", "")
        .replace("Finance", "")
        .replace("a, b", "")
        .replace("Notes &amp; more", "")
        .replace("Draft", ""),
    );
    expect(core).toContain("<dc:creator>Jane</dc:creator>");
    expect(parseXml(core).problems).toEqual([]);
    expect(plan.details.join(" ")).toContain("title shown for the file in file lists");
    expect(plan.skipped).toEqual([]);
    const offer = offersFor(src()).find((o) => o.id === "docx.clear-descriptive-properties")!;
    expect(offer.summary).toBe("5 descriptive fields with text");
    expect(JSON.stringify([offer, plan.details, plan.skipped])).not.toMatch(/Budget|Finance|Notes/);
  });

  it("is idempotent", () => {
    const s = src();
    const after = applied(s, planFor(s, "docx.clear-descriptive-properties")!.changes);
    expect(planFor(after, "docx.clear-descriptive-properties")).toBeNull();
  });

  it("lists a thumbnail it cannot remove", () => {
    const plan = planFor(
      src({ "docProps/thumbnail.jpeg": "binary" }),
      "docx.clear-descriptive-properties",
    )!;
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toContain("docProps/thumbnail.jpeg");
  });

  it("skips a damaged core part", () => {
    const s = handDocx("<w:p/>", {
      extra: { "docProps/core.xml": "<cp:coreProperties><dc:title>x" },
    });
    expect(planFor(s, "docx.clear-descriptive-properties")).toBeNull();
  });
});

/* ---------- the rich sample ---------- */

describe("the privacy repairs on the rich sample", () => {
  it("apply cleanly, stay well-formed and add no inspector errors", async () => {
    const src = sourceFromZip(await richSampleBytes());
    const before = errorIds(src);
    const offers = offersFor(src);
    const ids = offers.map((o) => o.id);
    expect(ids).toContain("docx.clear-descriptive-properties");
    for (const id of [
      "docx.anonymise-authors",
      "docx.remove-rsids",
      "docx.remove-custom-properties",
      "docx.clear-descriptive-properties",
    ]) {
      const plan = planFor(src, id);
      if (!ids.includes(id)) {
        expect(plan).toBeNull();
        continue;
      }
      expect(plan, id).not.toBeNull();
      for (const c of plan!.changes) expect(parseXml(c.text).problems, id).toEqual([]);
      const after = applied(src, plan!.changes);
      expect(planFor(after, id), id).toBeNull();
      expect(
        errorIds(after).filter((e) => !before.includes(e)),
        id,
      ).toEqual([]);
      expect(JSON.stringify([plan!.details, plan!.skipped])).not.toMatch(
        /Jane Smith|Quarterly report/,
      );
    }
  });
});
