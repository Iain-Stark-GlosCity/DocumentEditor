import { describe, expect, it } from "vitest";
import { BOLD, ITALIC, writeInline, type Item, type Wrapper } from "./inline";
import { escapeLineStart, escapeText, halfPoints, tableWidth, twips } from "./notation";
import { formatNumber } from "./numbering";

const t = (text: string, ...wrappers: Wrapper[]): Item => ({ text, wrappers, token: false });
const span: Wrapper = { key: "s", open: '<span colour="C00000">', close: "</span>" };

describe("escaping", () => {
  it("escapes what would read as Markdown or HTML, and nothing else", () => {
    expect(escapeText("2 * 3 = 6, [a] <b> `c` ~d~ \\")).toBe(
      "2 \\* 3 = 6, \\[a\\] \\<b> \\`c\\` \\~d\\~ \\\\",
    );
    expect(escapeText("snake_case _lead trail_")).toBe("snake_case \\_lead trail\\_");
    expect(escapeText("#1 and C# and a # b")).toBe("\\#1 and C# and a \\# b");
    expect(escapeText("&amp; & AT&T")).toBe("&amp;amp; & AT&T");
    expect(escapeText("a|b", true)).toBe("a\\|b");
    expect(escapeLineStart("1. not a list")).toBe("1\\. not a list");
    expect(escapeLineStart("- not a bullet")).toBe("\\- not a bullet");
    expect(escapeLineStart("> not a quote")).toBe("\\> not a quote");
  });

  it("makes invisible characters visible", () => {
    expect(escapeText("a\u00a0b\u00adc\u200bd")).toBe('a<nbsp/>b<shy/>c<char code="200B"/>d');
  });

  it("converts units", () => {
    expect(twips("720")).toBe("36pt");
    expect(twips("2.54cm")).toBe("72pt");
    expect(halfPoints("22")).toBe("11pt");
    expect(
      tableWidth({
        name: "w:tblW",
        attrs: { "w:w": "2500", "w:type": "pct" },
        children: [],
        parent: null,
        start: 0,
        end: 0,
      }),
    ).toBe("50%");
  });

  it("formats numbers as Word does", () => {
    expect(formatNumber(4, "upperRoman")).toBe("IV");
    expect(formatNumber(28, "lowerLetter")).toBe("bb");
    expect(formatNumber(3, "decimalZero")).toBe("03");
    expect(formatNumber(22, "ordinal")).toBe("22nd");
    expect(formatNumber(13, "ordinal")).toBe("13th");
  });
});

describe("writeInline", () => {
  it("merges runs with the same formatting and nests the rest", () => {
    expect(
      writeInline([
        t("Plain "),
        t("bold", BOLD),
        t(" and ", BOLD),
        t("both", BOLD, ITALIC),
        t("."),
      ]),
    ).toBe("Plain **bold and *both***.");
    expect(writeInline([t("red ", span), t("and bold", span, BOLD)])).toBe(
      '<span colour="C00000">red **and bold**</span>',
    );
  });

  it("keeps spaces outside emphasis", () => {
    expect(writeInline([t("a"), t(" bold ", BOLD), t("b")])).toBe("a **bold** b");
  });

  it("falls back to HTML tags where Markdown emphasis would not parse", () => {
    expect(writeInline([t("x"), t("(y)", BOLD), t("z")])).toBe("x<b>(y)</b>z");
    expect(writeInline([t("a", BOLD), t("b", ITALIC)])).toBe("**a**<i>b</i>");
  });

  it("makes spaces at either end visible and escapes the line start", () => {
    expect(writeInline([t("  two "), t("end   ")])).toBe('<sp n="2"/>two end<sp n="3"/>');
    expect(writeInline([t("1. literal")])).toBe("1\\. literal");
    expect(writeInline([t("1. literal")], { inTable: true })).toBe("1. literal");
  });
});
