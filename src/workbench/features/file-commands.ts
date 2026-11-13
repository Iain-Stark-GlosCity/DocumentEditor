import type { Feature } from "../feature";

/** New, open, save, save as and close. */
export const fileCommands: Feature = {
  id: "file-commands",
  commands: (wb) => {
    const hasDocument = () => wb.activeDocument() !== null;
    return [
      { id: "file.new", title: "New file", defaultKey: "Mod-n", run: () => void wb.newFile() },
      { id: "file.open", title: "Open file…", defaultKey: "Mod-o", run: () => wb.openDialog() },
      {
        id: "file.save",
        title: "Save",
        defaultKey: "Mod-s",
        enabled: hasDocument,
        run: async () => void (await wb.save()),
      },
      {
        id: "file.saveAs",
        title: "Save as…",
        defaultKey: "Mod-Shift-s",
        enabled: hasDocument,
        run: async () => void (await wb.saveAs()),
      },
      {
        id: "file.close",
        title: "Close tab",
        defaultKey: "Mod-w",
        enabled: hasDocument,
        run: async () => void (await wb.closeDocument()),
      },
    ];
  },
  menuItems: [
    { menu: "file", group: "1_new", command: "file.new", order: 1 },
    { menu: "file", group: "1_new", command: "file.open", order: 2 },
    { menu: "file", group: "2_save", command: "file.save", order: 1 },
    { menu: "file", group: "2_save", command: "file.saveAs", order: 2 },
    { menu: "file", group: "3_close", command: "file.close" },
  ],
};
