import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  fieldValue,
  nextDelimiterSetting,
  parseCsv,
  resolveDelimiter,
  type Delimiter,
} from "./parse";

/** Rows as arrays of field values. */
function values(text: string, delimiter: Delimiter = ","): string[][] {
  return parseCsv(text, delimiter).rows.map((row) =>
    row.fields.map((f) => fieldValue(text, f.from, f.to)),
  );
}

describe("parseCsv", () => {
  it("reads plain rows, with and without a final line break", () => {
    expect(values("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(values("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads nothing from an empty text and no extra row after the last line break", () => {
    expect(parseCsv("", ",").rowCount).toBe(0);
    expect(parseCsv("a\n", ",").rowCount).toBe(1);
    expect(parseCsv("a\n\n\n", ",").rowCount).toBe(1);
  });

  it("keeps delimiters, line breaks and doubled quotes inside quoted fields", () => {
    expect(values('"a,b","line one\nline two","say ""hi"""\n')).toEqual([
      ["a,b", "line one\nline two", 'say "hi"'],
    ]);
  });

  it("reads empty fields, including at the ends of a row", () => {
    expect(values(",a,,b,\n")).toEqual([["", "a", "", "b", ""]]);
    expect(values("a,\n")).toEqual([["a", ""]]);
    expect(values("a,")).toEqual([["a", ""]]);
  });

  it("reads a field that is only two quotes as an empty value", () => {
    expect(values('""\n')).toEqual([[""]]);
    expect(values('a,"",b\n')).toEqual([["a", "", "b"]]);
    expect(values('""""\n')).toEqual([['"']]);
  });

  it("keeps ragged rows as they are", () => {
    expect(values("a,b,c\n1\n1,2,3,4\n")).toEqual([["a", "b", "c"], ["1"], ["1", "2", "3", "4"]]);
  });

  it("tolerates a stray quote inside an unquoted field", () => {
    expect(values('5" pipe,he said "hi",x\n')).toEqual([['5" pipe', 'he said "hi"', "x"]]);
  });

  it("tolerates text after a closing quote", () => {
    expect(values('"a"b,c\n')).toEqual([["ab", "c"]]);
  });

  it("reads an unterminated quote to the end of the text", () => {
    const rows = values('a,"never closed\nstill going');
    expect(rows).toEqual([["a", "never closed\nstill going"]]);
  });

  it("handles quotes at the very end of the file", () => {
    expect(values('a,"b"')).toEqual([["a", "b"]]);
    expect(values('a,"b""')).toEqual([["a", 'b"']]);
    expect(values('a,"')).toEqual([["a", ""]]);
  });

  it("does not include a CR before the LF, in or out of quotes", () => {
    expect(values("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(values('"a"\r\n"b"\r\n')).toEqual([["a"], ["b"]]);
  });

  it("keeps unicode and emoji intact and offsets in UTF-16 units", () => {
    const text = "名前,é\n🙂,naïve\n";
    expect(values(text)).toEqual([
      ["名前", "é"],
      ["🙂", "naïve"],
    ]);
    const second = parseCsv(text, ",").rows[1];
    expect(second?.from).toBe(text.indexOf("🙂"));
    expect(second?.fields[1]?.from).toBe(text.indexOf("naïve"));
  });

  it("reads each delimiter", () => {
    expect(values("a;b\n", ";")).toEqual([["a", "b"]]);
    expect(values("a\tb\n", "\t")).toEqual([["a", "b"]]);
    expect(values("a|b\n", "|")).toEqual([["a", "b"]]);
    // A comma is ordinary text under another delimiter.
    expect(values("a,b;c\n", ";")).toEqual([["a,b", "c"]]);
  });

  it("numbers rows by the source line they start on", () => {
    const text = 'a,b\n"x\ny",1\n\n3,4\n5,6';
    const rows = parseCsv(text, ",").rows;
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5, 6]);
  });

  it("records each field's offsets, quotes included", () => {
    const text = 'ab,"c,d",e';
    const row = parseCsv(text, ",").rows[0];
    expect(row?.fields.map((f) => text.slice(f.from, f.to))).toEqual(["ab", '"c,d"', "e"]);
    expect(row?.fields.map((f) => f.quoted)).toEqual([false, true, false]);
    expect(row?.from).toBe(0);
    expect(row?.to).toBe(text.length);
  });

  it("counts every row but keeps only maxRows of them", () => {
    const text = "a\nb\nc\nd\ne\n";
    const result = parseCsv(text, ",", { maxRows: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(5);
    expect(result.rows[1]?.line).toBe(2);
  });

  it("is fast enough for 100,000 rows by 10 columns", () => {
    const row = Array.from({ length: 10 }, (_, c) => (c % 3 === 0 ? `"v,${c}"` : `${c}.5`)).join(
      ",",
    );
    const text = Array.from({ length: 100_000 }, () => row).join("\n");
    const start = performance.now();
    const result = parseCsv(text, ",");
    const elapsed = performance.now() - start;
    expect(result.rowCount).toBe(100_000);
    expect(result.rows[99_999]?.fields).toHaveLength(10);
    // About a second at most; the margin is for slow CI machines.
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("detectDelimiter", () => {
  it.each<[string, string, Delimiter]>([
    ["comma", "a,b,c\n1,2,3\n4,5,6\n", ","],
    ["semicolon", "a;b;c\n1;2;3\n4;5;6\n", ";"],
    ["tab", "a\tb\tc\n1\t2\t3\n", "\t"],
    ["pipe", "a|b|c\n1|2|3\n", "|"],
  ])("finds %s", (_name, text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it("prefers the delimiter that gives the same width on every row", () => {
    // Commas inside the numbers are decimals; the semicolons are consistent.
    expect(detectDelimiter("name;price\nfoo;1,5\nbar;2,25\nbaz;3,0\n")).toBe(";");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"a;b;c";"d;e"\n"1;2";"3"\n')).toBe(";");
  });

  it("breaks a tie by width, then by the order comma, tab, semicolon, pipe", () => {
    // Every row has exactly two columns under comma and under semicolon: same share, same width.
    expect(detectDelimiter("a,b;c\nd,e;f\n")).toBe(",");
    expect(detectDelimiter("a;b|c\nd;e|f\n")).toBe(";");
    // Three columns under semicolon beat two under comma.
    expect(detectDelimiter("a,b;c;d\ne,f;g;h\n")).toBe(";");
  });

  it("falls back to comma for single-column and empty text", () => {
    expect(detectDelimiter("one\ntwo\nthree\n")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });

  it("reads only the start of a long text", () => {
    const text = "a;b\n".repeat(60) + "x,y,z,w\n".repeat(10_000);
    expect(detectDelimiter(text)).toBe(";");
  });
});

describe("resolveDelimiter", () => {
  it("uses a named delimiter whatever the text says", () => {
    expect(resolveDelimiter("pipe", "a,b\n", null)).toBe("|");
    expect(resolveDelimiter("tab", "a,b\n", "/x.csv")).toBe("\t");
  });

  it("reads a .tsv file as tab-separated under auto, even if it looks like commas", () => {
    expect(resolveDelimiter("auto", "a,b,c\n1,2,3\n", "/data/file.TSV")).toBe("\t");
  });

  it("detects under auto otherwise", () => {
    expect(resolveDelimiter("auto", "a;b\n1;2\n", "/data/file.csv")).toBe(";");
  });
});

describe("nextDelimiterSetting", () => {
  it("cycles through every setting and wraps", () => {
    const seen = ["auto"];
    for (let i = 0; i < 5; i++) seen.push(nextDelimiterSetting(seen[i] ?? "auto"));
    expect(seen).toEqual(["auto", "comma", "semicolon", "tab", "pipe", "auto"]);
  });
});
