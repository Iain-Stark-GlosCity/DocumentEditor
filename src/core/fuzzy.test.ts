import { describe, expect, it } from "vitest";
import pkg from "../../package.json?raw";
import { APP_VERSION } from "./app-info";
import { filterByQuery, matchScore } from "./fuzzy";

describe("matchScore", () => {
  it("matches every word in any order, ignoring case", () => {
    expect(matchScore("SAVE as", "Save as…")).not.toBeNull();
    expect(matchScore("as save", "Save as…")).not.toBeNull();
    expect(matchScore("zzz", "Save as…")).toBeNull();
  });

  it("accepts an empty query", () => {
    expect(matchScore("  ", "Anything")).toBe(0);
  });

  it("prefers earlier and word-start matches", () => {
    const a = matchScore("tab", "Close tab") as number;
    const b = matchScore("tab", "Next tab") as number;
    const c = matchScore("ab", "Close tab") as number;
    expect(b).toBeLessThan(a);
    expect(a).toBeLessThan(c);
  });
});

describe("filterByQuery", () => {
  it("keeps input order for equal scores and drops non-matches", () => {
    const items = ["Zoom in", "Zoom out", "Save"];
    expect(filterByQuery("zoom", items, (s) => s)).toEqual(["Zoom in", "Zoom out"]);
    expect(filterByQuery("", items, (s) => s)).toEqual(items);
  });
});

describe("app info", () => {
  it("matches the version in package.json", () => {
    expect(APP_VERSION).toBe((JSON.parse(pkg) as { version: string }).version);
  });
});
