import type { Command, CommandRegistry } from "../core/commands";
import type { MenuItem } from "./feature";
import type { Workbench } from "./workbench";
import { formatKey } from "./keys";

export interface MenuEntry {
  command: Command;
  label: string;
  /** Display form of the primary key, for example `Ctrl+S`, or null. */
  keys: string | null;
  /** Present for toggles and radio choices: whether the item is currently on. */
  checked?: (workbench: Workbench) => boolean;
  radio?: boolean;
  /** Label of the submenu this entry belongs to, if any. */
  submenu?: string;
}

export interface MenuModel {
  id: string;
  label: string;
  /** Entries in groups; the UI draws a divider between groups. */
  groups: MenuEntry[][];
}

const KNOWN_MENUS = ["file", "edit", "view"];
const LAST_MENU = "help";
const LABELS: Record<string, string> = {
  file: "File",
  edit: "Edit",
  view: "View",
  help: "Help",
};

function labelFor(id: string): string {
  return LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Builds the menu bar from feature contributions and the command registry. */
export function buildMenus(items: readonly MenuItem[], commands: CommandRegistry): MenuModel[] {
  const byMenu = new Map<string, { item: MenuItem; seq: number }[]>();
  items.forEach((item, seq) => {
    if (!commands.get(item.command)) return;
    const list = byMenu.get(item.menu) ?? [];
    list.push({ item, seq });
    byMenu.set(item.menu, list);
  });

  const extras = [...byMenu.keys()].filter((id) => ![...KNOWN_MENUS, LAST_MENU].includes(id));
  const order = [...KNOWN_MENUS, ...extras, LAST_MENU].filter((id) => byMenu.has(id));

  return order.map((id) => {
    const entries = [...(byMenu.get(id) ?? [])].sort(
      (a, b) =>
        a.item.group.localeCompare(b.item.group) ||
        (a.item.order ?? 100) - (b.item.order ?? 100) ||
        a.seq - b.seq,
    );
    const groups: MenuEntry[][] = [];
    let lastGroup: string | null = null;
    for (const { item } of entries) {
      const command = commands.get(item.command);
      if (!command) continue;
      if (item.group !== lastGroup) {
        groups.push([]);
        lastGroup = item.group;
      }
      groups[groups.length - 1]?.push({
        command,
        label: item.label ?? command.title,
        keys: command.defaultKey ? formatKey(command.defaultKey) : null,
        ...(item.checked ? { checked: item.checked } : {}),
        ...(item.radio ? { radio: true } : {}),
        ...(item.submenu ? { submenu: item.submenu } : {}),
      });
    }
    return { id, label: labelFor(id), groups };
  });
}
