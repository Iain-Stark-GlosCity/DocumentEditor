import { describe, expect, it } from "vitest";
import { expansionTooLarge, isWellFormed, offsetOf, parseErrors, xmlDiagnostics } from "./lint";

/** What Chromium puts in the parsererror element, as `browserParse` reads it. */
const chromium = (line: number, column: number, message: string) =>
  `This page contains the following errors:\nerror on line ${line} at column ${column}: ${message}\nBelow is a rendering of the page up to the first error.`;

const only = (text: string, raw: string) => {
  const found = xmlDiagnostics(text, () => raw);
  expect(found).toHaveLength(1);
  return found[0] as NonNullable<(typeof found)[number]>;
};

describe("parseErrors", () => {
  it("reads Chromium's message and drops the noise around it", () => {
    expect(parseErrors(chromium(3, 4, "Unexpected closing tag: a != b"))).toEqual([
      { line: 3, column: 4, message: "Unexpected closing tag: a != b" },
    ]);
  });

  it("reads the same message when the lines were run together", () => {
    const one = "error on line 2 at column 9: Attribute 'x' is redefined";
    expect(parseErrors(one)[0]).toMatchObject({ line: 2, column: 9 });
  });

  it("reads Firefox's wording", () => {
    const raw =
      "XML Parsing Error: mismatched tag. Expected: </a>.\nLocation: file:///x.xml\nLine Number 3, Column 5:<sourcetext>x</sourcetext>";
    expect(parseErrors(raw)).toEqual([
      { line: 3, column: 5, message: "Mismatched tag. Expected: </a>" },
    ]);
  });

  it("falls back on a position-less error for anything else", () => {
    expect(parseErrors("Something odd happened.")).toEqual([
      { line: null, column: null, message: "Something odd happened" },
    ]);
    expect(parseErrors("")[0]).toMatchObject({ line: null, message: expect.any(String) });
  });

  it("rewrites the alarming messages", () => {
    expect(parseErrors(chromium(1, 5, "Entity too big"))[0]?.message).toMatch(
      /expands to too much/,
    );
    expect(parseErrors(chromium(1, 5, "Excessive node nesting."))[0]?.message).toBe(
      "Elements are nested too deeply",
    );
  });
});

describe("offsetOf", () => {
  it("maps 1-based line and column to an offset", () => {
    const text = "<a>\n  <b>\n</a>";
    expect(offsetOf(text, 1, 1)).toBe(0);
    expect(offsetOf(text, 2, 3)).toBe(4 + 2);
    expect(offsetOf(text, 3, 4)).toBe(text.length - 1);
  });

  it("counts columns in code points, so astral characters take two units", () => {
    const text = "<a>é😀</a><b/>"; // Chromium says column 10 for the second root element
    expect(text.slice(offsetOf(text, 1, 10))).toBe("<b/>");
  });

  it("stays on the line and inside the text", () => {
    expect(offsetOf("ab\ncd", 1, 99)).toBe(2);
    expect(offsetOf("ab\ncd", 9, 1)).toBe(5);
  });
});

describe("xmlDiagnostics", () => {
  it("is empty for well-formed and for blank text", () => {
    expect(xmlDiagnostics("<a/>")).toEqual([]);
    expect(xmlDiagnostics("")).toEqual([]);
    expect(xmlDiagnostics("  \n ")).toEqual([]);
  });

  it("underlines a whole unexpected closing tag", () => {
    const text = "<a>\n  <b>\n</a>";
    const d = only(text, chromium(3, 4, "Unexpected closing tag: a != b"));
    expect(text.slice(d.from, d.to)).toBe("</a>");
    expect(d.severity).toBe("error");
    expect(d.message).toBe("Unexpected closing tag: a != b");
  });

  it("underlines the token the parser names", () => {
    const text = "<a b=c/>";
    const d = only(text, chromium(1, 6, "Unexpected token: c"));
    expect(text.slice(d.from, d.to)).toBe("c");
    const entity = "<a>&foo;</a>";
    const e = only(entity, chromium(1, 8, "Unexpected entity: foo"));
    expect(entity.slice(e.from, e.to)).toBe("foo");
  });

  it("puts an error at the end of the text on the last character", () => {
    const text = "<a><b>";
    const d = only(text, chromium(1, 7, "Unexpected end of stream: still inside the root element"));
    expect(d).toMatchObject({ from: 5, to: 6 });
  });

  it("maps the position on a later line, with a long first line", () => {
    const text = `<r>${"<i/>".repeat(1000)}\n<x y=z/>\n</r>`;
    const column = 6;
    const d = only(text, chromium(2, column, "Unexpected token: z"));
    expect(text.slice(d.from, d.to)).toBe("z");
  });

  it("falls back on the first non-blank character without a position", () => {
    const text = "\n\n  <a>";
    const d = only(text, "The document is odd");
    expect(d).toMatchObject({ from: 4, to: 5, severity: "error" });
  });

  it("stays inside the document for a position past its end", () => {
    const d = only("<a>", chromium(40, 40, "Unexpected end of stream"));
    expect(d.from).toBeGreaterThanOrEqual(0);
    expect(d.to).toBeLessThanOrEqual(3);
    expect(d.to).toBeGreaterThan(d.from);
  });

  it("reports a parser that throws as an error at the start", () => {
    const d = xmlDiagnostics("<a/>", () => {
      throw new Error("boom");
    });
    expect(d).toHaveLength(1);
    expect(d[0]?.message).toBe("Boom");
  });

  it("uses the real DOMParser: a mismatch is found, a good document is not", () => {
    expect(xmlDiagnostics('<?xml version="1.0"?><a x="1"><b/></a>')).toEqual([]);
    const found = xmlDiagnostics("<a><b></a>");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.from).toBeGreaterThanOrEqual(0);
    expect(isWellFormed("<a/>")).toBe(true);
    expect(isWellFormed("<a>")).toBe(false);
  });
});

describe("entity expansion", () => {
  /** The classic nested sample: ten levels of ten references each. */
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${[
    1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]
    .map((n) => `<!ENTITY lol${n} "${`&lol${n === 1 ? "" : n - 1};`.repeat(10)}">`)
    .join("")}]><lolz>&lol9;</lolz>`;

  it("finishes the billion laughs sample at once, with a result either way", () => {
    const started = performance.now();
    const found = xmlDiagnostics(laughs);
    expect(performance.now() - started).toBeLessThan(2000);
    // The browser refuses it ("Entity too big"); jsdom's parser may accept it unexpanded. Neither
    // may hang or throw, and a refusal must read as an error.
    for (const d of found) expect(d.severity).toBe("error");
  });

  it("does not expand a large entity referenced many times: 40 KB must not become 100 MB", () => {
    const big = `<!DOCTYPE l [<!ENTITY x "${"a".repeat(10_000)}">]><l>${"&x;".repeat(10_000)}</l>`;
    expect(big.length).toBeLessThan(50_000);
    expect(expansionTooLarge(big)).toBe(true);
    const found = xmlDiagnostics(big, () => {
      throw new Error("the parser must not be called");
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toMatch(/expand to too much text/);
    expect(isWellFormed(big)).toBe(false);
  });

  it("leaves ordinary entities alone", () => {
    const ok = '<!DOCTYPE l [<!ENTITY x "hello">]><l>&x; &x; &amp;</l>';
    expect(expansionTooLarge(ok)).toBe(false);
    expect(expansionTooLarge("<a>&amp;</a>")).toBe(false);
  });
});
