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
  decreaseHeading,
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
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleStrikethrough,
} from "./inline";
import { indentListItem, moveListItemDown, moveListItemUp, outdentListItem } from "./lists";
import type { EditCommand } from "./syntax";

function command(id: string, title: string, run: EditCommand, defaultKey?: string): FormatCommand {
  return { id: `markdown.${id}`, title, ...(defaultKey ? { defaultKey } : {}), run };
}

const headings = ([1, 2, 3, 4, 5, 6] as const).map((level) =>
  command(`heading${level}`, `Heading ${level}`, setHeading(level), `Mod-${level}`),
);

export const markdownFormatCommands: readonly FormatCommand[] = [
  command("toggleBold", "Bold", toggleBold, "Mod-b"),
  command("toggleItalic", "Italic", toggleItalic, "Mod-i"),
  command("toggleStrikethrough", "Strikethrough", toggleStrikethrough, "Mod-Shift-x"),
  command("toggleInlineCode", "Inline code", toggleInlineCode, "Mod-e"),
  command("insertLink", "Link", toggleLink, "Mod-k"),
  ...headings,
  command("paragraph", "Paragraph", setParagraph, "Mod-Shift-0"),
  command("increaseHeading", "Increase heading level", increaseHeading),
  command("decreaseHeading", "Decrease heading level", decreaseHeading),
  command("toggleBlockquote", "Blockquote", toggleBlockquote, "Mod-Shift-."),
  command("toggleBulletList", "Bulleted list", toggleBulletList, "Mod-Shift-8"),
  command("toggleNumberedList", "Numbered list", toggleNumberedList, "Mod-Shift-7"),
  command("toggleTaskList", "Task list", toggleTaskList, "Mod-Shift-9"),
  {
    // Only on a task line: elsewhere Mod-Enter belongs to the editor (a blank line below, or
    // "leave the table" inside one), so the key must not be claimed here.
    ...command("toggleTaskChecked", "Mark task done or not done", toggleTaskChecked, "Mod-Enter"),
    enabled: selectionHasTask,
  },
  command("toggleCodeBlock", "Code block", toggleCodeBlock),
  command("insertHorizontalRule", "Horizontal rule", insertHorizontalRule),
  command("indentListItem", "Indent list item", indentListItem),
  command("outdentListItem", "Outdent list item", outdentListItem),
  command("moveItemUp", "Move line or list item up", moveListItemUp),
  command("moveItemDown", "Move line or list item down", moveListItemDown),
];
