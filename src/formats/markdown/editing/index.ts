/**
 * Everything that makes typing Markdown pleasant: formatting commands and key bindings, list
 * handling, auto-pairing, URL paste and fence completion.
 *
 * It is all buffer-level CodeMirror (commands, keymaps, input handlers, a transaction filter)
 * over the Lezer syntax tree, so it behaves the same in source and live modes. Each smart
 * behaviour checks its `markdown.*` setting when it runs, so switching one off takes effect
 * immediately without rebuilding the editor.
 */
import type { Extension } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { markdownFormatCommands } from "./commands";
import {
  indentListItem,
  listRenumbering,
  moveListItemDown,
  moveListItemUp,
  outdentListItem,
} from "./lists";
import type { EditCommand, Target } from "./syntax";
import { backspace, enter, typingExtensions } from "./typing";

export { markdownFormatCommands } from "./commands";

/** Reads a setting by key, returning the fallback when it is unknown. */
export type EditingSettings = <T>(key: string, fallback: T) => T;

export function markdownEditing(setting: EditingSettings): Extension {
  const isOn = (key: string) => setting(key, true);
  const when = (key: string, run: EditCommand) => (view: Target) => isOn(key) && run(view);

  return [
    Prec.high(
      keymap.of([
        ...markdownFormatCommands.flatMap((command) =>
          command.defaultKey
            ? [
                {
                  key: command.defaultKey,
                  run: (view: EditorView) => command.run(view),
                  preventDefault: true,
                },
              ]
            : [],
        ),
        { key: "Enter", run: enter(isOn) },
        { key: "Backspace", run: backspace(isOn) },
        { key: "Tab", run: when("markdown.listIndent", indentListItem) },
        { key: "Shift-Tab", run: when("markdown.listIndent", outdentListItem) },
        {
          key: "Alt-ArrowUp",
          run: when("markdown.moveLines", moveListItemUp),
          preventDefault: true,
        },
        {
          key: "Alt-ArrowDown",
          run: when("markdown.moveLines", moveListItemDown),
          preventDefault: true,
        },
      ]),
    ),
    typingExtensions(isOn),
    listRenumbering(() => isOn("markdown.renumberLists")),
  ];
}
