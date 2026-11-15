import { jsonLanguage } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  COMMENT_WARNING,
  jsoncDiagnostics,
  maskComments,
  strictDiagnostics,
  TRAILING_COMMA_WARNING,
} from "./lint";

const state = (text: string) => EditorState.create({ doc: text });

describe("JSON with comments, repeated error nodes", () => {
  it("reports one error for a value missing at the end of the text", () => {
    for (const text of ['{"a":', '{"é😀":', "[1,", '{"a": // c\n']) {
      const found = jsoncDiagnostics(text, jsonLanguage.parser);
      const spans = found.map((d) => `${d.from}:${d.to}`);
      expect(new Set(spans).size, text).toBe(spans.length);
      expect(found.length, text).toBeGreaterThan(0);
      for (const d of found) expect(d.to).toBeLessThanOrEqual(text.length);
    }
  });
});

describe("strict JSON diagnostics", () => {
  it("reports nothing for valid or empty documents", async () => {
    expect(await strictDiagnostics(state('{"a": [1, 2]}'))).toEqual([]);
    expect(await strictDiagnostics(state(""))).toEqual([]);
    expect(await strictDiagnostics(state("  \n"))).toEqual([]);
  });

  it("puts the error at the offending character", async () => {
    const text = '{\n  "a": 1,\n  "b": ,\n  "c": 3\n}';
    const found = await strictDiagnostics(state(text));
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(text.slice(found[0]?.from, found[0]?.to)).toBe(",");
  });

  it("keeps an error at the end of the text inside the document", async () => {
    const text = '{"a": 1';
    const found = await strictDiagnostics(state(text));
    expect(found).toHaveLength(1);
    expect(found[0]?.from).toBeGreaterThanOrEqual(0);
    expect(found[0]?.to).toBeLessThanOrEqual(text.length);
    expect(found[0]?.to).toBeGreaterThan(found[0]?.from ?? 0);
  });

  it("reports comments as warnings, one each, at the comment", async () => {
    const text = '// c\n{"a": 1 /* d */}';
    const found = await strictDiagnostics(state(text));
    expect(found.map((d) => [d.severity, text.slice(d.from, d.to)])).toEqual([
      ["warning", "// c"],
      ["warning", "/* d */"],
    ]);
    expect(found[0]?.message).toBe(COMMENT_WARNING);
    expect(COMMENT_WARNING).toMatch(/Use \.jsonc to silence this\.$/);
  });

  it("reports trailing commas before } and ] as warnings, even with a comment between", async () => {
    const text = '{"a": [1, 2,], "b": 3, // last\n}';
    const found = await strictDiagnostics(state(text));
    expect(found.map((d) => [d.severity, text.slice(d.from, d.to)])).toEqual([
      ["warning", ","],
      ["warning", ","],
      ["warning", "// last"],
    ]);
    expect(found[0]?.message).toBe(TRAILING_COMMA_WARNING);
  });

  it("does not mistake text inside strings for comments or commas", async () => {
    expect(await strictDiagnostics(state('{"u": "http://x", "c": ",}"}'))).toEqual([]);
  });

  it("keeps every error as an error when anything other than comments and commas is wrong", async () => {
    for (const text of [
      '// c\n{"a": ,}',
      '{"a": 1,, }',
      '{"a": 1 /* open',
      "[1,] x",
      '{"a": 1,} // ok\n{',
    ]) {
      const found = await strictDiagnostics(state(text));
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((d) => d.severity === "error")).toBe(true);
    }
  });
});

describe("JSON with comments diagnostics", () => {
  const check = (text: string) => jsoncDiagnostics(text, jsonLanguage.parser);

  it("accepts both kinds of comment", () => {
    expect(check('// a\n{\n  /* b */ "a": 1, // c\n  "b": [1, /* d */ 2]\n}\n')).toEqual([]);
  });

  it("reports real syntax errors, inside the document and at least one character wide", () => {
    const text = '{\n  "a": 1 // fine\n  "b": 2\n}';
    const found = check(text);
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) {
      expect(d.severity).toBe("error");
      expect(d.from).toBeGreaterThanOrEqual(0);
      expect(d.to).toBeLessThanOrEqual(text.length);
      expect(d.to).toBeGreaterThan(d.from);
    }
    // The problem is on the second member's line, not at the comment.
    expect(found[0]?.from).toBeGreaterThan(text.indexOf("// fine") + "// fine".length);
  });

  it("reports an unclosed object at the end of the text", () => {
    const text = '{"a": 1,';
    const found = check(text);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((d) => d.to <= text.length && d.to > d.from)).toBe(true);
  });

  it("reports nothing for an empty document", () => {
    expect(check("")).toEqual([]);
  });

  it("does not take // or /* inside a string for a comment", () => {
    expect(check('{"url": "http://example.com/*x*/", "b": 1}')).toEqual([]);
  });

  it("reports an unterminated block comment where it starts", () => {
    const text = '{"a": 1} /* never closed';
    const found = check(text);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe("Unterminated comment");
    expect(found[0]?.from).toBe(text.indexOf("/*"));
  });

  it("keeps offsets: masking comments never moves the text", () => {
    const text = '{ /* a */ "a": 1, // b\n "c": }';
    const { masked } = maskComments(text);
    expect(masked).toHaveLength(text.length);
    expect(masked.indexOf('"c"')).toBe(text.indexOf('"c"'));
    expect(masked.replace(/ /g, "")).toBe('{"a":1,\n"c":}');
    const found = check(text);
    expect(text.slice(found[0]?.from, found[0]?.to)).toBe("}");
  });
});
