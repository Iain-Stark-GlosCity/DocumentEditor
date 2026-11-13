import type { Feature, MenuItem } from "../feature";

/**
 * Places the table commands (registered by the Markdown provider) in the Format menu. If that
 * menu does not exist the items still appear, in a menu of that name before Help.
 */
const items: readonly [string, string, string][] = [
  ["8_table1", "markdown.table.insert", "Insert table"],
  ["8_table1", "markdown.table.pasteAsTable", "Paste clipboard as table"],
  ["8_table1", "markdown.table.format", "Format table"],
  ["8_table2", "markdown.table.insertRowAbove", "Insert row above"],
  ["8_table2", "markdown.table.insertRowBelow", "Insert row below"],
  ["8_table2", "markdown.table.deleteRow", "Delete row"],
  ["8_table2", "markdown.table.moveRowUp", "Move row up"],
  ["8_table2", "markdown.table.moveRowDown", "Move row down"],
  ["8_table3", "markdown.table.insertColumnLeft", "Insert column left"],
  ["8_table3", "markdown.table.insertColumnRight", "Insert column right"],
  ["8_table3", "markdown.table.deleteColumn", "Delete column"],
  ["8_table3", "markdown.table.moveColumnLeft", "Move column left"],
  ["8_table3", "markdown.table.moveColumnRight", "Move column right"],
  ["8_table4", "markdown.table.alignLeft", "Align column left"],
  ["8_table4", "markdown.table.alignCentre", "Centre column"],
  ["8_table4", "markdown.table.alignRight", "Align column right"],
  ["8_table4", "markdown.table.alignNone", "Clear column alignment"],
  ["8_table5", "markdown.table.sortAscending", "Sort by column, ascending"],
  ["8_table5", "markdown.table.sortDescending", "Sort by column, descending"],
];

export const tableMenu: Feature = {
  id: "table-menu",
  menuItems: items.map(([group, command, label], order): MenuItem => ({
    menu: "format",
    group,
    command,
    label: `Table: ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
    order,
  })),
};
