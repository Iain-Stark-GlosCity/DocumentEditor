import {
  describeSnapshot,
  diskIsNewer,
  listMessage,
  newRecoverySession,
  recoveryId,
  snapshotName,
  sortSnapshots,
} from "../../core/recovery";
import { DEFAULT_FILE_FORMAT, type FileData, type RecoverySnapshot } from "../../platform/platform";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

interface Candidate {
  snapshot: RecoverySnapshot;
  /** The file's modified time on disk now, or null if it is gone (or the snapshot is untitled). */
  diskModifiedMs: number | null;
}

/**
 * Crash recovery. While a document has unsaved changes a snapshot of it is written a few
 * seconds after the last edit; it is removed when the document is saved, becomes clean or is
 * closed. After a crash the snapshots are still there, and are offered at the next start.
 */
export const recovery: Feature = {
  id: "recovery",
  activate(wb) {
    const session = newRecoverySession();
    const ids = new Map<string, string>();
    /** Documents that currently have a snapshot on disk. */
    const written = new Set<string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const chains = new Map<string, Promise<void>>();
    let active = true;
    let warned = false;

    const idFor = (docId: string) => {
      let id = ids.get(docId);
      if (!id) ids.set(docId, (id = recoveryId(session, docId)));
      return id;
    };

    /** Snapshot writes and removals for one document run in order. */
    function queue(docId: string, task: () => Promise<void>): Promise<void> {
      const next = (chains.get(docId) ?? Promise.resolve()).then(task).catch((e: unknown) => {
        if (warned) return;
        warned = true;
        wb.notify({
          kind: "warning",
          message: `Crash recovery is not working: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
      chains.set(docId, next);
      return next;
    }

    function cancel(docId: string): void {
      const timer = timers.get(docId);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(docId);
    }

    function clear(docId: string): Promise<void> {
      cancel(docId);
      return queue(docId, async () => {
        if (!written.has(docId)) return;
        written.delete(docId);
        await wb.platform.clearRecovery(idFor(docId));
      });
    }

    function flush(docId: string): Promise<void> {
      const doc = wb.documents.getState().documents.find((d) => d.id === docId);
      if (!doc || !wb.isDirty(docId)) return clear(docId);
      const snapshot: RecoverySnapshot = {
        id: idFor(docId),
        path: doc.path,
        text: wb.getText(docId) ?? "",
        savedMs: Date.now(),
      };
      return queue(docId, async () => {
        await wb.platform.writeRecovery(snapshot);
        written.add(docId);
      });
    }

    function schedule(docId: string, restart: boolean): void {
      if (!restart && timers.has(docId)) return;
      cancel(docId);
      timers.set(
        docId,
        setTimeout(() => {
          timers.delete(docId);
          void flush(docId);
        }, wb.settings.get("files.recoveryIntervalMs")),
      );
    }

    let previousDirty = { ...wb.ui.getState().dirty };
    const offs: (() => void)[] = [
      wb.onDidChangeText((change) => {
        if (wb.isDirty(change.docId)) schedule(change.docId, true);
      }),
      wb.ui.subscribe((state) => {
        for (const [docId, dirty] of Object.entries(state.dirty)) {
          const was = previousDirty[docId] === true;
          if (dirty && !was) schedule(docId, false);
          else if (!dirty && was) void clear(docId);
        }
        previousDirty = { ...state.dirty };
      }),
      wb.onDidSave((event) => {
        if (wb.isDirty(event.docId)) schedule(event.docId, true);
        else void clear(event.docId);
      }),
      wb.onDidCloseDocument((doc) => {
        void clear(doc.id).then(() => ids.delete(doc.id));
      }),
      // The user chose to quit (and, if there were unsaved changes, to discard them).
      wb.onBeforeQuit(async () => {
        await Promise.all([...written].map((docId) => clear(docId)));
      }),
      () => {
        active = false;
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      },
    ];

    for (const doc of wb.documents.getState().documents) {
      if (wb.isDirty(doc.id)) schedule(doc.id, false);
    }

    // `start()` assigns `ready` after features activate, so read it a tick later.
    void Promise.resolve()
      .then(() => wb.ready)
      .then(() => (active ? offerRestore(wb, ids, written) : undefined))
      .catch((e: unknown) => {
        wb.notify({
          kind: "warning",
          message: `Could not check for recovered documents: ${e instanceof Error ? e.message : String(e)}`,
        });
      });

    return () => offs.forEach((off) => off());
  },
};

async function readOrNull(wb: Workbench, path: string | null): Promise<FileData | null> {
  if (path === null) return null;
  try {
    return await wb.platform.readFile(path);
  } catch {
    return null;
  }
}

async function statOrNull(wb: Workbench, path: string | null): Promise<number | null> {
  if (path === null) return null;
  try {
    return (await wb.platform.statFile(path))?.modifiedMs ?? null;
  } catch {
    return null;
  }
}

async function offerRestore(
  wb: Workbench,
  ids: Map<string, string>,
  written: Set<string>,
): Promise<void> {
  const own = new Set(ids.values());
  const snapshots = sortSnapshots((await wb.platform.listRecovery()).filter((s) => !own.has(s.id)));
  if (snapshots.length === 0) return;
  const candidates: Candidate[] = await Promise.all(
    snapshots.map(async (snapshot) => ({
      snapshot,
      diskModifiedMs: await statOrNull(wb, snapshot.path),
    })),
  );
  const describe = (c: Candidate) => describeSnapshot(c.snapshot, c.diskModifiedMs);

  const choice = await wb.ask({
    title: "Recover unsaved work?",
    message: `${listMessage(candidates.map(describe))}\n\nDocumentEditor did not close normally last time.`,
    actions: [
      { value: "restore", label: "Restore all" },
      { value: "discard", label: "Discard all" },
      ...(candidates.length > 1 ? [{ value: "choose", label: "Choose individually…" }] : []),
      { value: "later", label: "Decide later" },
    ],
    cancelValue: "later",
  });

  const toRestore: Candidate[] = [];
  const toDiscard: Candidate[] = [];
  if (choice === "restore") toRestore.push(...candidates);
  else if (choice === "discard") toDiscard.push(...candidates);
  else if (choice === "choose") {
    for (const candidate of candidates) {
      const answer = await wb.ask({
        title: `Recover ${snapshotName(candidate.snapshot)}?`,
        message: describe(candidate),
        actions: [
          { value: "restore", label: "Restore" },
          { value: "discard", label: "Discard" },
          { value: "later", label: "Decide later" },
        ],
        cancelValue: "later",
      });
      if (answer === "restore") toRestore.push(candidate);
      else if (answer === "discard") toDiscard.push(candidate);
    }
  }

  await Promise.all(toDiscard.map((c) => wb.platform.clearRecovery(c.snapshot.id)));

  const blank = blankUntitled(wb);
  let first: string | null = null;
  for (const candidate of toRestore) {
    const id = await restoreOne(wb, candidate, ids, written);
    first ??= id;
  }
  if (first !== null) {
    if (blank !== null) await wb.closeDocument(blank);
    wb.documents.getState().setActive(first);
  }
}

/** The start-up "Untitled" tab, if it is still untouched. */
function blankUntitled(wb: Workbench): string | null {
  const docs = wb.documents.getState().documents;
  const only = docs.length === 1 ? docs[0] : undefined;
  return only && only.path === null && !wb.isDirty(only.id) && wb.getText(only.id) === ""
    ? only.id
    : null;
}

/** Opens a snapshot as a dirty tab. Returns the document id, or null if it was left alone. */
async function restoreOne(
  wb: Workbench,
  { snapshot }: Candidate,
  ids: Map<string, string>,
  written: Set<string>,
): Promise<string | null> {
  const store = wb.documents.getState();
  const provider =
    (snapshot.path ? wb.registry.forPath(snapshot.path) : undefined) ?? wb.registry.all()[0];
  if (!provider) return null;

  let id: string;
  if (snapshot.path === null) {
    id = store.openUntitled(provider.id);
  } else {
    const existing = store.documents.find(
      (d) => d.path !== null && d.path.toLowerCase() === snapshot.path?.toLowerCase(),
    );
    if (existing && wb.isDirty(existing.id)) {
      wb.notify({
        kind: "warning",
        message: `${snapshotName(snapshot)} is already open with unsaved changes, so its recovered copy was left on disk.`,
      });
      return null;
    }
    // The file's own encoding, BOM and line endings come from disk, so Save writes it back as it was.
    const disk = await readOrNull(wb, snapshot.path);
    const data = disk ?? { text: "", format: { ...DEFAULT_FILE_FORMAT }, modifiedMs: 0 };
    id = store.openFromFile(snapshot.path, data, provider.id);
    if (disk === null) {
      wb.documents.getState().setMissing(id, true);
    } else if (diskIsNewer(snapshot, disk.modifiedMs)) {
      // Pretend we last saw the file as it was when the snapshot was taken, so Save asks first.
      wb.documents.getState().applyDisk(id, { ...disk, modifiedMs: snapshot.savedMs });
    }
  }

  wb.replaceText(id, snapshot.text);
  if (wb.isDirty(id)) {
    ids.set(id, snapshot.id);
    written.add(id);
  } else {
    // Nothing differs from the file, so there is nothing left to recover.
    await wb.platform.clearRecovery(snapshot.id);
  }
  return id;
}
