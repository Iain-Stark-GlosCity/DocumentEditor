/**
 * F6 and Shift+F6 move keyboard focus around the editor and every visible side pane, in the
 * order they appear on screen. This feature must be listed before `preview` in
 * `features/index.ts`: the first enabled command for a key wins, so it takes over F6 from the
 * preview's own editor-and-preview command.
 */
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

const FOCUSABLE =
  "[data-pane-focus], [tabindex='0'], input:not([disabled]), button:not([disabled])";

/** The regions in screen order: left panes, the editor (null), right panes. */
function regions(): (HTMLElement | null)[] {
  const area = document.querySelector(".editor-area");
  if (!area) return [];
  const out: (HTMLElement | null)[] = [];
  for (const child of Array.from(area.children)) {
    if (!(child instanceof HTMLElement) || child.hidden) continue;
    if (child.classList.contains("side-pane")) out.push(child);
    else if (child.classList.contains("editor-main")) out.push(null);
  }
  return out;
}

function cycle(wb: Workbench, direction: 1 | -1): void {
  const list = regions();
  if (list.length < 2) return;
  const active = document.activeElement;
  let at = list.findIndex((region) => region?.contains(active));
  if (at < 0) at = list.indexOf(null);
  const next = list[(at + direction + list.length) % list.length];
  if (next === null || next === undefined) {
    wb.focusEditor();
    return;
  }
  const target =
    next.querySelector<HTMLElement>("[data-pane-focus]") ??
    next.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus();
}

export const paneFocus: Feature = {
  id: "pane-focus",
  commands: (wb) => [
    {
      id: "view.focusNextPane",
      title: "Focus next pane",
      defaultKey: "F6",
      enabled: () => regions().length > 1,
      run: () => cycle(wb, 1),
    },
    {
      id: "view.focusPreviousPane",
      title: "Focus previous pane",
      defaultKey: "Shift-F6",
      enabled: () => regions().length > 1,
      run: () => cycle(wb, -1),
    },
  ],
};
