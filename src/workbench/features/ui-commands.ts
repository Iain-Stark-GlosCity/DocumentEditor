import type { Feature } from "../feature";

/** Command palette and menu bar focus. */
export const uiCommands: Feature = {
  id: "ui-commands",
  commands: (wb) => [
    {
      id: "view.commandPalette",
      title: "Command palette",
      defaultKey: "Mod-Shift-p",
      altKeys: ["F1"],
      run: () => wb.openPalette(),
    },
    {
      id: "view.focusMenuBar",
      title: "Focus menu bar",
      defaultKey: "F10",
      run: () => wb.requestMenuFocus(),
    },
  ],
  menuItems: [{ menu: "view", group: "9_palette", command: "view.commandPalette" }],
};
