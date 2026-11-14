/**
 * The Markdown formatting toolbar (the ribbon). It names commands by id; titles, tooltips and
 * shortcuts come from the command registry, so none are repeated here.
 *
 * Icons are SVG path data for a 16 by 16 box, drawn as simple line art: stroked 1.5 units wide
 * with round caps and joins, in the current text colour, so one style serves light, dark and
 * high contrast. Nothing here depends on an icon library.
 */
import type { ToolbarGroup, ToolbarOption } from "../../core/format";
import { headingActive } from "./editing/blocks";
import { findTable } from "./tables";

/** A rounded 11 by 11 frame, shared by several icons. */
const FRAME = "M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z";

const icons = {
  bold: "M4.5 2.75h3.75a2.5 2.5 0 0 1 0 5H4.5z M4.5 7.75h4.25a2.75 2.75 0 0 1 0 5.5H4.5z",
  italic: "M6.75 2.75h4.5 M4.75 13.25h4.5 M9.25 2.75l-2.5 10.5",
  strikethrough:
    "M2.5 8h11 M10.9 4.9c-.35-1.25-1.5-2.15-3-2.15-1.7 0-2.9.85-2.9 2.1 0 .75.4 1.3 1.1 1.65 M5.1 11.1c.4 1.25 1.55 2.15 3.05 2.15 1.75 0 2.9-.9 2.9-2.2 0-.45-.15-.8-.4-1.05",
  inlineCode: "M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5 M9.25 3l-2.5 10",
  link: "M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.2-2.2a2.5 2.5 0 0 0-3.54-3.54l-.6.6 M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2.2 2.2a2.5 2.5 0 0 0 3.54 3.54l.6-.6",
  bulletList: "M6.5 4h7.5 M6.5 8h7.5 M6.5 12h7.5 M2.25 4h.5 M2.25 8h.5 M2.25 12h.5",
  numberedList:
    "M6.5 4h7.5 M6.5 8h7.5 M6.5 12h7.5 M2 3.25l1-.75v3 M2 7.25a1 1 0 0 1 2 .1c0 .7-2 1.3-2 2.15h2.1 M2 11.5h1.8l-1 1.1a1 1 0 1 1-.8 1.55",
  taskList: "M2.5 2.5h4v4h-4z M3.4 4.6l.8.8 1.4-1.6 M2.5 9.5h4v4h-4z M9 4.5h5 M9 11.5h5",
  quote:
    "M3 8.5c0-2.2 1-3.6 3-4.2 M3 8.5h3.2v3.2H3z M9.2 8.5c0-2.2 1-3.6 3-4.2 M9.2 8.5h3.2v3.2H9.2z",
  codeBlock: `${FRAME} M6.5 6l-2 2 2 2 M9.5 6l2 2-2 2`,
  rule: "M2 8h12 M5.5 4.5h5 M5.5 11.5h5",
  table: `${FRAME} M2.5 6.5h11 M7 6.5v7`,
  image: `${FRAME} M2.5 11.25l3.5-3.5 2.5 2.5 2-2 3 3 M10.5 5.5h.01`,
  rowAbove: "M8 1.75v3.5 M6.25 3.5h3.5 M2.5 7.5h11v6h-11z M2.5 10.5h11 M8 7.5v6",
  rowBelow: "M2.5 2.5h11v6h-11z M2.5 5.5h11 M8 2.5v6 M8 10.75v3.5 M6.25 12.5h3.5",
  columnLeft: "M1.75 8h3.5 M3.5 6.25v3.5 M7.5 2.5h6v11h-6z M10.5 2.5v11 M7.5 8h6",
  columnRight: "M2.5 2.5h6v11h-6z M5.5 2.5v11 M2.5 8h6 M10.75 8h3.5 M12.5 6.25v3.5",
  deleteRow: "M2.5 3.5h11 M2.5 12.5h11 M2.5 8h2 M7 8h2 M11.5 8h2",
  deleteColumn: "M3.5 2.5v11 M12.5 2.5v11 M8 2.5v2 M8 7v2 M8 11.5v2",
  alignLeft: "M2.5 3.5h11 M2.5 6.5h7 M2.5 9.5h11 M2.5 12.5h7",
  alignCentre: "M2.5 3.5h11 M4.5 6.5h7 M2.5 9.5h11 M4.5 12.5h7",
  alignRight: "M2.5 3.5h11 M6.5 6.5h7 M2.5 9.5h11 M6.5 12.5h7",
  sortAscending: "M2.5 4.5h3 M2.5 8h5 M2.5 11.5h7 M12 12.5V4 M9.5 6.5L12 4l2.5 2.5",
  sortDescending: "M2.5 4.5h7 M2.5 8h5 M2.5 11.5h3 M12 3.5v8.5 M9.5 9.5L12 12l2.5-2.5",
  formatTable: `${FRAME} M2.5 6.25h11 M2.5 9.75h11 M6.25 2.5v11 M9.75 2.5v11`,
} as const;

const button = (command: string, icon: keyof typeof icons) => ({ command, icon: icons[icon] });

const blockTypes: readonly ToolbarOption[] = [
  { command: "markdown.paragraph", label: "Paragraph", active: headingActive(0) },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    command: `markdown.heading${level}`,
    label: `Heading ${level}`,
    active: headingActive(level),
  })),
];

export const markdownToolbar: readonly ToolbarGroup[] = [
  {
    id: "text",
    label: "Text",
    items: [
      button("markdown.toggleBold", "bold"),
      button("markdown.toggleItalic", "italic"),
      button("markdown.toggleStrikethrough", "strikethrough"),
      button("markdown.toggleInlineCode", "inlineCode"),
      button("markdown.insertLink", "link"),
    ],
  },
  { id: "headings", label: "Headings", items: [{ label: "Block type", options: blockTypes }] },
  {
    id: "lists",
    label: "Lists",
    items: [
      button("markdown.toggleBulletList", "bulletList"),
      button("markdown.toggleNumberedList", "numberedList"),
      button("markdown.toggleTaskList", "taskList"),
    ],
  },
  {
    id: "blocks",
    label: "Blocks",
    items: [
      button("markdown.toggleBlockquote", "quote"),
      button("markdown.toggleCodeBlock", "codeBlock"),
      button("markdown.insertHorizontalRule", "rule"),
    ],
  },
  {
    id: "insert",
    label: "Insert",
    items: [button("markdown.table.insert", "table"), button("markdown.insertImage", "image")],
  },
  {
    // Last, so that it appearing and disappearing never moves the other groups.
    id: "table",
    label: "Table",
    visible: (state) => findTable(state, state.selection.main.head) !== null,
    items: [
      button("markdown.table.insertRowAbove", "rowAbove"),
      button("markdown.table.insertRowBelow", "rowBelow"),
      button("markdown.table.insertColumnLeft", "columnLeft"),
      button("markdown.table.insertColumnRight", "columnRight"),
      button("markdown.table.deleteRow", "deleteRow"),
      button("markdown.table.deleteColumn", "deleteColumn"),
      button("markdown.table.alignLeft", "alignLeft"),
      button("markdown.table.alignCentre", "alignCentre"),
      button("markdown.table.alignRight", "alignRight"),
      button("markdown.table.sortAscending", "sortAscending"),
      button("markdown.table.sortDescending", "sortDescending"),
      button("markdown.table.format", "formatTable"),
    ],
  },
];
