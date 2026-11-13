import { EditorView } from "@codemirror/view";
import type { Feature } from "../feature";

/**
 * Spelling checks for the editor, using the platform's built-in checker (WebView2). Autocorrect
 * and auto-capitalisation are off, so the editor never rewrites what the user typed.
 */
export const spellcheck: Feature = {
  id: "spellcheck",
  reconfigureOn: ["editor.spellcheck"],
  editorExtensions: (_doc, wb) =>
    EditorView.contentAttributes.of({
      spellcheck: wb.settings.get("editor.spellcheck") ? "true" : "false",
      autocorrect: "off",
      autocapitalize: "off",
    }),
  commands: (wb) => [
    {
      id: "edit.toggleSpellcheck",
      title: "Toggle spellcheck",
      run: () => wb.settings.set("editor.spellcheck", !wb.settings.get("editor.spellcheck")),
    },
  ],
  menuItems: [{ menu: "edit", group: "7_proofing", command: "edit.toggleSpellcheck" }],
};
