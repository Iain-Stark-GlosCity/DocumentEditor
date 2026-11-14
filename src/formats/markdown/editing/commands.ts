/**
 * The Markdown formatting commands contributed to the workbench through `FormatProvider.commands`.
 *
 * Key notes: Mod-0 already resets zoom (`view.zoomReset`), so "Paragraph" takes Mod-Shift-0.
 * Mod-Enter toggles a task and otherwise inserts a blank line, as it always did. Tab, Shift-Tab
 * and Alt-Up/Down are bound by the editor keymap only (see `index.ts`), not here: a global Tab
 * binding would trap keyboard focus, and the editor keymap can honour their settings switches.
 */
import type { FormatCommand } from "../../../core/format";
import {
  bulletListActive,
  codeBlockActive,
  decreaseHeading,
  headingActive,
  numberedListActive,
  selectionQuoted,
  taskListActive,
  increaseHeading,
  insertHorizontalRule,
  setHeading,
  setParagraph,
  toggleBlockquote,
  toggleBulletList,
  toggleCodeBlock,
  toggleNumberedList,
  toggleTaskList,
  toggleTaskChecked,
  selectionHasTask,
} from "./blocks";
import {
  boldActive,
  inlineCodeActive,
  italicActive,
  linkActive,
  strikethroughActive,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleStrikethrough,
} from "./inline";
import { indentListItem, moveListItemDown, moveListItemUp, outdentListItem } from "./lists";
import type { EditCommand } from "./syntax";

function command(
  id: string,
  title: string,
  run: EditCommand,
  defaultKey?: string,
  active?: FormatCommand["active"],
): FormatCommand {
  return {
    id: `markdown.${id}`,
    title,
    ...(defaultKey ? { defaultKey } : {}),
    ...(active ? { active } : {}),
    run,
  };
}

const headings = ([1, 2, 3, 4, 5, 6] as const).map((level) =>
  command(
    `heading${level}`,
    `Heading ${level}`,
    setHeading(level),
    `Mod-${level}`,
    headingActive(level),
  ),
);

export const markdownFormatCommands: readonly FormatCommand[] = [
  command("toggleBold", "Bold", toggleBold, "Mod-b", boldActive),
  command("toggleItalic", "Italic", toggleItalic, "Mod-i", italicActive),
  command(
    "toggleStrikethrough",
    "Strikethrough",
    toggleStrikethrough,
    "Mod-Shift-x",
    strikethroughActive,
  ),
  command("toggleInlineCode", "Inline code", toggleInlineCode, "Mod-e", inlineCodeActive),
  command("insertLink", "Link", toggleLink, "Mod-k", linkActive),
  ...headings,
  command("paragraph", "Paragraph", setParagraph, "Mod-Shift-0", headingActive(0)),
  command("increaseHeading", "Increase heading level", increaseHeading),
  command("decreaseHeading", "Decrease heading level", decreaseHeading),
  command("toggleBlockquote", "Blockquote", toggleBlockquote, "Mod-Shift-.", (state) =>
    selectionQuoted(state),
  ),
  command("toggleBulletList", "Bulleted list", toggleBulletList, "Mod-Shift-8", bulletListActive),
  command(
    "toggleNumberedList",
    "Numbered list",
    toggleNumberedList,
    "Mod-Shift-7",
    numberedListActive,
  ),
  command("toggleTaskList", "Task list", toggleTaskList, "Mod-Shift-9", taskListActive),
  {
    // Only on a task line: elsewhere Mod-Enter belongs to the editor (a blank line below, or
    // "leave the table" inside one), so the key must not be claimed here.
    ...command("toggleTaskChecked", "Mark task done or not done", toggleTaskChecked, "Mod-Enter"),
    enabled: selectionHasTask,
  },
  command("toggleCodeBlock", "Code block", toggleCodeBlock, undefined, codeBlockActive),
  command("insertHorizontalRule", "Horizontal rule", insertHorizontalRule),
  command("indentListItem", "Indent list item", indentListItem),
  command("outdentListItem", "Outdent list item", outdentListItem),
  command("moveItemUp", "Move line or list item up", moveListItemUp),
  command("moveItemDown", "Move line or list item down", moveListItemDown),
];
