import { describe, expect, it } from "vitest";
import { isDelimiterContent, layoutTable, parseTable, serialiseTable, splitRow } from "./model";
import * as ops from "./ops";
import { displayWidth } from "./width";

const cells = (s: string): string[] => splitRow(s).map((c) => c.raw);

describe("displayWidth", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["日本語", 6],
    ["한글", 4],
    ["ＡＢ", 4], // fullwidth Latin
    ["a日b", 4],
    ["😀", 2],
    ["é", 1], // e + combining acute
    ["👍🏽", 2], // emoji plus skin tone modifier
    ["👨‍👩‍👧", 2], // ZWJ family sequence
    ["❤️", 2], // text pictograph with emoji presentation selector
    ["a​b", 2], // zero width space
    ["café", 4],
  ])("%j is %i wide", (text, width) => {
    expect(displayWidth(text)).toBe(width);
  });
});

describe("splitRow", () => {
  it.each([
    ["| a | b |", ["a", "b"]],
    ["a | b", ["a", "b"]],
    ["| a | b", ["a", "b"]],
    ["a | b |", ["a", "b"]],
    ["|a|b|", ["a", "b"]],
    ["| a |  | c |", ["a", "", "c"]],
    ["||", [""]],
    ["|", [""]],
    ["| a \\| b | c |", ["a \\| b", "c"]],
    ["| `a|b` | c |", ["`a|b`", "c"]],
    ["| ``a|`b`` | c |", ["``a|`b``", "c"]],
    ["| `unclosed | c |", ["`unclosed", "c"]],
    ["| \\\\| c |", ["\\\\", "c"]],
    ["  | a | b |  ", ["a", "b"]],
  ])("splits %j", (line, expected) => {
    expect(cells(line)).toEqual(expected);
  });

  it("reports trimmed positions", () => {
    const [first] = splitRow("|  ab  | c |");
    expect(first).toMatchObject({ from: 3, to: 5, start: 1, end: 7 });
  });
});

describe("isDelimiterContent", () => {
  it.each([
    ["|---|---|", true],
    ["| :--- | :---: | ---: |", true],
    ["-|-", true],
    ["|-|", true],
    ["| - | -- |", true],
    ["| --- | abc |", false],
    ["| : |", false],
    ["", false],
    ["| a |", false],
  ])("%j -> %s", (line, expected) => {
    expect(isDelimiterContent(line)).toBe(expected);
  });
});

describe("parseTable", () => {
  it("parses header, alignments and rows", () => {
    const m = parseTable(["| a | b | c | d |", "| :-- | :-: | --: | --- |", "| 1 | 2 | 3 | 4 |"]);
    expect(m).toEqual({
      prefix: "",
      header: ["a", "b", "c", "d"],
      align: ["left", "center", "right", "none"],
      rows: [["1", "2", "3", "4"]],
    });
  });

  it("pads short rows and widens for extra cells", () => {
    const m = parseTable(["| a | b |", "|---|---|", "| 1 |", "| 1 | 2 | 3 |"]);
    expect(m?.header).toEqual(["a", "b", ""]);
    expect(m?.align).toEqual(["none", "none", "none"]);
    expect(m?.rows).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("pads a short delimiter row to the header", () => {
    const m = parseTable(["a | b | c", "-|-", ""].slice(0, 2));
    expect(m?.align).toEqual(["none", "none", "none"]);
  });

  it("keeps the prefix of a blockquote and of an indented table", () => {
    expect(parseTable(["> | a |", "> |---|", "> | 1 |"])?.prefix).toBe("> ");
    expect(parseTable(["  | a |", "  |---|"])?.prefix).toBe("  ");
    expect(parseTable(["> > | a |", "> > |---|"])?.prefix).toBe("> > ");
    expect(parseTable(["> | a |", "> |---|", "> | 1 |"])?.rows).toEqual([["1"]]);
  });

  it("rejects text that is not a table", () => {
    expect(parseTable(["| a |"])).toBeNull();
    expect(parseTable(["| a |", "| b |"])).toBeNull();
  });

  it("keeps raw cell text untouched", () => {
    const m = parseTable(["| **bold** | `a|b` |", "|---|---|", "| \\| | <b>x</b> |"]);
    expect(m?.header).toEqual(["**bold**", "`a|b`"]);
    expect(m?.rows[0]).toEqual(["\\|", "<b>x</b>"]);
  });
});

describe("serialiseTable", () => {
  it("aligns columns, padding on the side the alignment asks for", () => {
    const m = parseTable([
      "| name | n | mid |",
      "| :--- | ---: | :---: |",
      "| apple | 1 | x |",
      "| fig | 1000 | yyyy |",
    ]);
    expect(serialiseTable(m!)).toEqual([
      "| name  |    n |  mid  |",
      "| :---- | ---: | :---: |",
      "| apple |    1 |   x   |",
      "| fig   | 1000 | yyyy  |",
    ]);
  });

  it("uses at least three dashes in every delimiter", () => {
    const m = parseTable(["a|b|c|d", ":-|-:|:-:|-"]);
    const [head, delim] = serialiseTable(m!);
    expect(head).toBe("| a    |    b |   c   | d   |");
    expect(delim).toBe("| :--- | ---: | :---: | --- |");
    for (const cell of delim!.split("|").filter((c) => c.trim())) {
      expect(cell.replace(/[ :]/g, "").length).toBeGreaterThanOrEqual(3);
    }
  });

  it("pads by display width", () => {
    const m = parseTable(["| 名前 | v |", "|---|---|", "| ab | 😀 |", "| 日本語 | é |"]);
    expect(serialiseTable(m!)).toEqual([
      "| 名前   | v   |",
      "| ------ | --- |",
      "| ab     | 😀  |",
      "| 日本語 | é   |",
    ]);
  });

  it("keeps the prefix on every line", () => {
    const m = parseTable(["> a | b", "> -|-", "> 1 | 2"]);
    expect(serialiseTable(m!)).toEqual(["> | a   | b   |", "> | --- | --- |", "> | 1   | 2   |"]);
  });

  it("reports where each cell's text is", () => {
    const m = parseTable(["| ab | c |", "|--|--|", "| d | ee |"]);
    const { lines, spans } = layoutTable(m!);
    const [, , row] = spans;
    expect(lines[2]!.slice(row![0]!.from, row![0]!.to)).toBe("d");
    expect(lines[2]!.slice(row![1]!.from, row![1]!.to)).toBe("ee");
  });

  it("is idempotent", () => {
    const m = parseTable(["a|b", "-|:-:", "1|22222"]);
    const once = serialiseTable(m!);
    expect(serialiseTable(parseTable(once)!)).toEqual(once);
  });
});

describe("round trip", () => {
  const samples: string[][] = [
    ["a | b", "-|-", "1 | 2"],
    ["| a | b |", "| :-- | --: |", "| 1 |", "| x | y | z |"],
    ["> | `a|b` | c\\|d |", "> |---|:-:|", "> | | |"],
    ["  | 名前 | 😀 |", "  |---|---|", "  | é | ** |"],
    ["|", "|-", "|"],
    ["| a |", "|:-:|"],
  ];
  it.each(samples)("parse, serialise, parse is stable (%j)", (...lines) => {
    const first = parseTable(lines)!;
    const second = parseTable(serialiseTable(first))!;
    expect(second).toEqual(first);
  });
});

describe("ops", () => {
  const base = parseTable(["| a | b |", "|---|---|", "| 1 | x |", "| 2 | y |"])!;

  it("inserts and deletes rows", () => {
    expect(ops.insertRow(base, 1).rows).toEqual([
      ["1", "x"],
      ["", ""],
      ["2", "y"],
    ]);
    expect(ops.insertRow(base, 99).rows.length).toBe(3);
    expect(ops.deleteRow(base, 0).rows).toEqual([["2", "y"]]);
  });

  it("moves rows within bounds only", () => {
    expect(ops.moveRow(base, 0, 1).rows).toEqual([
      ["2", "y"],
      ["1", "x"],
    ]);
    expect(ops.moveRow(base, 0, -1)).toBe(base);
    expect(ops.moveRow(base, 1, 1)).toBe(base);
  });

  it("inserts, deletes and moves columns with alignment", () => {
    const aligned = ops.setAlign(base, 1, "right");
    const inserted = ops.insertColumn(aligned, 1);
    expect(inserted.header).toEqual(["a", "", "b"]);
    expect(inserted.align).toEqual(["none", "none", "right"]);
    expect(ops.deleteColumn(aligned, 0).header).toEqual(["b"]);
    const moved = ops.moveColumn(aligned, 1, -1);
    expect(moved.header).toEqual(["b", "a"]);
    expect(moved.align).toEqual(["right", "none"]);
    expect(moved.rows[0]).toEqual(["x", "1"]);
    expect(ops.moveColumn(aligned, 0, -1)).toBe(aligned);
  });

  describe("sortRows", () => {
    const table = (values: string[]) => ({
      ...base,
      rows: values.map((v) => [v, "-"]),
    });
    const sorted = (values: string[], dir: "asc" | "desc") =>
      ops.sortRows(table(values), 0, dir).rows.map((r) => r[0]);

    it("sorts numbers numerically, not as text", () => {
      expect(sorted(["10", "9", "100", "-5", "2.5"], "asc")).toEqual([
        "-5",
        "2.5",
        "9",
        "10",
        "100",
      ]);
      expect(sorted(["10", "9", "100"], "desc")).toEqual(["100", "10", "9"]);
    });
    it("understands thousands separators, currency and percentages", () => {
      expect(sorted(["£1,200", "£300", "£25"], "asc")).toEqual(["£25", "£300", "£1,200"]);
      expect(sorted(["50%", "5%", "7%"], "asc")).toEqual(["5%", "7%", "50%"]);
    });
    it("sorts text naturally and ignoring case", () => {
      expect(sorted(["b", "A", "c", "file10", "file9"], "asc")).toEqual([
        "A",
        "b",
        "c",
        "file9",
        "file10",
      ]);
    });
    it("puts numbers before text and empty cells last in both directions", () => {
      expect(sorted(["b", "", "2", "a", "1"], "asc")).toEqual(["1", "2", "a", "b", ""]);
      expect(sorted(["b", "", "2", "a", "1"], "desc")).toEqual(["b", "a", "2", "1", ""]);
    });
    it("is stable", () => {
      const rows = ops.sortRows(
        {
          ...base,
          rows: [
            ["1", "a"],
            ["1", "b"],
            ["0", "c"],
          ],
        },
        0,
        "asc",
      ).rows;
      expect(rows.map((r) => r[1])).toEqual(["c", "a", "b"]);
    });
  });

  describe("delimited text", () => {
    it("parses quoted CSV", () => {
      expect(ops.parseDelimited('a,"b,c","d ""q"""\n1,2,3', ",")).toEqual([
        ["a", "b,c", 'd "q"'],
        ["1", "2", "3"],
      ]);
    });
    it("parses TSV with quoted newlines", () => {
      expect(ops.parseDelimited('a\t"x\ny"\r\n1\t2', "\t")).toEqual([
        ["a", "x\ny"],
        ["1", "2"],
      ]);
    });
    it("detects TSV and CSV but not prose", () => {
      expect(ops.detectDelimited("a\tb\n1\t2\n")?.separator).toBe("\t");
      expect(ops.detectDelimited("a,b\n1,2")?.separator).toBe(",");
      expect(ops.detectDelimited("Hello, world")).toBeNull();
      expect(ops.detectDelimited("one, two\nthree")).toBeNull();
      expect(ops.detectDelimited("plain text")).toBeNull();
      expect(ops.detectDelimited("")).toBeNull();
    });
    it("escapes pipes and flattens newlines in cells", () => {
      expect(ops.toCell("a|b")).toBe("a\\|b");
      expect(ops.toCell("a\\|b")).toBe("a\\|b");
      expect(ops.toCell("x\ny")).toBe("x y");
    });
    it("builds a model with the first row as header", () => {
      const m = ops.modelFromRows([["h1", "h2"], ["1"]]);
      expect(m.header).toEqual(["h1", "h2"]);
      expect(m.rows).toEqual([["1", ""]]);
    });
  });

  it("fills cells from a position, growing the table", () => {
    const m = ops.fillCells(base, 2, 1, [
      ["p", "q"],
      ["r", "s"],
    ]);
    expect(m.header).toEqual(["a", "b", ""]);
    expect(m.rows).toEqual([
      ["1", "x", ""],
      ["2", "p", "q"],
      ["", "r", "s"],
    ]);
  });
});

describe("performance", () => {
  it("parses and serialises 2,000 rows quickly", () => {
    const lines = ["| id | name | value |", "|---|---|---:|"];
    for (let i = 0; i < 2000; i++) lines.push(`| ${i} | name ${i} 日本 | ${i * 3.5} |`);
    const start = performance.now();
    const out = serialiseTable(parseTable(lines)!);
    expect(out).toHaveLength(2002);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
