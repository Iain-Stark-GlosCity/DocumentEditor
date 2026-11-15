import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Finding } from "../../../core/findings";
import { docxProvider } from "../index";
import { handDocx, richSampleBytes, sourceFromParts, sourceFromZip } from "../test-helpers";
import { locatorOf, parseXml, type XElement } from "../xml";
import { MAX_LOCATIONS } from "./context";
import { cleanParts, largeParts, MUTATIONS, replaceOnce, toSource, type Parts } from "./fixtures";
import { inspectDocx, inspectDocxBytes, inspectWith, RULES, type Rule } from "./index";

const inspect = (parts: Parts) => inspectDocx(toSource(parts));
const serious = (findings: Finding[]) => findings.filter((f) => f.severity !== "info");
const summary = (findings: Finding[]) => findings.map((f) => `${f.severity} ${f.rule}: ${f.title}`);

/**
 * Finds the element a locator names by reading the part afresh, segment by segment, counting
 * siblings of the same written name: deliberately not using `locatorOf`.
 */
function resolve(text: string, locator: string): XElement | undefined {
  const doc = parseXml(text);
  const segments = locator.split("/").slice(1);
  let current: XElement | undefined;
  for (const [i, segment] of segments.entries()) {
    const m = /^(.+?)(?:\[(\d+)\])?$/.exec(segment);
    if (!m) return undefined;
    const name = m[1]!;
    const position = Number(m[2] ?? 1);
    if (i === 0) {
      if (doc.root?.rawName !== name || position !== 1) return undefined;
      current = doc.root;
      continue;
    }
    const same = current!.children.filter(
      (c): c is XElement => typeof c !== "string" && c.rawName === name,
    );
    if (m[2] === undefined && same.length !== 1) return undefined;
    current = same[position - 1];
    if (!current) return undefined;
  }
  return current;
}

function checkLocations(parts: Parts, findings: Finding[]) {
  for (const finding of findings)
    for (const location of finding.locations) {
      if (!location.locator) continue;
      const text = parts[location.part];
      expect(text, `${finding.rule}: part ${location.part}`).toBeDefined();
      const el = resolve(text!, location.locator);
      expect(el, `${finding.rule}: ${location.locator}`).toBeDefined();
      expect(locatorOf(el!)).toBe(location.locator);
      const last = location.locator
        .split("/")
        .pop()!
        .replace(/\[\d+\]$/, "");
      expect(el!.rawName).toBe(last);
    }
}

describe("the clean base package", () => {
  it("gives no errors or warnings", () => {
    const findings = inspect(cleanParts());
    expect(summary(serious(findings))).toEqual([]);
    // Only hygiene notes: the unused styles.
    expect(findings.map((f) => f.rule)).toEqual(["styles.unused-styles"]);
  });

  it("gives no errors or warnings for the rich sample made by the docx package", async () => {
    const findings = inspectDocx(sourceFromZip(await richSampleBytes()));
    expect(summary(serious(findings))).toEqual([]);
    // The sample uses the built-in IntenseQuote style without defining it: noted, not warned.
    const quote = findings.find((f) => f.rule === "styles.undefined-style");
    expect(quote?.severity).toBe("info");
    expect(quote?.facts?.styleId).toBe("IntenseQuote");
    expect(findings.some((f) => f.rule === "revisions.tracked-changes")).toBe(true);
    expect(findings.some((f) => f.rule === "revisions.tracking-on")).toBe(true);
  });

  it("gives no errors or warnings for a minimal document without styles or numbering", () => {
    const source = handDocx(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`, {
      sectPr: `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`,
    });
    const findings = inspectDocx(source);
    // handDocx writes an empty [Content_Types].xml, which is a real defect; nothing else.
    expect(serious(findings).map((f) => f.rule)).toEqual(["package.missing-content-type"]);
  });
});

describe("each mutation", () => {
  for (const mutation of MUTATIONS) {
    it(`finds ${mutation.rule} (${mutation.name})`, () => {
      const parts = mutation.apply(cleanParts());
      const findings = inspect(parts);
      const found = findings.filter(
        (f) => f.rule === mutation.rule && f.severity === mutation.severity,
      );
      expect(found.length, summary(findings).join("\n")).toBeGreaterThan(0);
      const finding = found[0]!;
      const first = finding.locations[0];
      expect(first?.part).toBe(mutation.part);
      if (mutation.element) {
        expect(first?.locator).toBeDefined();
        const el = resolve(parts[first!.part]!, first!.locator!);
        expect(el?.rawName).toBe(mutation.element);
      }
      expect(finding.locations.length).toBeLessThanOrEqual(MAX_LOCATIONS);
      checkLocations(parts, findings);
    });
  }

  it("covers every rule code the rules declare", () => {
    const declared = new Set(RULES.flatMap((r) => r.codes));
    const covered = new Set(MUTATIONS.map((m) => m.rule));
    // Reported only on files too large to parse, which a unit test should not build.
    covered.add("inspect.part-too-large");
    expect([...declared].filter((c) => !covered.has(c))).toEqual([]);
  });

  it("has a catalogue entry for every rule code, and no entry for a code that does not exist", () => {
    // Tests run from the repository root.
    const doc = readFileSync("docs/docx-integrity.md", "utf8");
    const documented = [...doc.matchAll(/^### `([a-z.-]+)`$/gm)].map((m) => m[1]!);
    const codes = new Set([
      ...RULES.flatMap((r) => r.codes),
      "package.unreadable",
      "inspect.rule-failed",
      "inspect.truncated",
    ]);
    expect([...codes].filter((c) => !documented.includes(c))).toEqual([]);
    expect(documented.filter((c) => !codes.has(c))).toEqual([]);
  });

  it("names no document text in titles, explanations or facts", () => {
    const texts = [
      "Secret",
      "Hidden words",
      "Small print",
      "Revenue grew",
      "Check this",
      "Forgotten",
      "Orphan.",
      "Unaudited",
      "Boxed",
      "Loud",
      "Shifted words",
    ];
    for (const mutation of MUTATIONS) {
      const findings = inspect(mutation.apply(cleanParts()));
      const said = JSON.stringify(findings.map((f) => [f.title, f.why, f.facts]));
      for (const text of texts) expect(said, mutation.name).not.toContain(text);
    }
  });
});

describe("findings", () => {
  it("have stable, unique ids", () => {
    for (const mutation of MUTATIONS) {
      const parts = mutation.apply(cleanParts());
      const a = inspect(parts).map((f) => f.id);
      const b = inspect(parts).map((f) => f.id);
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(a.length);
    }
  });

  it("aggregate repeats into one finding with a count", () => {
    let parts = cleanParts();
    const para = `<w:p><w:pPr><w:pStyle w:val="Mystery"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
    parts = replaceOnce(parts, "word/document.xml", "<w:body>", `<w:body>${para.repeat(42)}`);
    const found = inspect(parts).filter((f) => f.rule === "styles.undefined-style");
    expect(found).toHaveLength(1);
    expect(found[0]!.facts?.count).toBe(42);
    expect(found[0]!.locations).toHaveLength(MAX_LOCATIONS);
    expect(found[0]!.title).toMatch(/^42 paragraphs use the paragraph style Mystery/);
  });

  it("puts author names only in the title of the tracked changes finding", () => {
    const mutation = MUTATIONS.find((m) => m.rule === "revisions.tracked-changes")!;
    const finding = inspect(mutation.apply(cleanParts())).find((f) => f.rule === mutation.rule)!;
    expect(finding.title).toBe("2 tracked changes by A Reviewer, B Editor");
    expect(finding.facts).toMatchObject({ insertions: 1, deletions: 1, authors: 2 });
    expect(JSON.stringify(finding.facts)).not.toContain("Reviewer");
  });
});

describe("conservatism", () => {
  it("does not flag numId 0, hidden bookmarks, external links or AlternateContent copies", () => {
    const rules = inspect(cleanParts()).map((f) => f.rule);
    expect(rules).not.toContain("numbering.undefined-num");
    expect(rules).not.toContain("formatting.duplicate-bookmark-name");
    expect(rules).not.toContain("formatting.duplicate-bookmark-id");
    expect(rules).not.toContain("package.relationship-target-missing");
  });

  it("does not flag white text in a shaded paragraph or on a page with a background", () => {
    const white = `<w:p><w:pPr><w:shd w:val="clear" w:fill="000000"/></w:pPr><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>On black</w:t></w:r></w:p>`;
    let parts = replaceOnce(cleanParts(), "word/document.xml", "<w:body>", `<w:body>${white}`);
    expect(inspect(parts).map((f) => f.rule)).not.toContain("formatting.invisible-text");
    parts = replaceOnce(
      cleanParts(),
      "word/document.xml",
      "<w:body>",
      `<w:background w:color="000000"/><w:body><w:p><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>On black</w:t></w:r></w:p>`,
    );
    expect(inspect(parts).map((f) => f.rule)).not.toContain("formatting.invisible-text");
  });

  it("does not report a header used by several sections, or its relationship, twice", () => {
    const parts = MUTATIONS.find((m) => m.name === "header part deleted")!.apply(cleanParts());
    const findings = inspect(parts);
    const rules = serious(findings).map((f) => f.rule);
    // The leftover content type Override is a separate, real defect.
    expect(rules.sort()).toEqual([
      "package.override-part-missing",
      "sections.header-footer-missing",
    ]);
    const header = findings.find((f) => f.rule === "sections.header-footer-missing")!;
    expect(header.locations).toHaveLength(1);
  });
});

describe("robustness", () => {
  it("never throws on damaged parts or garbage", () => {
    const damaged: Parts[] = [
      replaceOnce(cleanParts(), "word/document.xml", "</w:body>", ""),
      { ...cleanParts(), "word/styles.xml": "\u0000\u0001 not xml <<<" },
      { ...cleanParts(), "word/numbering.xml": "" },
      { ...cleanParts(), "_rels/.rels": "<Relationships><Relationship Id=" },
      { ...cleanParts(), "word/_rels/document.xml.rels": "garbage" },
      { "[Content_Types].xml": "x" },
      {},
    ];
    for (const parts of damaged) expect(() => inspect(parts)).not.toThrow();
    const findings = inspect(damaged[0]!);
    expect(findings.some((f) => f.rule === "package.malformed-xml" && f.severity === "error")).toBe(
      true,
    );
  });

  it("survives a part source that throws", () => {
    const source = {
      names: () => ["word/document.xml"],
      text: () => {
        throw new Error("disk on fire");
      },
    };
    expect(() => inspectDocx(source)).not.toThrow();
    const broken = {
      names: () => {
        throw new Error("no");
      },
      text: () => undefined,
    };
    expect(() => inspectDocx(broken)).not.toThrow();
  });

  it("works without styles.xml and numbering.xml", () => {
    let parts = cleanParts();
    delete parts["word/styles.xml"];
    delete parts["word/numbering.xml"];
    parts = replaceOnce(
      parts,
      "word/_rels/document.xml.rels",
      /<Relationship Id="rId1"[^>]*\/>/.exec(parts["word/_rels/document.xml.rels"]!)![0],
      "",
    );
    parts = replaceOnce(
      parts,
      "word/_rels/document.xml.rels",
      /<Relationship Id="rId2"[^>]*\/>/.exec(parts["word/_rels/document.xml.rels"]!)![0],
      "",
    );
    const rules = serious(inspect(parts)).map((f) => f.rule);
    // The body still uses styles and lists, which now lead nowhere; nothing else is reported.
    expect([...new Set(rules)].sort()).toEqual([
      "numbering.undefined-num",
      "package.override-part-missing",
      "styles.styles-part-missing",
    ]);
  });

  it("handles deeply nested tables without running out of stack", () => {
    const depth = 3000;
    const nested =
      "<w:tbl><w:tr><w:tc>".repeat(depth) + "<w:p/>" + "</w:tc></w:tr></w:tbl>".repeat(depth);
    const parts = replaceOnce(cleanParts(), "word/document.xml", "<w:body>", `<w:body>${nested}`);
    expect(() => inspect(parts)).not.toThrow();
  });

  it("reports a rule that throws and still runs the others", () => {
    const boom: Rule = {
      name: "boom",
      codes: [],
      run(ctx) {
        ctx.report({
          rule: "x.half",
          severity: "error",
          family: "package",
          title: "t",
          why: "w",
          key: "k",
          hits: [],
        });
        throw new Error("bad rule");
      },
    };
    const findings = inspectWith(toSource(cleanParts()), [boom, ...RULES]);
    const failed = findings.find((f) => f.rule === "inspect.rule-failed");
    expect(failed?.severity).toBe("info");
    expect(failed?.facts?.check).toBe("boom");
    expect(findings.some((f) => f.rule === "x.half")).toBe(false);
    expect(findings.some((f) => f.rule === "styles.unused-styles")).toBe(true);
  });

  it("inspects 10,000 paragraphs quickly", () => {
    const parts = largeParts(10_000);
    const start = performance.now();
    const findings = inspect(parts);
    const ms = performance.now() - start;
    expect(serious(findings)).toEqual([]);
    // About a second and a half is the budget on a desktop; leave room for slow CI machines.
    expect(ms).toBeLessThan(4000);
  });
});

describe("inspecting bytes", () => {
  const zip = (parts: Parts) =>
    zipSync(
      Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, new TextEncoder().encode(v)])),
    );

  it("reads a zip the way the format does", async () => {
    const mutation = MUTATIONS.find((m) => m.rule === "notes.comment-missing")!;
    const parts = mutation.apply(cleanParts());
    const fromBytes = await inspectDocxBytes(zip(parts), { path: "a.docx" });
    expect(fromBytes).toEqual(inspectDocx(sourceFromParts(parts)));
  });

  it("is wired as the format's inspect, loaded on demand", async () => {
    const findings = await docxProvider.binary!.inspect!(zip(cleanParts()), { path: "a.docx" });
    expect(serious(findings)).toEqual([]);
  });

  it("reports garbage bytes as one error instead of throwing", async () => {
    const findings = await inspectDocxBytes(new Uint8Array([1, 2, 3, 4, 5]), { path: "x.docx" });
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([["package.unreadable", "error"]]);
  });
});
