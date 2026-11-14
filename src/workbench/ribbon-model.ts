/**
 * What the ribbon shows, as plain data. The active document's provider declares a toolbar
 * (`FormatProvider.toolbar`); this turns it into groups of items with their current enabled and
 * pressed state, titles and shortcuts taken from the command registry. No React in here, so it
 * is easy to test, and nothing format-specific: the workbench only follows the declaration.
 */
import type { EditorState } from "@codemirror/state";
import type { FormatCommand, TextFormatProvider, ToolbarGroup } from "../core/format";
import { formatKey } from "./keys";
import type { Workbench } from "./workbench";

export interface ButtonModel {
  kind: "button";
  /** Unique within the ribbon. */
  key: string;
  command: string;
  icon: string;
  /** The command's title: the accessible name and the tooltip text. */
  title: string;
  /** Display form of the shortcut, for example `Ctrl+B`, or null. */
  keys: string | null;
  enabled: boolean;
  /** Pressed state for a toggle; null for a plain button. */
  pressed: boolean | null;
}

export interface OptionModel {
  command: string;
  label: string;
  keys: string | null;
  enabled: boolean;
  active: boolean;
}

export interface SelectModel {
  kind: "select";
  key: string;
  label: string;
  /** Text of the option that applies now. */
  value: string;
  options: OptionModel[];
  enabled: boolean;
}

export type ItemModel = ButtonModel | SelectModel;

export interface GroupModel {
  id: string;
  label: string;
  items: ItemModel[];
}

const commandLookups = new WeakMap<TextFormatProvider, Map<string, FormatCommand>>();

function formatCommand(provider: TextFormatProvider, id: string): FormatCommand | undefined {
  let lookup = commandLookups.get(provider);
  if (!lookup) {
    lookup = new Map((provider.commands ?? []).map((c) => [c.id, c]));
    commandLookups.set(provider, lookup);
  }
  return lookup.get(id);
}

function groupModel(
  wb: Workbench,
  provider: TextFormatProvider,
  group: ToolbarGroup,
  state: EditorState,
): GroupModel {
  const items: ItemModel[] = [];
  for (const item of group.items) {
    if ("command" in item) {
      const command = wb.commands.get(item.command);
      if (!command) continue;
      const enabled = command.enabled ? command.enabled() : true;
      const active = formatCommand(provider, item.command)?.active;
      items.push({
        kind: "button",
        key: `button:${item.command}`,
        command: item.command,
        icon: item.icon,
        title: command.title,
        keys: command.defaultKey ? formatKey(command.defaultKey) : null,
        enabled,
        pressed: active ? enabled && active(state) : null,
      });
      continue;
    }
    const options: OptionModel[] = [];
    for (const option of item.options) {
      const command = wb.commands.get(option.command);
      if (!command) continue;
      options.push({
        command: option.command,
        label: option.label,
        keys: command.defaultKey ? formatKey(command.defaultKey) : null,
        enabled: command.enabled ? command.enabled() : true,
        active: option.active ? option.active(state) : false,
      });
    }
    const first = options[0];
    if (!first) continue;
    items.push({
      kind: "select",
      key: `select:${item.label}`,
      label: item.label,
      value: (options.find((o) => o.active) ?? first).label,
      options,
      enabled: options.some((o) => o.enabled),
    });
  }
  return { id: group.id, label: group.label, items };
}

/** The groups to show now. Empty when no document is open or its format has no toolbar. */
export function ribbonGroups(wb: Workbench): GroupModel[] {
  const doc = wb.activeDocument();
  if (!doc) return [];
  const provider = wb.registry.byId(doc.providerId);
  if (!provider?.toolbar || provider.toolbar.length === 0) return [];
  const state = wb.activeEditorState();
  if (!state) return [];
  return provider.toolbar
    .filter((group) => !group.visible || group.visible(state))
    .map((group) => groupModel(wb, provider, group, state))
    .filter((group) => group.items.length > 0);
}

function signatureOf(groups: readonly GroupModel[]): string {
  const parts: string[] = [];
  for (const group of groups) {
    parts.push(`#${group.id}`);
    for (const item of group.items) {
      if (item.kind === "button") {
        parts.push(
          `${item.key}|${item.title}|${item.keys ?? ""}|${item.enabled ? 1 : 0}${item.pressed ?? "-"}`,
        );
      } else {
        const opts = item.options.map((o) => `${o.command}${o.enabled ? 1 : 0}`).join(",");
        parts.push(`${item.key}|${item.value}|${item.enabled ? 1 : 0}|${opts}`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * A store for `useSyncExternalStore`. It recomputes the groups after any editor, document or
 * command change but hands back the same array until something the ribbon shows differs, so a
 * keystroke that changes nothing visible re-renders nothing.
 */
export function createRibbonStore(wb: Workbench) {
  let signature = "";
  let groups: GroupModel[] = [];
  return {
    subscribe(onChange: () => void): () => void {
      const stops = [
        wb.onEditorUpdate(onChange),
        wb.documents.subscribe(onChange),
        wb.commands.subscribe(onChange),
      ];
      return () => stops.forEach((stop) => stop());
    },
    getSnapshot(): GroupModel[] {
      const next = ribbonGroups(wb);
      const sig = signatureOf(next);
      if (sig !== signature) {
        signature = sig;
        groups = next;
      }
      return groups;
    },
  };
}

// Layout --------------------------------------------------------------------------------------
// Sizes in CSS pixels. They mirror `ribbon.css`, where the buttons, the heading picker and the
// dividers have fixed widths, so the fit can be worked out without measuring each group.

export const RIBBON_SIZES = {
  button: 30,
  gap: 2,
  select: 112,
  /** A divider: its line plus the margin either side. */
  divider: 13,
  more: 30,
  /** Spare room, so rounding never pushes the last item out. */
  slack: 2,
} as const;

export function groupWidth(group: GroupModel): number {
  const { button, gap, select } = RIBBON_SIZES;
  const widths = group.items.map((item) => (item.kind === "button" ? button : select));
  return widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
}

/**
 * How many groups, from the start, fit in `available` pixels. If they do not all fit, room is
 * kept for the More button. Returns `groups.length` when everything fits, and 0 when not even
 * the first group does. Without a width yet (`null`) everything is assumed to fit.
 */
export function groupsThatFit(groups: readonly GroupModel[], available: number | null): number {
  if (available === null) return groups.length;
  const { divider, more, slack } = RIBBON_SIZES;
  const widths = groups.map(groupWidth);
  const total = widths.reduce((sum, w) => sum + w, 0) + divider * Math.max(0, groups.length - 1);
  if (total + slack <= available) return groups.length;
  const room = available - slack - divider - more;
  let used = 0;
  let count = 0;
  for (const [i, width] of widths.entries()) {
    const needed = width + (i > 0 ? divider : 0);
    if (used + needed > room) break;
    used += needed;
    count++;
  }
  return count;
}
