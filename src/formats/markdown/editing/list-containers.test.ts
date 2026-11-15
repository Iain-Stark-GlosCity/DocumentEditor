/** Regression tests: list commands inside block quotes and next to a list of another kind. */
import { describe, expect, it } from "vitest";
import { indentListItem, moveListItemDown, moveListItemUp } from "./lists";
import type { EditCommand } from "./syntax";
import { run, type Row } from "./testing";

function table(name: string, command: EditCommand, rows: readonly Row[]) {
  describe(name, () => {
    it.each(rows)("%s", (_title, input, expected) => {
      expect(run(command, input).out).toBe(expected);
    });
  });
}

table("moveListItemDown in a block quote", moveListItemDown, [
  ["swaps with the next item", "> - a^\n> - b", "> - b\n> - a^"],
  ["moves an item with children", "> - a^\n>   - x\n> - b", "> - b\n> - a^\n>   - x"],
  ["keeps ordered numbers right", "> 1. a^\n> 2. b\n> 3. c", "> 1. b\n> 2. a^\n> 3. c"],
  ["nested block quote", "> > - a^\n> > - b", "> > - b\n> > - a^"],
]);

table("moveListItemUp in a block quote", moveListItemUp, [
  ["swaps with the previous item", "> - a\n> - b^", "> - b^\n> - a"],
  ["keeps ordered numbers right", "> 1. a\n> 2. b^\n> 3. c", "> 1. b^\n> 2. a\n> 3. c"],
  ["stays put on the first item", "> - a^\n> - b", "> - a^\n> - b"],
]);

table("indentListItem in a block quote", indentListItem, [
  ["ordered items nest by the marker width", "> 1. a\n> 2. b^", "> 1. a\n>    1. b^"],
]);

table("indentListItem after a list of another kind", indentListItem, [
  ["a bullet under a numbered item", "1. a\n- b^", "1. a\n   - b^"],
  ["a numbered item under a bullet", "- a\n1. b^", "- a\n  1. b^"],
]);
