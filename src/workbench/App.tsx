import type { EditorState } from "@codemirror/state";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { CommandRegistry } from "../core/commands";
import { createDocumentsStore, type DocumentsStore, type OpenDocument } from "../core/documents";
import type { FormatRegistry } from "../core/registry";
import type { FileFilter, Platform } from "../platform/platform";
import { BufferStore } from "./buffers";
import { ConfirmDialog, type DialogRequest } from "./ConfirmDialog";
import { EditorPane } from "./EditorPane";
import { matchesKey } from "./keys";
import { StatusBar } from "./StatusBar";
import { PANEL_ID, tabId, TabStrip } from "./TabStrip";

export interface AppProps {
  platform: Platform;
  registry: FormatRegistry;
  /** Injectable for tests. */
  store?: DocumentsStore;
  commands?: CommandRegistry;
}

type PendingDialog = DialogRequest & { resolve(value: string): void };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function App(props: AppProps) {
  const { platform, registry } = props;
  const [store] = useState(() => props.store ?? createDocumentsStore());
  const [commands] = useState(() => props.commands ?? new CommandRegistry());
  const [buffers] = useState(() => new BufferStore());

  const documents = useStore(store, (s) => s.documents);
  const activeId = useStore(store, (s) => s.activeId);
  const active = documents.find((d) => d.id === activeId) ?? null;

  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirtyNow = useCallback(
    (id: string) => {
      const doc = store.getState().documents.find((d) => d.id === id);
      const text = buffers.text(id);
      return doc !== undefined && text !== undefined && text !== doc.savedText;
    },
    [store, buffers],
  );

  const refreshDirty = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const d of store.getState().documents) next[d.id] = isDirtyNow(d.id);
    setDirty((prev) => {
      const keys = Object.keys(next);
      const same =
        keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });
  }, [store, isDirtyNow]);

  useEffect(() => store.subscribe(refreshDirty), [store, refreshDirty]);

  const ask = useCallback(
    (request: DialogRequest) =>
      new Promise<string>((resolve) => {
        setDialog({ ...request, resolve });
      }),
    [],
  );

  const filters = useCallback((): FileFilter[] => {
    const known = registry.all().map((p) => ({ name: p.name, extensions: [...p.fileExtensions] }));
    return [...known, { name: "All files", extensions: ["*"] }];
  }, [registry]);

  const extensionsFor = useCallback(
    (doc: OpenDocument) =>
      registry.byId(doc.providerId)?.editorExtensions({
        mode: "source",
        path: doc.path,
        setting: (_key, fallback) => fallback,
      }) ?? [],
    [registry],
  );

  const onEditorState = useCallback(
    (docId: string | null, state: EditorState | null, docChanged: boolean) => {
      if (docId === null || state === null) {
        setCursor(null);
        return;
      }
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const next = { line: line.number, col: head - line.from + 1 };
      setCursor((prev) => (prev && prev.line === next.line && prev.col === next.col ? prev : next));
      if (docChanged) refreshDirty();
    },
    [refreshDirty],
  );

  // File operations -----------------------------------------------------------------------

  const writeTo = useCallback(
    async (doc: OpenDocument, path: string, text: string): Promise<boolean> => {
      try {
        const { modifiedMs } = await platform.writeFile(path, text, doc.format);
        store.getState().markSaved(doc.id, path, text, modifiedMs);
        return true;
      } catch (e) {
        setError(`Could not save ${path}: ${message(e)}`);
        return false;
      }
    },
    [platform, store],
  );

  const saveAs = useCallback(
    async (id: string): Promise<boolean> => {
      const doc = store.getState().documents.find((d) => d.id === id);
      const text = buffers.text(id);
      if (!doc || text === undefined) return false;
      const ext = registry.byId(doc.providerId)?.fileExtensions[0];
      const defaultPath = doc.path ?? (ext ? `${doc.title}.${ext}` : doc.title);
      const path = await platform.showSaveDialog({ filters: filters(), defaultPath });
      if (path === null) return false;
      return writeTo(doc, path, text);
    },
    [store, buffers, registry, platform, filters, writeTo],
  );

  const save = useCallback(
    async (id: string): Promise<boolean> => {
      const doc = store.getState().documents.find((d) => d.id === id);
      const text = buffers.text(id);
      if (!doc || text === undefined) return false;
      if (doc.path === null) return saveAs(id);
      return writeTo(doc, doc.path, text);
    },
    [store, buffers, saveAs, writeTo],
  );

  const openPaths = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        try {
          const provider = registry.forPath(path) ?? registry.all()[0];
          if (!provider) throw new Error("No document formats are registered");
          const data = await platform.readFile(path);
          // An untouched "Untitled" tab is replaced rather than left beside the new file.
          const docs = store.getState().documents;
          const only = docs.length === 1 ? docs[0] : undefined;
          const replaceable = only && only.path === null && !isDirtyNow(only.id) ? only.id : null;
          store.getState().openFromFile(path, data, provider.id);
          if (replaceable) {
            buffers.delete(replaceable);
            store.getState().close(replaceable);
          }
        } catch (e) {
          setError(`Could not open ${path}: ${message(e)}`);
        }
      }
    },
    [registry, platform, store, buffers, isDirtyNow],
  );

  const closeDocument = useCallback(
    async (id: string) => {
      const doc = store.getState().documents.find((d) => d.id === id);
      if (!doc) return;
      if (isDirtyNow(id)) {
        store.getState().setActive(id);
        const choice = await ask({
          title: `Save changes to ${doc.title}?`,
          message: "Your changes will be lost if you do not save them.",
          actions: [
            { value: "save", label: "Save" },
            { value: "discard", label: "Do not save" },
            { value: "cancel", label: "Cancel" },
          ],
          cancelValue: "cancel",
        });
        if (choice === "cancel") return;
        if (choice === "save" && !(await save(id))) return;
      }
      buffers.delete(id);
      store.getState().close(id);
    },
    [store, buffers, isDirtyNow, ask, save],
  );

  // Commands and keybindings --------------------------------------------------------------

  useEffect(() => {
    const defaultProvider = () => registry.all()[0];
    const activeDoc = () => store.getState().activeId;
    const offs = [
      commands.register({
        id: "file.new",
        title: "New file",
        defaultKey: "Mod-n",
        run: () => {
          const provider = defaultProvider();
          if (provider) store.getState().openUntitled(provider.id);
        },
      }),
      commands.register({
        id: "file.open",
        title: "Open file",
        defaultKey: "Mod-o",
        run: async () => {
          const paths = await platform.showOpenDialog({ filters: filters(), multiple: true });
          await openPaths(paths);
        },
      }),
      commands.register({
        id: "file.save",
        title: "Save",
        defaultKey: "Mod-s",
        run: async () => {
          const id = activeDoc();
          if (id) await save(id);
        },
      }),
      commands.register({
        id: "file.saveAs",
        title: "Save as",
        defaultKey: "Mod-Shift-s",
        run: async () => {
          const id = activeDoc();
          if (id) await saveAs(id);
        },
      }),
      commands.register({
        id: "file.close",
        title: "Close tab",
        defaultKey: "Mod-w",
        run: async () => {
          const id = activeDoc();
          if (id) await closeDocument(id);
        },
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [commands, registry, store, platform, filters, openPaths, save, saveAs, closeDocument]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialog) return;
      for (const command of commands.all()) {
        if (command.defaultKey && matchesKey(event, command.defaultKey)) {
          event.preventDefault();
          commands.execute(command.id).catch((e: unknown) => setError(message(e)));
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands, dialog]);

  // Platform hooks ------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    platform
      .onOpenRequest((paths) => void openPaths(paths))
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;
        const provider = registry.all()[0];
        if (provider && store.getState().documents.length === 0) {
          store.getState().openUntitled(provider.id);
        }
      })
      .catch((e: unknown) => setError(message(e)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [platform, registry, store, openPaths]);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    platform
      .onCloseRequested(async () => {
        const unsaved = store.getState().documents.filter((d) => isDirtyNow(d.id));
        if (unsaved.length === 0) return true;
        const names = unsaved.map((d) => d.title).join(", ");
        const choice = await ask({
          title: "Close without saving?",
          message: `These documents have unsaved changes: ${names}.`,
          actions: [
            { value: "close", label: "Close and discard changes" },
            { value: "cancel", label: "Cancel" },
          ],
          cancelValue: "cancel",
        });
        return choice === "close";
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch((e: unknown) => setError(message(e)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [platform, store, isDirtyNow, ask]);

  const activeDirty = active ? dirty[active.id] === true : false;
  useEffect(() => {
    const title = active
      ? `${activeDirty ? "● " : ""}${active.title} - DocumentEditor`
      : "DocumentEditor";
    document.title = title;
    platform.setWindowTitle(title).catch(() => {});
  }, [platform, active, activeDirty]);

  return (
    <div className="app">
      <TabStrip
        documents={documents}
        activeId={activeId}
        dirty={dirty}
        onSelect={(id) => store.getState().setActive(id)}
        onClose={(id) => void closeDocument(id)}
      />
      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <main
        id={PANEL_ID}
        className="editor-panel"
        role="tabpanel"
        aria-labelledby={activeId ? tabId(activeId) : undefined}
        aria-label={activeId ? undefined : "Editor"}
      >
        {documents.length === 0 && (
          <p className="empty">
            No document open. Press Ctrl+N for a new file or Ctrl+O to open one.
          </p>
        )}
        <EditorPane
          docId={activeId}
          store={store}
          buffers={buffers}
          extensionsFor={extensionsFor}
          onState={onEditorState}
        />
      </main>
      <StatusBar cursor={cursor} format={active?.format ?? null} />
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          actions={dialog.actions}
          cancelValue={dialog.cancelValue}
          onChoose={(value) => {
            setDialog(null);
            dialog.resolve(value);
          }}
        />
      )}
    </div>
  );
}
