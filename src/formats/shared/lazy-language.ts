import { Compartment, type Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";

/**
 * A language for the editor that is loaded when first needed, so its grammar stays out of the
 * startup bundle and out of the render worker (CLAUDE.md rule 6). Use it for a format's
 * `editorExtensions`:
 *
 *     const language = lazyLanguage(() => import("@codemirror/lang-json").then((m) => m.json()));
 *     editorExtensions: () => [language()]
 *
 * The first editor shows plain text for a moment and then switches to the loaded language; later
 * editors start with it already in place. A failed load leaves the text as plain text.
 */
export function lazyLanguage(load: () => Promise<Extension>): () => Extension {
  const slot = new Compartment();
  let ready: Extension | undefined;
  let pending: Promise<Extension> | undefined;

  return () => [
    slot.of(ready ?? []),
    ViewPlugin.define((view) => {
      let alive = true;
      if (ready === undefined) {
        pending ??= load().then((extension) => (ready = extension));
        pending.then(
          (extension) => {
            if (alive) view.dispatch({ effects: slot.reconfigure(extension) });
          },
          () => {
            // Leave the text as plain text; the file is still fully editable.
          },
        );
      }
      return {
        destroy() {
          alive = false;
        },
      };
    }),
  ];
}
