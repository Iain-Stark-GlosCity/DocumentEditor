import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";
import { yamlDiagnostics } from "./lint";

const check = (text: string) => yamlDiagnostics(text, parseAllDocuments);

describe("YAML diagnostics", () => {
  it("accepts ordinary documents, several documents and comments", () => {
    expect(check("a: 1\nb:\n  - x\n  - y # note\n")).toEqual([]);
    expect(check("a: 1\n---\nb: 2\n")).toEqual([]);
    expect(check("# only a comment\n")).toEqual([]);
    expect(check("")).toEqual([]);
  });

  it("reports a duplicate key at the key", () => {
    const text = "name: a\nsize: 1\nname: b\n";
    const found = check(text);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toMatch(/unique/i);
    expect(found[0]?.from).toBe(text.lastIndexOf("name"));
    // The whole key is underlined, not one character of it.
    expect(text.slice(found[0]?.from, found[0]?.to)).toBe("name");
  });

  it("reports bad indentation and unclosed flow collections with usable positions", () => {
    for (const text of ["a:\n  b: 1\n c: 2\n", "a: [1, 2\n", "a: {b: 1\n", "key: 'open\n"]) {
      const found = check(text);
      expect(found.length, text).toBeGreaterThan(0);
      for (const d of found) {
        expect(d.from, text).toBeGreaterThanOrEqual(0);
        expect(d.to, text).toBeLessThanOrEqual(text.length);
        expect(d.to, text).toBeGreaterThan(d.from);
        expect(d.message).not.toMatch(/at line \d+/);
      }
    }
  });

  it("reports a tab used for indentation", () => {
    expect(check("a:\n\tb: 1\n").some((d) => d.severity === "error")).toBe(true);
  });

  it("finds a problem in a later document and sorts by position", () => {
    const text = "a: 1\n---\nb: 1\nb: 2\n---\nc: [\n";
    const found = check(text);
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.map((d) => d.from)).toEqual([...found.map((d) => d.from)].sort((x, y) => x - y));
    expect(found[0]?.from).toBeGreaterThan(text.indexOf("---"));
  });
});
