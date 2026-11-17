/** Regression tests: tables that share their first line with a list marker are left alone. */
import { describe, expect, it } from "vitest";
import { findTable } from "./editor";
import { formatTable, nextCell } from "./actions";
import { afterKey, afterRun, makeView } from "./test-helpers";

describe("a table whose header is on the line of a list marker", () => {
  const docs = [
    ["a bullet", "- | a | b |\n  |--|--|\n  | x^ | yyy |"],
    ["a numbered item", "1. | a | b |\n   |--|--|\n   | x^ | yyy |"],
    ["a quote inside an item", "- > | a | b |\n  > |--|--|\n  > | x^ | yyy |"],
  ] as const;

  it.each(docs)("is not formatted (%s): the marker would become a cell", (_name, doc) => {
    const result = afterRun(doc, formatTable);
    expect(result.handled).toBe(false);
    expect(result.result).toBe(doc);
  });

  it.each(docs)("does not take Tab (%s)", (_name, doc) => {
    const result = afterKey(doc, "Tab");
    expect(result.result).toBe(doc);
  });

  it.each(docs)("findTable reports none (%s)", (_name, doc) => {
    const view = makeView(doc);
    try {
      expect(findTable(view.state, view.state.selection.main.head)).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("nextCell declines", () => {
    const view = makeView("- | a | b |\n  |--|--|\n  | x^ | y |");
    try {
      expect(nextCell(view, true)).toBe(false);
    } finally {
      view.destroy();
    }
  });
});

describe("tables below a list item keep working", () => {
  it("formats an indented table", () => {
    const result = afterRun("- item\n\n  | a | b |\n  |--|--|\n  | x^ | yyy |", formatTable);
    expect(result.result).toBe("- item\n\n  | a   | b   |\n  | --- | --- |\n  | x^   | yyy |");
  });
});
