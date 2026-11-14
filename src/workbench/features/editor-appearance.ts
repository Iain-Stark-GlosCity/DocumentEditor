import { EditorView, lineNumbers } from "@codemirror/view";
import { SETTINGS_SCHEMA } from "../../core/settings";
import type { Feature } from "../feature";

const FONT_MIN = 8;
const FONT_MAX = 40;

/** Word wrap, line numbers and font size, applied live, with the commands that change them. */
export const editorAppearance: Feature = {
  id: "editor-appearance",
  reconfigureOn: ["editor.wordWrap", "editor.lineNumbers", "editor.fontSize"],
  editorExtensions: (_doc, wb) => [
    wb.settings.get("editor.wordWrap") ? EditorView.lineWrapping : [],
    wb.settings.get("editor.lineNumbers") ? lineNumbers() : [],
    EditorView.theme({ "&": { fontSize: `${wb.settings.get("editor.fontSize")}px` } }),
  ],
  commands: (wb) => {
    const zoom = (delta: number) => () => {
      const next = Math.min(
        FONT_MAX,
        Math.max(FONT_MIN, wb.settings.get("editor.fontSize") + delta),
      );
      wb.settings.set("editor.fontSize", next);
    };
    return [
      {
        id: "view.toggleWordWrap",
        title: "Toggle word wrap",
        defaultKey: "Alt-z",
        run: () => wb.settings.set("editor.wordWrap", !wb.settings.get("editor.wordWrap")),
      },
      {
        id: "view.toggleLineNumbers",
        title: "Toggle line numbers",
        run: () => wb.settings.set("editor.lineNumbers", !wb.settings.get("editor.lineNumbers")),
      },
      { id: "view.zoomIn", title: "Zoom in", defaultKey: "Mod-=", run: zoom(1) },
      { id: "view.zoomOut", title: "Zoom out", defaultKey: "Mod--", run: zoom(-1) },
      {
        id: "view.zoomReset",
        title: "Reset zoom",
        defaultKey: "Mod-0",
        run: () => wb.settings.set("editor.fontSize", SETTINGS_SCHEMA["editor.fontSize"].default),
      },
    ];
  },
  menuItems: [
    {
      menu: "view",
      group: "1_editor",
      command: "view.toggleWordWrap",
      order: 1,
      label: "Word wrap",
      checked: (wb) => wb.settings.get("editor.wordWrap"),
    },
    {
      menu: "view",
      group: "1_editor",
      command: "view.toggleLineNumbers",
      order: 2,
      label: "Line numbers",
      checked: (wb) => wb.settings.get("editor.lineNumbers"),
    },
    { menu: "view", group: "2_zoom", command: "view.zoomIn", order: 1 },
    { menu: "view", group: "2_zoom", command: "view.zoomOut", order: 2 },
    { menu: "view", group: "2_zoom", command: "view.zoomReset", order: 3 },
  ],
};
