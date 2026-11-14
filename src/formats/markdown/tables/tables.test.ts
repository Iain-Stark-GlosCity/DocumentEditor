import { undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import * as actions from "./actions";
import { findTable } from "./editor";
import { tableCommands } from "./index";
import { afterKey, afterRun, makeView, press, show, type Options } from "./test-helpers";

const lines = (...l: string[]): string => l.join("\n");

const BASIC = lines("| a | b |", "|---|---|", "| 1 | 2 |");
const FORMATTED = lines("| a   | b   |", "| --- | --- |", "| 1   | 2   |");

/** Every behaviour must hold with the parser and with the text fallback alone. */
describe.each<[string, Options]>([
  ["with the Markdown parser", { parser: true }],
  ["with the text fallback", { parser: false }],
])("keys %s", (_name, options) => {
  const key = (marked: string, k: string) => afterKey(marked, k, options);

  describe("Tab", () => {
    it("moves to the next cell, selecting it and re-aligning", () => {
      const { result, handled } = key(BASIC.replace("a", "^a"), "Tab");
      expect(handled).toBe(true);
      expect(result).toBe(FORMATTED.replace("b", "«b»"));
    });

    it("wraps to the first cell of the next row, skipping the delimiter row", () => {
      const { result } = key(BASIC.replace("b", "^b"), "Tab");
      expect(result).toBe(FORMATTED.replace("1", "«1»"));
    });

    it("moves from the delimiter row into the first body row", () => {
      const { result } = key(BASIC.replace("|---|---|", "|-^--|---|"), "Tab");
      expect(result).toBe(FORMATTED.replace("1", "«1»"));
    });

    it("appends a row from the last cell", () => {
      const { result } = key(BASIC.replace("2", "^2"), "Tab");
      expect(result).toBe(lines(FORMATTED, "| ^    |     |"));
    });

    it("works at the very end of a document with a trailing newline", () => {
      const { result } = key(BASIC.replace("2", "^2") + "\n", "Tab");
      expect(result).toBe(lines(FORMATTED, "| ^    |     |") + "\n");
    });

    it("changes only the table's lines", () => {
      const doc = lines("intro", "", BASIC.replace("a", "^a"), "", "outro");
      const { result } = key(doc, "Tab");
      expect(result).toBe(lines("intro", "", FORMATTED.replace("b", "«b»"), "", "outro"));
    });

    it("does not touch a table that is already aligned", () => {
      const view = makeView(FORMATTED.replace("a", "^a"), options);
      const before = view.state.doc;
      press(view, "Tab");
      expect(view.state.doc.eq(before)).toBe(true);
      view.destroy();
    });

    it("pads ragged rows to the widest", () => {
      const { result } = key(lines("| ^a | b |", "|---|---|", "| 1 |", "| x | y | z |"), "Tab");
      expect(result).toBe(
        lines(
          "| a   | «b»   |     |",
          "| --- | --- | --- |",
          "| 1   |     |     |",
          "| x   | y   | z   |",
        ),
      );
    });

    it("aligns wide characters by display width", () => {
      const { result } = key(lines("| ^名前 | v |", "|---|---|", "| ab | 😀 |"), "Tab");
      expect(result).toBe(lines("| 名前 | «v»   |", "| ---- | --- |", "| ab   | 😀  |"));
    });

    it("works inside a blockquote", () => {
      const { result } = key(lines("> | ^a | b |", "> |---|---|", "> | 1 | 2 |"), "Tab");
      expect(result).toBe(lines("> | a   | «b»   |", "> | --- | --- |", "> | 1   | 2   |"));
    });

    it("works inside a list item", () => {
      const doc = lines("- item", "", "  | ^a | b |", "  |---|---|", "  | 1 | 2 |");
      const { result } = key(doc, "Tab");
      expect(result).toBe(
        lines("- item", "", "  | a   | «b»   |", "  | --- | --- |", "  | 1   | 2   |"),
      );
    });

    it("works for a table at the very start of the document", () => {
      const { result } = key(BASIC.replace("a", "^a") + "\n\ntext", "Tab");
      expect(result).toBe(FORMATTED.replace("b", "«b»") + "\n\ntext");
    });

    it("returns false outside a table and changes nothing", () => {
      const view = makeView("plain ^text\n\n| a | b |", options);
      expect(press(view, "Tab")).toBe(false);
      expect(show(view)).toBe("plain ^text\n\n| a | b |");
      view.destroy();
    });

    it("returns false on a header line with no delimiter row", () => {
      const { handled } = key("| a | ^b |\nnot a delimiter", "Tab");
      expect(handled).toBe(false);
    });

    it("is one undoable step that restores the document and cursor exactly", () => {
      const marked = BASIC.replace("2", "^2");
      const view = makeView(marked, options);
      press(view, "Tab");
      expect(view.state.doc.toString()).not.toBe(BASIC);
      undo(view);
      expect(show(view)).toBe(marked);
      view.destroy();
    });
  });

  describe("Shift-Tab", () => {
    it("moves to the previous cell", () => {
      const { result } = key(BASIC.replace("1", "^1"), "Shift-Tab");
      expect(result).toBe(FORMATTED.replace("b", "«b»"));
    });
    it("moves left within a row", () => {
      const { result } = key(BASIC.replace("b", "^b"), "Shift-Tab");
      expect(result).toBe(FORMATTED.replace("a", "«a»"));
    });
    it("stays in the first cell of the header", () => {
      const { result, handled } = key(BASIC.replace("a", "^a"), "Shift-Tab");
      expect(handled).toBe(true);
      expect(result).toBe(FORMATTED.replace("a", "«a»"));
    });
    it("returns false outside a table", () => {
      expect(key("hello ^", "Shift-Tab").handled).toBe(false);
    });
  });

  describe("Enter", () => {
    it("moves to the same column in the next row", () => {
      const { result } = key(BASIC.replace("b", "^b").replace("2", "2"), "Enter");
      expect(result).toBe(FORMATTED.replace("2", "«2»"));
    });

    it("appends a row from the last row", () => {
      const { result } = key(BASIC.replace("2", "^2"), "Enter");
      expect(result).toBe(lines(FORMATTED, "|     | ^    |"));
    });

    it("on an empty last row removes it and leaves the table", () => {
      const { result } = key(lines(FORMATTED, "|     |   ^  |"), "Enter");
      expect(result).toBe(lines(FORMATTED, "^"));
    });

    it("leaves a table in a blockquote on a line in the same quote", () => {
      const rows = lines("> | a   | b   |", "> | --- | --- |", "> | 1   | 2   |");
      const view = makeView(lines(rows, "> |     |  ^   |"), options);
      press(view, "Enter");
      expect(show(view)).toBe(lines(rows, "> ^"));
      view.destroy();
    });

    it("pressing Enter twice at the end leaves the table", () => {
      const view = makeView(BASIC.replace("2", "^2"), options);
      press(view, "Enter");
      press(view, "Enter");
      expect(show(view)).toBe(lines(FORMATTED, "^"));
      view.destroy();
    });

    it("from the header goes to the first body row", () => {
      const { result } = key(BASIC.replace("a", "^a"), "Enter");
      expect(result).toBe(FORMATTED.replace("1", "«1»"));
    });

    it("from a header-only table appends the first body row", () => {
      const { result } = key("| a | ^b |\n|---|---|", "Enter");
      expect(result).toBe(lines("| a   | b   |", "| --- | --- |", "|     | ^    |"));
    });

    it("returns false outside a table so a newline is inserted normally", () => {
      expect(key("some text^", "Enter").handled).toBe(false);
    });
  });

  describe("Mod-Enter", () => {
    it("leaves the table to a new line below without adding a row", () => {
      const { result } = key(BASIC.replace("1", "^1"), "Mod-Enter");
      expect(result).toBe(lines(FORMATTED, "^"));
    });
    it("uses a blank line that is already below", () => {
      const { result } = key(BASIC.replace("1", "^1") + "\n\nafter", "Mod-Enter");
      expect(result).toBe(lines(FORMATTED, "^", "after"));
    });
    it("keeps the quote prefix in a blockquote", () => {
      const { result } = key(lines("> | a |", "> |---|", "> | ^1 |"), "Mod-Enter");
      expect(result).toBe(lines("> | a   |", "> | --- |", "> | 1   |", "> ^"));
    });
    it("returns false outside a table", () => {
      expect(key("text ^", "Mod-Enter").handled).toBe(false);
    });
  });

  describe("Alt-arrows", () => {
    it("moves the row down and the cursor with it", () => {
      const doc = lines("| a | b |", "|---|---|", "| ^1 | 2 |", "| 3 | 4 |");
      const { result } = key(doc, "Alt-ArrowDown");
      expect(result).toBe(
        lines("| a   | b   |", "| --- | --- |", "| 3   | 4   |", "| ^1   | 2   |"),
      );
    });
    it("moves the row up", () => {
      const doc = lines("| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | ^4 |");
      const { result } = key(doc, "Alt-ArrowUp");
      expect(result).toBe(
        lines("| a   | b   |", "| --- | --- |", "| 3   | ^4   |", "| 1   | 2   |"),
      );
    });
    it("does nothing at the edges but still takes the key", () => {
      const doc = lines("| a | b |", "|---|---|", "| ^1 | 2 |");
      const view = makeView(doc, options);
      expect(press(view, "Alt-ArrowUp")).toBe(true);
      expect(view.state.doc.toString()).toBe(doc.replace("^", ""));
      view.destroy();
    });
    it("moves the column right with its alignment", () => {
      const doc = lines("| ^a | b |", "|:--|--:|", "| 1 | 2 |");
      const { result } = key(doc, "Alt-ArrowRight");
      expect(result).toBe(lines("|    b | ^a    |", "| ---: | :--- |", "|    2 | 1    |"));
    });
    it("moves the column left", () => {
      const doc = lines("| a | ^b |", "|---|---|", "| 1 | 2 |");
      const { result } = key(doc, "Alt-ArrowLeft");
      expect(result).toBe(lines("| ^b   | a   |", "| --- | --- |", "| 2   | 1   |"));
    });
    it("returns false outside a table so the default move-line runs", () => {
      expect(key("a ^line", "Alt-ArrowUp").handled).toBe(false);
    });
  });

  it("Escape is not handled", () => {
    expect(key(BASIC.replace("a", "^a"), "Escape").handled).toBe(false);
  });

  describe("typing aids", () => {
    it("completes `|-` to the header's column count on Tab", () => {
      const { result } = key(lines("| a | b | c |", "|-^"), "Tab");
      expect(result).toBe(
        lines("| a   | b   | c   |", "| --- | --- | --- |", "| ^    |     |     |"),
      );
    });
    it("completes a short delimiter row on Enter", () => {
      const { result } = key(lines("| a | b | c |", "|---|---|^"), "Enter");
      expect(result).toBe(
        lines("| a   | b   | c   |", "| --- | --- | --- |", "|     | ^    |     |"),
      );
    });
    it("works for a header without outer pipes", () => {
      const { result } = key(lines("Name | Age", "-|-^"), "Tab");
      expect(result).toBe(lines("| Name | Age |", "| ---- | --- |", "| ^     |     |"));
    });
    it("is not triggered by a plain paragraph followed by dashes", () => {
      expect(key(lines("Just a title", "---^"), "Enter").handled).toBe(false);
    });
  });
});

describe("keys with autoFormat off", () => {
  const off: Options = { autoFormat: false };
  const raw = lines("|a|b|", "|-|-|", "|1|2|");

  it("navigates without rewriting the table", () => {
    const { result } = afterKey(raw.replace("a", "^a"), "Tab", off);
    expect(result).toBe(raw.replace("b", "«b»"));
  });
  it("appends a raw row from the last cell", () => {
    const { result } = afterKey(raw.replace("2", "^2"), "Tab", off);
    expect(result).toBe(lines(raw, "| ^  |   |"));
  });
  it("Enter moves down without rewriting", () => {
    const { result } = afterKey(raw.replace("a", "^a"), "Enter", off);
    expect(result).toBe(raw.replace("1", "«1»"));
  });
});

describe("commands", () => {
  const run = (id: string, marked: string, options: Options = {}) => {
    const command = tableCommands.find((c) => c.id === `markdown.table.${id}`);
    if (!command) throw new Error(`no command ${id}`);
    return afterRun(marked, (v) => command.run(v), options);
  };
  const T = lines("| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |");

  it("are enabled only inside a table, except insert and paste", () => {
    const inside = makeView("| a |\n|---|\n| ^1 |\n").state;
    const outside = makeView("plain ^text\n").state;
    for (const c of tableCommands) {
      const always = c.id === "markdown.table.insert" || c.id === "markdown.table.pasteAsTable";
      expect(c.enabled?.(inside) ?? true, c.id).toBe(true);
      expect(c.enabled?.(outside) ?? true, c.id).toBe(always);
    }
  });

  it("registers the documented ids", () => {
    expect(tableCommands.map((c) => c.id)).toEqual(
      [
        "insert",
        "format",
        "insertRowAbove",
        "insertRowBelow",
        "insertColumnLeft",
        "insertColumnRight",
        "deleteRow",
        "deleteColumn",
        "moveRowUp",
        "moveRowDown",
        "moveColumnLeft",
        "moveColumnRight",
        "alignLeft",
        "alignCentre",
        "alignRight",
        "alignNone",
        "sortAscending",
        "sortDescending",
        "pasteAsTable",
      ].map((id) => `markdown.table.${id}`),
    );
  });

  it("every table command returns false outside a table", () => {
    for (const c of tableCommands) {
      if (c.id.endsWith(".insert") || c.id.endsWith(".pasteAsTable")) continue;
      const view = makeView("just ^text");
      expect(c.run(view), c.id).toBe(false);
      expect(show(view)).toBe("just ^text");
      view.destroy();
    }
  });

  it("formats the table and keeps the cursor in the same place in its cell", () => {
    const { result } = run("format", T.replace("| 1 |", "| 1^23 |"));
    expect(result).toBe(lines("| a   | b   |", "| --- | --- |", "| 1^23 | 2   |", "| 3   | 4   |"));
  });

  it("inserts rows above and below", () => {
    expect(run("insertRowAbove", T.replace("3", "^3")).result).toBe(
      lines("| a   | b   |", "| --- | --- |", "| 1   | 2   |", "| ^    |     |", "| 3   | 4   |"),
    );
    expect(run("insertRowBelow", T.replace("1", "^1")).result).toBe(
      lines("| a   | b   |", "| --- | --- |", "| 1   | 2   |", "| ^    |     |", "| 3   | 4   |"),
    );
    expect(run("insertRowBelow", T.replace("a", "^a")).result).toContain("| ^    |     |\n| 1 ");
    expect(run("insertRowAbove", T.replace("a", "^a")).handled).toBe(false);
  });

  it("inserts columns left and right", () => {
    expect(run("insertColumnLeft", T.replace("b", "^b")).result).toBe(
      lines(
        "| a   | ^    | b   |",
        "| --- | --- | --- |",
        "| 1   |     | 2   |",
        "| 3   |     | 4   |",
      ),
    );
    expect(run("insertColumnRight", T.replace("a", "^a")).result).toBe(
      lines(
        "| a   | ^    | b   |",
        "| --- | --- | --- |",
        "| 1   |     | 2   |",
        "| 3   |     | 4   |",
      ),
    );
  });

  it("deletes rows and columns", () => {
    expect(run("deleteRow", T.replace("1", "^1")).result).toBe(
      lines("| a   | b   |", "| --- | --- |", "| «3»   | 4   |"),
    );
    expect(run("deleteRow", T.replace("a", "^a")).handled).toBe(false);
    expect(run("deleteColumn", T.replace("a", "^a")).result).toBe(
      lines("| «b»   |", "| --- |", "| 2   |", "| 4   |"),
    );
    const single = run("deleteColumn", lines("| ^a |", "|---|"));
    expect(single.handled).toBe(false);
  });

  it("deleting the last body row leaves the header and delimiter", () => {
    const { result } = run("deleteRow", lines("| a | b |", "|---|---|", "| ^1 | 2 |"));
    expect(result).toBe(lines("| «a»   | b   |", "| --- | --- |"));
  });

  it("moves rows and columns", () => {
    expect(run("moveRowDown", T.replace("1", "^1")).result).toContain(
      "| 3   | 4   |\n| ^1   | 2   |",
    );
    expect(run("moveRowUp", T.replace("3", "^3")).result).toContain(
      "| ^3   | 4   |\n| 1   | 2   |",
    );
    expect(run("moveColumnRight", T.replace("1", "^1")).result).toContain("| 2   | ^1   |");
    expect(run("moveColumnLeft", T.replace("2", "^2")).result).toContain("| ^2   | 1   |");
  });

  it("sets alignment", () => {
    const view = makeView(T.replace("1", "^1"));
    tableCommands.find((c) => c.id === "markdown.table.alignRight")!.run(view);
    expect(view.state.doc.toString()).toBe(
      lines("|    a | b   |", "| ---: | --- |", "|    1 | 2   |", "|    3 | 4   |"),
    );
    tableCommands.find((c) => c.id === "markdown.table.alignCentre")!.run(view);
    expect(view.state.doc.line(2).text).toBe("| :---: | --- |");
    tableCommands.find((c) => c.id === "markdown.table.alignLeft")!.run(view);
    expect(view.state.doc.line(2).text).toBe("| :--- | --- |");
    tableCommands.find((c) => c.id === "markdown.table.alignNone")!.run(view);
    expect(view.state.doc.line(2).text).toBe("| --- | --- |");
    view.destroy();
  });

  it("sorts by the current column, keeping the header, numerically", () => {
    const doc = lines("| n | t |", "|---|---|", "| 10 | j |", "| 9 | k |", "| 100 | i |");
    const asc = run("sortAscending", doc.replace("n", "^n")).result;
    expect(asc).toBe(
      lines("| ^n   | t   |", "| --- | --- |", "| 9   | k   |", "| 10  | j   |", "| 100 | i   |"),
    );
    const desc = run("sortDescending", doc.replace("t", "^t")).result;
    expect(desc).toBe(
      lines("| n   | ^t   |", "| --- | --- |", "| 9   | k   |", "| 10  | j   |", "| 100 | i   |"),
    );
  });

  it("undoes a structural command in one step", () => {
    const marked = T.replace("1", "^1");
    const view = makeView(marked);
    tableCommands.find((c) => c.id === "markdown.table.sortDescending")!.run(view);
    tableCommands.find((c) => c.id === "markdown.table.insertColumnRight")!.run(view);
    undo(view);
    undo(view);
    expect(view.state.doc.toString()).toBe(T);
    view.destroy();
  });

  describe("insert table", () => {
    it("inserts a 3 by 2 skeleton with the cursor in the first header cell", () => {
      const { result } = run("insert", "^");
      expect(result).toBe(
        lines(
          "| ^    |     |     |",
          "| --- | --- | --- |",
          "|     |     |     |",
          "|     |     |     |",
        ),
      );
    });
    it("separates it from the text around it", () => {
      const { result } = run("insert", "before^\nafter");
      expect(result).toBe(
        lines(
          "before",
          "",
          "| ^    |     |     |",
          "| --- | --- | --- |",
          "|     |     |     |",
          "|     |     |     |",
          "",
          "after",
        ),
      );
    });
    it("converts selected TSV to a table", () => {
      const { result } = run("insert", "«name\tage\nAnn\t31»");
      expect(result.replace("^", "")).toContain("| name | age |");
      expect(result).toContain("| Ann  | 31  |");
    });
    it("converts selected CSV to a table", () => {
      const { result } = run("insert", "x\n\n«a,b\n1,2»\n\ny");
      expect(result).toBe(
        lines("x", "", "| ^a   | b   |", "| --- | --- |", "| 1   | 2   |", "", "y"),
      );
    });
    it("inserts an empty table when the selection is not CSV/TSV", () => {
      const { result } = run("insert", "«just words»");
      expect(result).toContain("| --- | --- | --- |");
      expect(result).toContain("just words");
    });
  });

  describe("paste as table", () => {
    it("converts TSV text into a table", () => {
      const view = makeView("^");
      expect(actions.pasteTextAsTable(view, "h1\th2\n1\t2\n")).toBe(true);
      expect(view.state.doc.toString()).toBe(
        lines("| h1  | h2  |", "| --- | --- |", "| 1   | 2   |"),
      );
      view.destroy();
    });
    it("declines text that is not delimited", () => {
      const view = makeView("^");
      expect(actions.pasteTextAsTable(view, "plain")).toBe(false);
      view.destroy();
    });
  });
});

describe("pasting into a table", () => {
  const T = lines("| a | b |", "|---|---|", "| 1 | 2 |");

  it("fills cells from the cursor and grows the table", () => {
    const view = makeView(T.replace("1", "^1"));
    expect(actions.pasteCells(view, "x\ty\tz\nm\tn\to\n")).toBe(true);
    expect(view.state.doc.toString()).toBe(
      lines(
        "| a   | b   |     |",
        "| --- | --- | --- |",
        "| x   | y   | z   |",
        "| m   | n   | o   |",
      ),
    );
    view.destroy();
  });

  it("starts at the header when the cursor is there", () => {
    const view = makeView(T.replace("b", "^b"));
    actions.pasteCells(view, "P\tQ\nR\tS");
    expect(view.state.doc.toString()).toBe(
      lines("| a   | P   | Q   |", "| --- | --- | --- |", "| 1   | R   | S   |"),
    );
    view.destroy();
  });

  it("escapes pipes in pasted cells", () => {
    const view = makeView(T.replace("1", "^1"));
    actions.pasteCells(view, "a|b\tc");
    expect(view.state.doc.line(3).text).toContain("a\\|b");
    view.destroy();
  });

  it("is a single undo step", () => {
    const marked = T.replace("1", "^1");
    const view = makeView(marked);
    actions.pasteCells(view, "x\ty\nz\tw");
    undo(view);
    expect(show(view)).toBe(marked);
    view.destroy();
  });

  it("leaves text without tabs, and pastes outside tables, to the editor", () => {
    const view = makeView(T.replace("1", "^1"));
    expect(actions.pasteCells(view, "just one line")).toBe(false);
    view.destroy();
    const outside = makeView("plain ^text");
    expect(actions.pasteCells(outside, "a\tb\nc\td")).toBe(false);
    expect(outside.state.doc.toString()).toBe("plain text");
    outside.destroy();
  });
});

describe("table detection", () => {
  it("finds a table in the syntax tree and by text alone", () => {
    for (const parser of [true, false]) {
      const view = makeView(lines("text", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "^more"), {
        parser,
      });
      expect(findTable(view.state, view.state.selection.main.head)).toBeNull();
      const inside = view.state.doc.line(5).from + 2;
      const loc = findTable(view.state, inside);
      expect(loc?.lines).toEqual(["| a | b |", "|---|---|", "| 1 | 2 |"]);
      expect(loc?.startLine).toBe(3);
      view.destroy();
    }
  });

  it("does not treat a table in a fenced code block as a table", () => {
    const doc = lines("```", "| a | b |", "|---|---|", "| 1 | ^2 |", "```");
    const view = makeView(doc);
    expect(press(view, "Tab")).toBe(false);
    view.destroy();
  });

  it("stops at a blank line", () => {
    const view = makeView(lines("| a | b |", "|---|---|", "| 1 | 2 |", "", "| c | ^d |"));
    expect(press(view, "Tab")).toBe(false);
    view.destroy();
  });
});

describe("performance", () => {
  it("formats a 2,000 row table in well under a second", () => {
    const rows = ["| id | name | value |", "|---|---|---:|"];
    for (let i = 0; i < 2000; i++) rows.push(`| ${i} | name ${i} 日本 | ${i * 3.5} |`);
    const doc = rows.join("\n");
    const view = makeView("| ^" + doc.slice(2));
    const start = performance.now();
    expect(actions.formatTable(view)).toBe(true);
    const elapsed = performance.now() - start;
    expect(view.state.doc.lines).toBe(2002);
    expect(elapsed).toBeLessThan(1000);
    view.destroy();
  });

  it("navigating in a big, aligned table rewrites nothing", () => {
    const rows = ["| id | name |", "| --- | --- |"];
    for (let i = 0; i < 2000; i++) rows.push(`| ${String(i).padEnd(3)} | n${i}  |`);
    const view = makeView("| ^" + rows.join("\n").slice(2));
    press(view, "Tab"); // formats once
    const formatted = view.state.doc;
    const start = performance.now();
    press(view, "Tab");
    expect(performance.now() - start).toBeLessThan(1000);
    expect(view.state.doc.eq(formatted)).toBe(true);
    view.destroy();
  });
});
