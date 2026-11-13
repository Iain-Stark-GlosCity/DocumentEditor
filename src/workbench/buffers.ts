import type { EditorState } from "@codemirror/state";

/** Each open document's CodeMirror state, kept while its tab is in the background. */
export class BufferStore {
  private readonly states = new Map<string, EditorState>();

  get(id: string): EditorState | undefined {
    return this.states.get(id);
  }

  set(id: string, state: EditorState): void {
    this.states.set(id, state);
  }

  delete(id: string): void {
    this.states.delete(id);
  }

  /** Current buffer text (always `\n` line endings), or undefined if never shown. */
  text(id: string): string | undefined {
    return this.states.get(id)?.doc.toString();
  }
}
