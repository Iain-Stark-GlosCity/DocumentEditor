import { Compartment, type Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";

/**
 * An extension that is loaded when the editor first needs it, so the code behind it stays out of
 * the startup bundle and out of the render worker (CLAUDE.md rule 6). The editor starts without
 * it and gains it a moment later, keeping caret and undo history. A failed load leaves the
 * editor as it was.
 *
 * Unlike `lazyLanguage` (src/formats/shared/lazy-language.ts), which loads one extension and
 * shares it, the loaded module is asked for a fresh extension for each editor. Use this when the
 * extension depends on options that differ per editor.
 */
export function lazyExtension(load: () => Promise<Extension>): Extension {
  const slot = new Compartment();
  return [
    slot.of([]),
    ViewPlugin.define((view) => {
      let alive = true;
      load().then(
        (extension) => {
          if (alive) view.dispatch({ effects: slot.reconfigure(extension) });
        },
        () => {
          // The text stays fully editable without it.
        },
      );
      return {
        destroy() {
          alive = false;
        },
      };
    }),
  ];
}
