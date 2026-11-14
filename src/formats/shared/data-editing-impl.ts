import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export interface DataEditingOptions {
  /** Spaces per level of indentation. */
  indent: number;
  /** Close and skip over brackets and quotes as they are typed. */
  closeBrackets: boolean;
}

function marker(open: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = open ? "cm-fold-open" : "cm-fold-closed";
  span.textContent = open ? "▾" : "▸";
  span.title = open ? "Fold" : "Unfold";
  return span;
}

/**
 * What a structured text format (JSON, YAML) needs from the editor and the base editor does not
 * give it: indentation by spaces, a fold gutter with fold keys and bracket matching.
 *
 * Tab and Shift-Tab indent and outdent, so they no longer move focus out of the editor. Escape
 * followed by Tab (within two seconds) does, which is CodeMirror's own way out, and F6 cycles the
 * panes.
 */
export function dataEditingExtensions(options: DataEditingOptions): Extension {
  return [
    indentUnit.of(" ".repeat(options.indent)),
    keymap.of([
      { key: "Tab", run: indentMore },
      { key: "Shift-Tab", run: indentLess },
      ...(options.closeBrackets ? closeBracketsKeymap : []),
      ...foldKeymap,
    ]),
    bracketMatching(),
    options.closeBrackets ? closeBrackets() : [],
    foldGutter({ markerDOM: marker }),
  ];
}
