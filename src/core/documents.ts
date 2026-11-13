import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileData, FileFormat } from "../platform/platform";
import { DEFAULT_FILE_FORMAT } from "../platform/platform";

export interface OpenDocument {
  id: string;
  /** Absolute path, or null until the document has been saved. */
  path: string | null;
  providerId: string;
  format: FileFormat;
  /** Text as last read from or written to disk (`\n` line endings). */
  savedText: string;
  modifiedMs: number;
  /** File name, or `Untitled-n`. */
  title: string;
}

/**
 * Dirty state is not stored here: the editor buffer lives in CodeMirror, so the workbench
 * derives it by comparing the buffer text to `savedText`.
 */
export interface DocumentsState {
  documents: OpenDocument[];
  activeId: string | null;
  /** Returns the id of the new document. */
  openUntitled(providerId: string): string;
  /** Returns the id of the document, which is an existing one if the path is already open. */
  openFromFile(path: string, data: FileData, providerId: string): string;
  markSaved(id: string, path: string, text: string, modifiedMs: number): void;
  close(id: string): void;
  setActive(id: string): void;
}

export type DocumentsStore = StoreApi<DocumentsState>;

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Windows paths are case-insensitive; treat them so everywhere. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function createDocumentsStore(): DocumentsStore {
  let nextId = 1;
  let untitledCount = 0;
  const newId = () => `doc-${nextId++}`;

  return createStore<DocumentsState>()((set, get) => ({
    documents: [],
    activeId: null,

    openUntitled(providerId) {
      const id = newId();
      untitledCount += 1;
      const doc: OpenDocument = {
        id,
        path: null,
        providerId,
        format: { ...DEFAULT_FILE_FORMAT },
        savedText: "",
        modifiedMs: 0,
        title: `Untitled-${untitledCount}`,
      };
      set((s) => ({ documents: [...s.documents, doc], activeId: id }));
      return id;
    },

    openFromFile(path, data, providerId) {
      const existing = get().documents.find((d) => d.path !== null && samePath(d.path, path));
      if (existing) {
        set({ activeId: existing.id });
        return existing.id;
      }
      const id = newId();
      const doc: OpenDocument = {
        id,
        path,
        providerId,
        format: data.format,
        savedText: data.text,
        modifiedMs: data.modifiedMs,
        title: baseName(path),
      };
      set((s) => ({ documents: [...s.documents, doc], activeId: id }));
      return id;
    },

    markSaved(id, path, text, modifiedMs) {
      set((s) => ({
        documents: s.documents.map((d) =>
          d.id === id ? { ...d, path, savedText: text, modifiedMs, title: baseName(path) } : d,
        ),
      }));
    },

    close(id) {
      set((s) => {
        const index = s.documents.findIndex((d) => d.id === id);
        if (index < 0) return s;
        const documents = s.documents.filter((d) => d.id !== id);
        let activeId = s.activeId;
        if (activeId === id) {
          activeId = documents[Math.min(index, documents.length - 1)]?.id ?? null;
        }
        return { documents, activeId };
      });
    },

    setActive(id) {
      if (get().documents.some((d) => d.id === id)) set({ activeId: id });
    },
  }));
}
