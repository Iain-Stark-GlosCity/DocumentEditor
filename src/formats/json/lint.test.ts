import { jsonLanguage } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { jsoncDiagnostics, maskComments, strictDiagnostics } from "./lint";

const state = (text: string) => EditorState.create({ doc: text });

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

  it("rejects comments, which JSON does not have", async () => {
    expect(await strictDiagnostics(state('// c\n{"a": 1}'))).toHaveLength(1);
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
