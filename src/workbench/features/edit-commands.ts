import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { Command } from "../../core/commands";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function selectedText(view: EditorView): string {
  const { state } = view;
  return state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => state.sliceDoc(r.from, r.to))
    .join("\n");
}

/** Undo, redo, clipboard and select all, for the menu and palette. */
export const editCommands: Feature = {
  id: "edit-commands",
  commands: (wb: Workbench) => {
    const hasEditor = () => wb.activeDocument() !== null && wb.activeView() !== null;
    // Run against the editor, which must hold focus for selection and caret to be right.
    const onView =
      (fn: (view: EditorView) => void | Promise<void>): (() => void | Promise<void>) =>
      () => {
        const view = wb.activeView();
        if (!view || !wb.activeDocument()) return;
        view.focus();
        return fn(view);
      };

    const copy = async (view: EditorView, cut: boolean) => {
      const text = selectedText(view);
      if (text === "") return;
      await writeClipboard(text);
      if (cut) view.dispatch({ ...view.state.replaceSelection(""), userEvent: "delete.cut" });
    };

    const paste = async (view: EditorView) => {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        wb.notify({
          kind: "warning",
          message: "Paste is not available here. Press Ctrl+V instead.",
        });
        return;
      }
      // The buffer always uses `\n` (CLAUDE.md rule 1).
      text = text.replace(/\r\n?/g, "\n");
      view.dispatch({
        ...view.state.replaceSelection(text),
        userEvent: "input.paste",
        scrollIntoView: true,
      });
    };

    const command = (
      id: string,
      title: string,
      defaultKey: string,
      run: Command["run"],
    ): Command => ({ id, title, defaultKey, nativeKey: true, enabled: hasEditor, run });

    return [
      command(
        "edit.undo",
        "Undo",
        "Mod-z",
        onView((v) => void undo(v)),
      ),
      command(
        "edit.redo",
        "Redo",
        "Mod-y",
        onView((v) => void redo(v)),
      ),
      command(
        "edit.cut",
        "Cut",
        "Mod-x",
        onView((v) => copy(v, true)),
      ),
      command(
        "edit.copy",
        "Copy",
        "Mod-c",
        onView((v) => copy(v, false)),
      ),
      command("edit.paste", "Paste", "Mod-v", onView(paste)),
      command(
        "edit.selectAll",
        "Select all",
        "Mod-a",
        onView((v) => void selectAll(v)),
      ),
    ];
  },
  menuItems: [
    { menu: "edit", group: "1_history", command: "edit.undo", order: 1 },
    { menu: "edit", group: "1_history", command: "edit.redo", order: 2 },
    { menu: "edit", group: "2_clipboard", command: "edit.cut", order: 1 },
    { menu: "edit", group: "2_clipboard", command: "edit.copy", order: 2 },
    { menu: "edit", group: "2_clipboard", command: "edit.paste", order: 3 },
    { menu: "edit", group: "3_select", command: "edit.selectAll" },
  ],
};
