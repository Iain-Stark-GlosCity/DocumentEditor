import type { Feature } from "../feature";

/**
 * The formatting ribbon is drawn by `Ribbon.tsx` from the active document's provider; this
 * feature is its switch: the `ui.ribbon` setting, a command and a ticked View menu item.
 * (Zen mode hides it with the rest of the chrome, in `App.tsx`.)
 */
export const ribbon: Feature = {
  id: "ribbon",
  commands: (wb) => [
    {
      id: "view.toggleRibbon",
      title: "Toggle ribbon",
      run: () => wb.settings.set("ui.ribbon", !wb.settings.get("ui.ribbon")),
    },
  ],
  menuItems: [
    {
      menu: "view",
      group: "1_editor",
      command: "view.toggleRibbon",
      order: 10,
      label: "Ribbon",
      checked: (wb) => wb.settings.get("ui.ribbon"),
    },
  ],
};
