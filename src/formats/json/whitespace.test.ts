import { describe, expect, it } from "vitest";
import { formatJson, minifyJson } from "./whitespace";

const strict = { comments: false };
const jsonc = { comments: true };
const fmt = (text: string, o = strict, indent = 2) => formatJson(text, indent, o);
const min = (text: string, o = strict) => minifyJson(text, o);

/** Every character that is not JSON whitespace outside strings, in order. */
function withoutWhitespace(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      out += ch;
      if (ch === "\\") out += text.charAt(++i);
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (!" \t\r\n".includes(ch)) {
      out += ch;
    }
  }
  return out;
}

const NASTY: string[] = [
  '{"big":12345678901234567890,"huge":1e400,"neg":-0.0,"exp":1E+2,"tiny":-1.5e-7}',
  '{"s":"\\u00e9\\u0000\\ud83d\\ude00 \\" \\\\ \\/ \\n","t":"{,}[,]:,"}',
  '{"a":[],"b":{},"c":[[],[[]],{}],"d":{"e":[{}]}}',
  '[{"k":"v,w"},{"k":"}"},{"k":"]"},"[",",",":"]',
  '{"z":1,"a":2,"m":{"y":true,"b":false,"n":null}}',
  '"just a string"',
  "42",
  "[]",
  "{}",
  '[1,2,3,"a b"]\n',
  '  \n\t{ "a" :\n 1 ,\n\n "b":[ 1 ,2 ] }  \n\n',
];

describe("formatJson", () => {
  it("indents objects and arrays and puts one space after a colon", () => {
    expect(fmt('{"a":1,"b":[1,2],"c":{"d":null}}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": {\n    "d": null\n  }\n}',
    );
  });

  it("uses the indent it is given", () => {
    expect(fmt('{"a":[1]}', strict, 4)).toBe('{\n    "a": [\n        1\n    ]\n}');
    expect(fmt('{"a":1}', strict, 1)).toBe('{\n "a": 1\n}');
  });

  it("writes empty containers as {} and []", () => {
    expect(fmt('{"a":[ ],"b":{\n},"c":[[],{}]}')).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [\n    [],\n    {}\n  ]\n}',
    );
  });

  it("keeps a final line break if there was one, and does not add one if not", () => {
    expect(fmt("[1]\n")).toBe("[\n  1\n]\n");
    expect(fmt("[1]")).toBe("[\n  1\n]");
    expect(fmt("[1]  \n  \n")).toBe("[\n  1\n]\n");
  });

  it("copies numbers, strings and key order exactly", () => {
    const text = '{"b":12345678901234567890,"a":1e400,"c":-0.0,"d":"\\u00e9\\n\\/","e":1E+2}';
    const out = fmt(text) ?? "";
    for (const piece of ["12345678901234567890", "1e400", "-0.0", '"\\u00e9\\n\\/"', "1E+2"]) {
      expect(out).toContain(piece);
    }
    expect(out.indexOf('"b"')).toBeLessThan(out.indexOf('"a"'));
  });

  it("keeps braces, commas and brackets inside strings", () => {
    expect(fmt('{"k":"{,}[,]:"}')).toBe('{\n  "k": "{,}[,]:"\n}');
  });

  it("returns null for text with a syntax error", () => {
    for (const bad of [
      "",
      "   ",
      "{",
      "[1,]",
      '{"a":1,}',
      '{"a" 1}',
      "{a:1}",
      "[1 2]",
      "01",
      "1.",
      "+1",
      "NaN",
      "'a'",
      '"a\nb"',
      '"\\x"',
      '"unterminated',
      "[1] 2",
      "// c\n[1]",
      "[1] // c",
    ]) {
      expect(fmt(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("changes nothing but whitespace, on nasty input", () => {
    for (const text of NASTY) {
      const out = fmt(text);
      expect(out, text).not.toBeNull();
      expect(withoutWhitespace(out ?? ""), text).toBe(withoutWhitespace(text));
    }
  });

  it("is idempotent", () => {
    for (const text of NASTY) {
      const once = fmt(text) ?? "";
      expect(fmt(once), text).toBe(once);
    }
  });

  it("leaves already-formatted input as it is", () => {
    const text = '{\n  "a": [\n    1,\n    {\n      "b": []\n    }\n  ]\n}\n';
    expect(fmt(text)).toBe(text);
  });
});

describe("minifyJson", () => {
  it("removes all whitespace between tokens and keeps it inside strings", () => {
    expect(min('{ "a b" : [ 1 , 2 ] ,\n "c" : " x  y " }\n')).toBe('{"a b":[1,2],"c":" x  y "}\n');
  });

  it("returns null for text with a syntax error", () => {
    expect(min("{")).toBeNull();
    expect(min('{"a":1,}')).toBeNull();
  });

  it("changes nothing but whitespace, on nasty input", () => {
    for (const text of NASTY) {
      const out = min(text);
      expect(withoutWhitespace(out ?? ""), text).toBe(withoutWhitespace(text));
      // The only whitespace left outside strings is the final line break.
      expect(withoutWhitespace(out ?? ""), text).toBe((out ?? "").replace(/\n$/, ""));
    }
  });

  it("is idempotent, and minify then format equals format", () => {
    for (const text of NASTY) {
      const once = min(text) ?? "";
      expect(min(once), text).toBe(once);
      expect(fmt(once), text).toBe(fmt(text));
    }
  });
});

describe("comments (JSON with comments)", () => {
  const SAMPLE = `// header
{
  /* the name */ "name": "x", // trailing
  "list": [ // opening
    1, /* one */
    2
    // own line before the end
  ],
  "n": /* inline */ 3,
  "empty": {}
  /* last */
}
// footer
`;

  it("refuses comments in strict JSON", () => {
    expect(fmt(SAMPLE, strict)).toBeNull();
    expect(min(SAMPLE, strict)).toBeNull();
  });

  it("keeps every comment, byte for byte, in order", () => {
    const out = fmt(SAMPLE, jsonc) ?? "";
    const comments = (t: string) => t.match(/\/\/[^\n]*|\/\*.*?\*\//g);
    expect(comments(out)).toEqual(comments(SAMPLE));
    expect(withoutWhitespace(out).replace(/\/\/[^\n]*/g, "")).toBe(
      withoutWhitespace(SAMPLE).replace(/\/\/[^\n]*/g, ""),
    );
  });

  it("keeps own-line comments on their own line and trailing ones on the line they trail", () => {
    const out = fmt(SAMPLE, jsonc) ?? "";
    expect(out).toContain('"name": "x", // trailing\n');
    expect(out).toContain('"list": [ // opening\n');
    expect(out).toContain("1, /* one */\n");
    expect(out).toContain("\n    // own line before the end\n  ]");
    expect(out.startsWith("// header\n{")).toBe(true);
    expect(out.endsWith("}\n// footer\n")).toBe(true);
  });

  it("does not comment out the code after a line comment", () => {
    const out = fmt("[1 // one\n, 2]", jsonc) ?? "";
    expect(JSON.parse(out.replace(/\/\/[^\n]*/g, ""))).toEqual([1, 2]);
  });

  it("is idempotent, and minify then format equals format", () => {
    const once = fmt(SAMPLE, jsonc) ?? "";
    expect(fmt(once, jsonc)).toBe(once);
    expect(fmt(min(SAMPLE, jsonc) ?? "", jsonc)).toBe(once);
    const minified = min(SAMPLE, jsonc) ?? "";
    expect(min(minified, jsonc)).toBe(minified);
  });

  it("rejects an unterminated block comment and a lone slash", () => {
    expect(fmt("[1] /* open", jsonc)).toBeNull();
    expect(fmt("[1 / 2]", jsonc)).toBeNull();
  });

  it("minifies with line comments keeping their line break", () => {
    expect(min('{ "a": 1, // one\n "b": 2 }', jsonc)).toBe('{"a":1,// one\n"b":2}');
  });
});

describe("generated documents", () => {
  // A small deterministic generator, so a failure can be reproduced.
  function generator(seed: number) {
    let s = seed;
    const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
    const ws = () => pick(["", " ", "\n", "\t ", "  \n  "]);
    const atoms = ["1", "-0.0", "1e400", "12345678901234567890", "true", "false", "null"];
    const strings = ['"a"', '""', '"{[,:]}"', '"\\u00e9"', '"q\\"q"', '"\\\\"', '"x y"'];
    const value = (depth: number): string => {
      const r = next();
      if (depth > 3 || r < 0.35) return pick(atoms);
      if (r < 0.5) return pick(strings);
      const n = Math.floor(next() * 4);
      const items = Array.from({ length: n }, () =>
        r < 0.75 ? value(depth + 1) : `${pick(strings)}${ws()}:${ws()}${value(depth + 1)}`,
      );
      const [open, close] = r < 0.75 ? ["[", "]"] : ["{", "}"];
      return `${open}${ws()}${items.join(`${ws()},${ws()}`)}${ws()}${close}`;
    };
    return () => `${ws()}${value(0)}${ws()}`;
  }

  it("keeps everything but whitespace, and formatting is idempotent", () => {
    const make = generator(7);
    for (let i = 0; i < 300; i++) {
      const text = make();
      const out = fmt(text);
      expect(out, text).not.toBeNull();
      expect(withoutWhitespace(out ?? ""), text).toBe(withoutWhitespace(text));
      expect(fmt(out ?? ""), text).toBe(out);
      expect(fmt(min(text) ?? ""), text).toBe(fmt(text));
    }
  });
});
