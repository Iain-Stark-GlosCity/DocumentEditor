import type { Extension } from "@codemirror/state";
import { lazyExtension } from "../../core/lazy-extension";
import type { DataEditingOptions } from "./data-editing-impl";

export type { DataEditingOptions } from "./data-editing-impl";

/**
 * Indentation by spaces, a fold gutter with fold keys, bracket matching and closing brackets for
 * a structured text format (JSON, YAML). Tab and Shift-Tab indent and outdent, so they no longer
 * move focus out of the editor; Escape then Tab (within two seconds) does, which is CodeMirror's
 * own way out, and F6 cycles the panes.
 *
 * Loaded on demand, so its libraries stay out of the startup bundle and the render worker.
 */
export function dataEditing(options: DataEditingOptions): Extension {
  return lazyExtension(() =>
    import("./data-editing-impl").then((m) => m.dataEditingExtensions(options)),
  );
}
