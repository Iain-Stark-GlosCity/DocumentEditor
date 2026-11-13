import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { DocumentsStore, OpenDocument } from "../core/documents";
import type { BufferStore } from "./buffers";

export interface EditorPaneProps {
  docId: string | null;
  store: DocumentsStore;
  buffers: BufferStore;
  /** Format-specific extensions for a document. */
  extensionsFor(doc: OpenDocument): Extension[];
  /** Called when a document is shown or its editor state changes. */
  onState(docId: string | null, state: EditorState | null, docChanged: boolean): void;
}

const baseExtensions: Extension[] = [
  history(),
  drawSelection(),
  EditorView.lineWrapping,
  // The buffer is always `\n`; a lone `\r` must stay part of the text (CLAUDE.md rule 1).
  EditorState.lineSeparator.of("\n"),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  search({ top: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  EditorView.contentAttributes.of({ "aria-label": "Document text" }),
];

const emptyState = EditorState.create({
  doc: "",
  extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)],
});

export function EditorPane({ docId, store, buffers, extensionsFor, onState }: EditorPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    const view = new EditorView({ parent: host.current ?? undefined });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (docId === null) {
      view.setState(emptyState);
      onStateRef.current(null, null, false);
      return;
    }
    const doc = store.getState().documents.find((d) => d.id === docId);
    if (!doc) return;
    let state = buffers.get(docId);
    if (!state) {
      state = EditorState.create({
        doc: doc.savedText,
        extensions: [
          ...extensionsFor(doc),
          ...baseExtensions,
          EditorView.updateListener.of((update) => {
            buffers.set(docId, update.state);
            onStateRef.current(docId, update.state, update.docChanged);
          }),
        ],
      });
      buffers.set(docId, state);
    }
    view.setState(state);
    view.focus();
    onStateRef.current(docId, state, false);
  }, [docId, store, buffers, extensionsFor]);

  return <div ref={host} className="editor-host" hidden={docId === null} />;
}
