/**
 * The XML toolbar. Icons follow the Markdown and JSON toolbars: SVG path data for a 16 by 16 box,
 * line art stroked 1.5 units wide in the current text colour.
 */
import type { ToolbarGroup } from "../../core/format";

const icons = {
  // Lines at stepped depths: tags laid out by nesting.
  tidy: "M2.5 3.5h11 M5 6.5h8.5 M7.5 9.5h6 M5 12.5h8.5",
} as const;

export const xmlToolbar: readonly ToolbarGroup[] = [
  {
    id: "layout",
    label: "Layout",
    items: [{ command: "xml.format", icon: icons.tidy }],
  },
];
