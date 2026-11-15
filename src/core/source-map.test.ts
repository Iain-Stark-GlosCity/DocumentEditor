import { describe, expect, it } from "vitest";
import { sourceFor, type SourceMapEntry } from "./source-map";

const entry = (fromLine: number, toLine: number, locator: string): SourceMapEntry => ({
  fromLine,
  toLine,
  part: "word/document.xml",
  locator,
});

describe("sourceFor", () => {
  const map = [
    entry(5, 20, "/w:document/w:body/w:tbl[1]"),
    entry(8, 9, "/w:document/w:body/w:tbl[1]/w:tr[1]/w:tc[1]/w:p[1]"),
    entry(30, 30, "/w:document/w:body/w:p[4]"),
  ];

  it("finds the entry covering a line", () => {
    expect(sourceFor(map, 30)?.locator).toBe("/w:document/w:body/w:p[4]");
  });

  it("prefers the narrowest entry when they nest", () => {
    expect(sourceFor(map, 8)?.locator).toContain("w:p[1]");
    expect(sourceFor(map, 12)?.locator).toBe("/w:document/w:body/w:tbl[1]");
  });

  it("finds nothing outside every entry, or without a map", () => {
    expect(sourceFor(map, 25)).toBeUndefined();
    expect(sourceFor(undefined, 1)).toBeUndefined();
    expect(sourceFor([], 1)).toBeUndefined();
  });
});
