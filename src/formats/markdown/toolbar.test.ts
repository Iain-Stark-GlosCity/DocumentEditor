import { describe, expect, it } from "vitest";
import type { FormatCommand } from "../../core/format";
import { markdownProvider } from "./index";
import { makeState } from "./editing/testing";
import { markdownToolbar } from "./toolbar";

const commands = new Map((markdownProvider.commands ?? []).map((c) => [c.id, c]));
const command = (id: string): FormatCommand => {
  const found = commands.get(`markdown.${id}`);
  if (!found) throw new Error(`no command ${id}`);
  return found;
};
/** Escapes the pipes of a table so the notation reads them as characters. */
const table = (text: string): string => text.replaceAll("|", "\\|");
const active = (id: string, notation: string): boolean =>
  command(id).active?.(makeState(notation)) ?? false;

describe("active detection", () => {
  it.each([
    ["toggleBold", "a **b^old** c", true],
    ["toggleBold", "a **bold** ^c", false],
    ["toggleBold", "a *i^tal* c", false],
    ["toggleBold", "a |**bold**| c", true],
    ["toggleItalic", "a *i^tal* c", true],
    ["toggleItalic", "a **b^old** c", false],
    ["toggleStrikethrough", "a ~~go^ne~~ c", true],
    ["toggleStrikethrough", "a go^ne c", false],
    ["toggleInlineCode", "a `co^de` c", true],
    ["toggleInlineCode", "a co^de c", false],
    ["insertLink", "a [te^xt](https://x.org) c", true],
    ["insertLink", "a te^xt c", false],
  ] as const)("%s in %j is %s", (id, notation, expected) => {
    expect(active(id, notation)).toBe(expected);
  });

  it("is inactive when only some selection ranges are inside the construct", () => {
    expect(active("toggleBold", "**a^** b^")).toBe(false);
    expect(active("toggleBold", "**a^** **b^**")).toBe(true);
  });

  it.each([
    ["toggleBlockquote", "> qu^ote", true],
    ["toggleBlockquote", "pl^ain", false],
    ["toggleBulletList", "- it^em", true],
    ["toggleBulletList", "1. it^em", false],
    ["toggleBulletList", "- [ ] it^em", false],
    ["toggleNumberedList", "1. it^em", true],
    ["toggleNumberedList", "- it^em", false],
    ["toggleTaskList", "- [x] it^em", true],
    ["toggleTaskList", "- it^em", false],
    ["toggleCodeBlock", "```\nco^de\n```", true],
    ["toggleCodeBlock", "pl^ain", false],
  ] as const)("%s in %j is %s", (id, notation, expected) => {
    expect(active(id, notation)).toBe(expected);
  });

  it("treats a multi-line selection as a list only when every line is an item", () => {
    expect(active("toggleBulletList", "|- a\n- b|")).toBe(true);
    expect(active("toggleBulletList", "|- a\nb|")).toBe(false);
  });

  it.each([
    ["paragraph", "pl^ain", true],
    ["paragraph", "# He^ad", false],
    ["heading1", "# He^ad", true],
    ["heading2", "# He^ad", false],
    ["heading3", "### He^ad", true],
    ["heading2", "Setext^\n---", true],
    ["heading1", "- # In^ list", true],
    ["paragraph", "```\n# no^t\n```", true],
  ] as const)("%s at %j is %s", (id, notation, expected) => {
    expect(active(id, notation)).toBe(expected);
  });

  it("has no pressed state for commands that insert", () => {
    expect(command("insertHorizontalRule").active).toBeUndefined();
  });
});

describe("the markdown toolbar", () => {
  it("names only commands the provider or workbench registers, and has a table group last", () => {
    const ids = new Set(commands.keys());
    const unknown = markdownToolbar
      .flatMap((g) => g.items)
      .flatMap((item) => ("command" in item ? [item.command] : item.options.map((o) => o.command)))
      // Image insertion is a workbench command, not a format command.
      .filter((id) => !ids.has(id) && id !== "markdown.insertImage");
    expect(unknown).toEqual([]);
    expect(markdownToolbar.map((g) => g.id)).toEqual([
      "text",
      "headings",
      "lists",
      "blocks",
      "insert",
      "table",
    ]);
    expect(markdownToolbar.at(-1)?.visible).toBeTypeOf("function");
  });

  it("shows the table group only in a table", () => {
    const group = markdownToolbar.find((g) => g.id === "table");
    const inTable = makeState(table("| a | b |\n| - | - |\n| ^1 | 2 |"));
    expect(group?.visible?.(inTable)).toBe(true);
    expect(group?.visible?.(makeState("pl^ain"))).toBe(false);
  });

  it("marks the column alignment under the cursor", () => {
    const state = makeState(table("| a | b |\n| :- | -: |\n| 1 | 2^ |"));
    expect(command("table.alignRight").active?.(state)).toBe(true);
    expect(command("table.alignLeft").active?.(state)).toBe(false);
  });
});
