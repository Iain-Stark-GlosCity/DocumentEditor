import { eolStyleName, isStaleOnDisk, judgeDiskChange } from "../../core/disk-change";
import type { OpenDocument } from "../../core/documents";
import type { FileChange } from "../../platform/platform";
import type { Feature } from "../feature";

/**
 * Quiet time after a file-system event before the file is looked at. Editors that save by
 * deleting and renaming produce a "removed" then a "modified" within this window, and a write
 * of our own may be reported just before or after it completes.
 */
const SETTLE_MS = 150;

interface Watch {
  path: string;
  stopped: boolean;
  unwatch: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  sawRemoved: boolean;
  /** The disk modified time a pending conflict was raised for. */
  conflictMs: number | null;
  dismissConflict: (() => void) | null;
  releaseHold: (() => void) | null;
}

/**
 * Watches the file behind each open document. Reloads clean documents when the file changes,
 * asks what to do when there are unsaved changes, copes with deletion, and stops a manual save
 * from silently overwriting changes made elsewhere.
 */
export const externalChanges: Feature = {
  id: "external-changes",
  activate(wb) {
    const watches = new Map<string, Watch>();
    let warnedWatch = false;
    const find = (id: string) => wb.documents.getState().documents.find((d) => d.id === id);

    function resolveConflict(watch: Watch): void {
      watch.dismissConflict?.();
      watch.dismissConflict = null;
      watch.releaseHold?.();
      watch.releaseHold = null;
      watch.conflictMs = null;
    }

    function stop(id: string): void {
      const watch = watches.get(id);
      if (!watch) return;
      watches.delete(id);
      watch.stopped = true;
      if (watch.timer !== null) clearTimeout(watch.timer);
      watch.unwatch?.();
      resolveConflict(watch);
    }

    function start(doc: OpenDocument & { path: string }): void {
      const watch: Watch = {
        path: doc.path,
        stopped: false,
        unwatch: null,
        timer: null,
        sawRemoved: false,
        conflictMs: null,
        dismissConflict: null,
        releaseHold: null,
      };
      watches.set(doc.id, watch);
      wb.platform
        .watchFile(doc.path, (change) => onChange(doc.id, watch, change))
        .then(
          (unwatch) => {
            if (watch.stopped) unwatch();
            else watch.unwatch = unwatch;
          },
          (e: unknown) => {
            if (warnedWatch) return;
            warnedWatch = true;
            wb.notify({
              kind: "warning",
              message: `Changes made outside DocumentEditor to ${doc.title} will not be noticed: ${e instanceof Error ? e.message : String(e)}`,
            });
          },
        );
    }

    /** Starts and stops watchers so exactly the open documents with a path are watched. */
    function sync(): void {
      const docs = wb.documents.getState().documents;
      for (const [id, watch] of [...watches]) {
        const doc = docs.find((d) => d.id === id);
        if (!doc || doc.path !== watch.path) stop(id);
      }
      for (const doc of docs) {
        if (doc.path !== null && !watches.has(doc.id)) start({ ...doc, path: doc.path });
      }
    }

    function onChange(id: string, watch: Watch, change: FileChange): void {
      if (watch.stopped) return;
      if (change.kind === "removed") watch.sawRemoved = true;
      if (watch.timer !== null) clearTimeout(watch.timer);
      watch.timer = setTimeout(() => {
        watch.timer = null;
        void check(id, watch);
      }, SETTLE_MS);
    }

    async function check(id: string, watch: Watch): Promise<void> {
      for (;;) {
        await wb.whenSaveSettled(id);
        if (watch.stopped) return;
        let data;
        try {
          data = await wb.platform.readFile(watch.path);
        } catch {
          // Unreadable. If the platform said it was removed, believe it; otherwise wait for
          // the next event.
          if (!wb.isSaving(id) && watch.sawRemoved) {
            watch.sawRemoved = false;
            markRemoved(id, watch);
          }
          return;
        }
        // A save that began while we were reading would make this read stale: try again.
        if (wb.isSaving(id)) continue;
        watch.sawRemoved = false;
        const doc = find(id);
        if (!doc || watch.stopped) return;
        handleDisk(doc, watch, data);
        return;
      }
    }

    function handleDisk(
      doc: OpenDocument,
      watch: Watch,
      data: Awaited<ReturnType<typeof wb.platform.readFile>>,
    ): void {
      const buffer = wb.getText(doc.id) ?? doc.savedText;
      const verdict = judgeDiskChange({
        knownModifiedMs: doc.modifiedMs,
        diskModifiedMs: data.modifiedMs,
        diskText: data.text,
        bufferText: buffer,
        dirty: wb.isDirty(doc.id),
        missing: doc.missingOnDisk === true,
      });
      switch (verdict) {
        case "unchanged":
          return;
        case "identical":
          resolveConflict(watch);
          wb.documents.getState().applyDisk(doc.id, data);
          return;
        case "reload":
          wb.reloadFromDisk(doc.id, data);
          wb.notify({ message: `${doc.title} changed on disk and was reloaded.` });
          return;
        case "conflict":
          raiseConflict(doc, watch, data.modifiedMs);
          return;
      }
    }

    function raiseConflict(doc: OpenDocument, watch: Watch, diskMs: number): void {
      if (watch.conflictMs === diskMs) return;
      resolveConflict(watch);
      watch.conflictMs = diskMs;
      watch.releaseHold = wb.holdAutosave(doc.id, "disk-conflict");
      const note = wb.notify({
        kind: "warning",
        message: `${doc.title} has changed on disk, and you have unsaved changes here.`,
        actions: [
          { label: "Reload from disk", run: () => void reloadNow(doc.id, watch) },
          // Keeping leaves autosave suspended; the next manual save asks before overwriting.
          { label: "Keep my changes", run: () => {} },
        ],
      });
      watch.dismissConflict = note.dismiss;
    }

    async function reloadNow(id: string, watch: Watch): Promise<void> {
      const doc = find(id);
      if (!doc) return;
      try {
        const data = await wb.platform.readFile(watch.path);
        wb.reloadFromDisk(id, data);
        resolveConflict(watch);
      } catch (e) {
        wb.notify({
          kind: "error",
          message: `Could not reload ${doc.title}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    function markRemoved(id: string, watch: Watch): void {
      const doc = find(id);
      if (!doc || doc.missingOnDisk) return;
      resolveConflict(watch);
      wb.documents.getState().setMissing(id, true);
      wb.notify({
        kind: "warning",
        message: `${doc.title} was deleted or moved outside DocumentEditor. It is still open here; save it to put the file back.`,
      });
    }

    const notifyMixed = (doc: OpenDocument) => {
      if (!doc.format.mixedEol) return;
      wb.notify({
        message: `${doc.title} has mixed line endings. Saving will change them all to ${eolStyleName(doc.format.eol)}, the most common style in the file.`,
      });
    };

    const offs: (() => void)[] = [
      wb.documents.subscribe(sync),
      wb.onDidOpenDocument(notifyMixed),
      wb.onDidSave((event) => {
        const watch = watches.get(event.docId);
        if (watch) resolveConflict(watch);
      }),
      // Refuse (or, for a manual save, confirm) overwriting a file that changed under us.
      wb.addSaveGuard(async ({ doc, path, text, interactive }) => {
        if (path !== doc.path || doc.missingOnDisk) return true;
        let disk;
        try {
          disk = await wb.platform.readFile(path);
        } catch {
          return true; // Gone: saving recreates it.
        }
        if (!isStaleOnDisk(doc.modifiedMs, disk.modifiedMs, disk.text, text)) return true;
        if (!interactive) {
          const watch = watches.get(doc.id);
          if (watch) void check(doc.id, watch);
          return false;
        }
        const choice = await wb.ask({
          title: "Overwrite changes on disk?",
          message: `The file has changed on disk since you opened it. Saving ${doc.title} will replace the version on disk with the text in the editor.`,
          actions: [
            { value: "overwrite", label: "Overwrite" },
            { value: "cancel", label: "Cancel" },
          ],
          cancelValue: "cancel",
        });
        return choice === "overwrite";
      }),
      () => [...watches.keys()].forEach(stop),
    ];

    sync();
    for (const doc of wb.documents.getState().documents) notifyMixed(doc);
    return () => offs.forEach((off) => off());
  },
};
