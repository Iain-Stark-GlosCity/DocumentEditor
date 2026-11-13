import { describe, expect, it } from "vitest";
import { indentListItem, moveListItemDown, moveListItemUp, outdentListItem } from "./lists";
import type { EditCommand } from "./syntax";
import { Harness, makeState, run, toNotation, type Row } from "./testing";

function table(name: string, command: EditCommand, rows: readonly Row[]) {
  describe(name, () => {
    it.each(rows)("%s", (_title, input, expected) => {
      const result = run(command, input);
      expect(result.out).toBe(expected);
    });
  });
}

table("indentListItem", indentListItem, [
  ["indents a bullet under its sibling", "- a\n- b^", "- a\n  - b^"],
  ["indents the item's children too", "- a\n- b^\n  - c", "- a\n  - b^\n    - c"],
  ["ordered items nest by the marker width", "1. a\n2. b^", "1. a\n   1. b^"],
  ["renumbers the rest of the list", "1. a\n2. b^\n3. c", "1. a\n   1. b^\n2. c"],
  ["continues an existing nested list", "1. a\n   1. x\n2. b^", "1. a\n   1. x\n   2. b^"],
  ["task items", "- [ ] a\n- [ ] b^", "- [ ] a\n  - [ ] b^"],
  ["works from the middle of the text", "- a\n- hel^lo", "- a\n  - hel^lo"],
  ["multiple selected items", "- a\n|- b\n- c|", "- a\n  |- b\n  - c|"],
  [
    "items in a selection with children are indented once",
    "- a\n|- b\n  - c|",
    "- a\n  |- b\n    - c|",
  ],
  ["a first item still indents", "- a^", "  - a^"],
  ["inside a blockquote", "> - a\n> - b^", "> - a\n>   - b^"],
  ["continuation lines move with the item", "- a\n- b^\n  more", "- a\n  - b^\n    more"],
  ["leaves blank lines alone", "- a\n- b^\n\n  more", "- a\n  - b^\n\n    more"],
  ["CJK content", "- 你好\n- 世界^", "- 你好\n  - 世界^"],
  ["multiple cursors", "- a\n- b^\n- c^", "- a\n  - b^\n  - c^"],
]);

describe("indentListItem declines", () => {
  it.each([
    ["outside a list", "fo^o"],
    ["in a code block", "```\nfo^o\n```"],
    [
      "in a table (the tables handler owns Tab)",
      "\\| a \\| b \\|\n\\|---\\|---\\|\n\\| c^ \\| d \\|",
    ],
    [
      "in a table inside a list item",
      "- x\n\n  \\| a \\| b \\|\n  \\|---\\|---\\|\n  \\| c^ \\| d \\|",
    ],
  ])("%s", (_name, input) => {
    expect(run(indentListItem, input).handled).toBe(false);
  });
});

table("outdentListItem", outdentListItem, [
  ["outdents a nested bullet", "- a\n  - b^", "- a\n- b^"],
  ["takes its children along", "- a\n  - b^\n    - c", "- a\n- b^\n  - c"],
  ["ordered: becomes the next number", "1. a\n   1. b^\n2. c", "1. a\n2. b^\n3. c"],
  ["task items", "- [ ] a\n  - [x] b^", "- [ ] a\n- [x] b^"],
  ["removes extra indentation from a top-level item", "  - a^", "- a^"],
  ["inside a blockquote", "> - a\n>   - b^", "> - a\n> - b^"],
  ["three levels deep goes up one", "- a\n  - b\n    - c^", "- a\n  - b\n  - c^"],
]);

describe("outdentListItem declines", () => {
  it.each([
    ["a top-level item", "- a^"],
    ["outside a list", "fo^o"],
    ["in a table", "\\| a \\| b \\|\n\\|---\\|---\\|\n\\| c^ \\| d \\|"],
  ])("%s", (_name, input) => {
    expect(run(outdentListItem, input).handled).toBe(false);
  });
});

table("moveListItemUp", moveListItemUp, [
  ["swaps with the previous sibling", "- a\n- b^", "- b^\n- a"],
  ["keeps ordered numbers right", "1. a\n2. b^\n3. c", "1. b^\n2. a\n3. c"],
  ["moves children with the item", "- a\n- b^\n  - c", "- b^\n  - c\n- a"],
  ["moves past a sibling with children", "- a\n  - x\n- b^", "- b^\n- a\n  - x"],
  ["keeps the selection inside the item", "- a\n- |b|", "- |b|\n- a"],
  ["nested items move among their siblings", "- p\n  - a\n  - b^", "- p\n  - b^\n  - a"],
  ["stays put on the first item", "- a^\n- b", "- a^\n- b"],
  ["a loose list keeps its blank lines", "- a\n\n- b^", "- b^\n\n- a"],
  ["tasks", "- [ ] a\n- [x] b^", "- [x] b^\n- [ ] a"],
  ["plain lines fall back to moving the line", "a\nb^", "b^\na"],
  ["multiple selections fall back to the line move", "a\nb^\nc^", "b^\nc^\na"],
]);

table("moveListItemDown", moveListItemDown, [
  ["swaps with the next sibling", "- a^\n- b", "- b\n- a^"],
  ["keeps ordered numbers right", "1. a^\n2. b\n3. c", "1. b\n2. a^\n3. c"],
  ["moves children with the item", "- a^\n  - x\n- b", "- b\n- a^\n  - x"],
  ["stays put on the last item", "- a\n- b^", "- a\n- b^"],
  ["plain lines fall back", "a^\nb", "b\na^"],
  ["emoji content stays intact", "- 😀^\n- 你好", "- 你好\n- 😀^"],
]);

describe("one transaction", () => {
  it("indenting renumbers in the same undo step", () => {
    const harness = new Harness(makeState("1. a\n2. b^\n3. c"));
    indentListItem(harness);
    expect(harness.transactions).toHaveLength(1);
    expect(toNotation(harness.state)).toBe("1. a\n   1. b^\n2. c");
  });
  it("never produces CRLF", () => {
    const base = makeState("- a\n- b^");
    const state = base.update({
      changes: { from: 0, to: base.doc.length, insert: "- a\r\n- b" },
      selection: { anchor: 7 },
    }).state;
    const harness = new Harness(state);
    indentListItem(harness);
    expect(harness.state.doc.toString()).toBe("- a\n  - b");
  });
});
