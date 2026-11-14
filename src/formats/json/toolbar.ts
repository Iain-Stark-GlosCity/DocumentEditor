/**
 * The JSON toolbar. Icons follow the Markdown toolbar: SVG path data for a 16 by 16 box, line
 * art stroked 1.5 units wide in the current text colour.
 */
import type { ToolbarGroup } from "../../core/format";

const icons = {
  // Lines at two depths: structure made visible.
  format: "M2.5 3.5h11 M5.5 6.5h8 M8 9.5h5.5 M5.5 12.5h8",
  // Two chevrons squeezing towards the middle.
  minify: "M2 8h4 M4 5.75L6.25 8 4 10.25 M14 8h-4 M12 5.75L9.75 8l2.25 2.25",
} as const;

export const jsonToolbar: readonly ToolbarGroup[] = [
  {
    id: "layout",
    label: "Layout",
    items: [
      { command: "json.format", icon: icons.format },
      { command: "json.minify", icon: icons.minify },
    ],
  },
];
