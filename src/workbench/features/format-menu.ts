import type { Feature, MenuItem } from "../feature";

/**
 * The Format menu. It only names command ids: the Markdown provider registers those commands
 * (disabled unless the active document's format supplies them), so nothing here imports from
 * `src/formats` (CLAUDE.md rule 4). Items whose command is not registered are left out.
 */
const items: [group: string, id: string][] = [
  ["1_inline", "markdown.toggleBold"],
  ["1_inline", "markdown.toggleItalic"],
  ["1_inline", "markdown.toggleStrikethrough"],
  ["1_inline", "markdown.toggleInlineCode"],
  ["1_inline", "markdown.insertLink"],
  ["2_headings", "markdown.heading1"],
  ["2_headings", "markdown.heading2"],
  ["2_headings", "markdown.heading3"],
  ["2_headings", "markdown.heading4"],
  ["2_headings", "markdown.heading5"],
  ["2_headings", "markdown.heading6"],
  ["2_headings", "markdown.paragraph"],
  ["2_headings", "markdown.increaseHeading"],
  ["2_headings", "markdown.decreaseHeading"],
  ["3_blocks", "markdown.toggleBlockquote"],
  ["3_blocks", "markdown.toggleBulletList"],
  ["3_blocks", "markdown.toggleNumberedList"],
  ["3_blocks", "markdown.toggleTaskList"],
  ["3_blocks", "markdown.toggleTaskChecked"],
  ["3_blocks", "markdown.toggleCodeBlock"],
  ["3_blocks", "markdown.insertHorizontalRule"],
  ["4_lists", "markdown.indentListItem"],
  ["4_lists", "markdown.outdentListItem"],
  ["4_lists", "markdown.moveItemUp"],
  ["4_lists", "markdown.moveItemDown"],
];

export const formatMenu: Feature = {
  id: "format-menu",
  menuItems: items.map(([group, command], order): MenuItem => ({
    menu: "format",
    group,
    command,
    order,
  })),
};
