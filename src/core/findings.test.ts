import { describe, expect, it } from "vitest";
import { countBySeverity, formatFindingsReport, sortFindings, type Finding } from "./findings";

const f = (over: Partial<Finding>): Finding => ({
  id: "x",
  rule: "styles.undefined",
  severity: "warning",
  family: "styles",
  title: 'Style "Client Secret Heading" is not defined',
  why: "Word falls back to Normal for Ms Smith's paragraph.",
  locations: [{ part: "word/document.xml", locator: "/w:document/w:body/w:p[3]" }],
  facts: { count: 2, name: "Client Secret Heading", defined: false },
  ...over,
});

describe("findings", () => {
  it("sorts errors before warnings before notes, then by family, rule and id", () => {
    const sorted = sortFindings([
      f({ id: "c", severity: "info", rule: "a.x" }),
      f({ id: "b", severity: "error", family: "package", rule: "package.z" }),
      f({ id: "a", severity: "error", family: "numbering", rule: "numbering.y" }),
      f({ id: "d", severity: "warning" }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("counts by severity", () => {
    expect(
      countBySeverity([f({ severity: "error" }), f({}), f({}), f({ severity: "info" })]),
    ).toEqual({
      error: 1,
      warning: 2,
      info: 1,
    });
  });

  it("writes a report with rule codes, locations and numeric facts only", () => {
    const report = formatFindingsReport([f({})]);
    expect(report).toContain("WARNING styles.undefined");
    expect(report).toContain("at word/document.xml /w:document/w:body/w:p[3]");
    expect(report).toContain("count=2");
    expect(report).toContain("defined=false");
    expect(report).toContain("0 errors, 1 warnings, 0 notes");
  });

  it("never leaks titles, explanations or string facts into the report", () => {
    const report = formatFindingsReport([f({})]);
    expect(report).not.toContain("Client Secret Heading");
    expect(report).not.toContain("Ms Smith");
    expect(report).not.toContain("name=");
  });
});
