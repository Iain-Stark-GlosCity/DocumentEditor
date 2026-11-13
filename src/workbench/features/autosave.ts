import { createElement } from "react";
import type { SettingValue } from "../../core/settings";
import type { Feature, FeatureComponentProps } from "../feature";
import { useSetting } from "../hooks";

export type AutoSaveMode = SettingValue<"files.autoSave">;
export type AutoSaveTrigger = "delay" | "focus";

export interface AutoSaveCandidate {
  mode: AutoSaveMode;
  trigger: AutoSaveTrigger;
  /** Untitled documents have no path and are never saved automatically. */
  path: string | null;
  dirty: boolean;
  /** Something (an unresolved conflict, a missing file) asked us to leave the document alone. */
  held: boolean;
  saving: boolean;
}

/** Whether an automatic save should be attempted now. */
export function shouldAutosave(c: AutoSaveCandidate): boolean {
  if (c.mode === "off") return false;
  if (c.trigger === "delay" ? c.mode !== "afterDelay" : c.mode !== "onFocusChange") return false;
  return c.path !== null && c.dirty && !c.held && !c.saving;
}

export function autosaveStateLabel(mode: AutoSaveMode): string {
  if (mode === "afterDelay") return "after delay";
  if (mode === "onFocusChange") return "on focus change";
  return "off";
}

function AutosaveStatus({ workbench }: FeatureComponentProps) {
  const mode = useSetting(workbench, "files.autoSave");
  if (mode === "off") return null;
  return createElement("span", null, `Autosave ${autosaveStateLabel(mode)}`);
}

/** Saves dirty documents that have a path: after a delay, or when focus leaves the editor. */
export const autosave: Feature = {
  id: "autosave",
  statusItems: [{ id: "autosave", order: 40, component: AutosaveStatus }],
  menuItems: [{ menu: "file", group: "2_save", command: "files.toggleAutoSave", order: 10 }],
  activate(wb) {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Documents whose last automatic save failed and which the user has been told about. */
    const reported = new Set<string>();
    const mode = () => wb.settings.get("files.autoSave");

    async function attempt(id: string, trigger: AutoSaveTrigger): Promise<void> {
      const doc = wb.documents.getState().documents.find((d) => d.id === id);
      if (!doc) return;
      const ok = shouldAutosave({
        mode: mode(),
        trigger,
        path: doc.path,
        dirty: wb.isDirty(id),
        held: wb.isAutosaveHeld(id) || doc.missingOnDisk === true,
        saving: wb.isSaving(id),
      });
      if (!ok) return;
      const result = await wb.saveDocument(id, { auto: true });
      if (result.ok) {
        reported.delete(id);
      } else if (result.reason === "error" && !reported.has(id)) {
        reported.add(id);
        wb.notify({
          kind: "error",
          message: `Autosave could not save ${doc.title}: ${result.error ?? "unknown error"}. Your changes are still open.`,
        });
      }
    }

    function cancel(id: string): void {
      const pending = timers.get(id);
      if (pending !== undefined) clearTimeout(pending);
      timers.delete(id);
    }

    function schedule(id: string): void {
      cancel(id);
      if (mode() !== "afterDelay") return;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void attempt(id, "delay");
        }, wb.settings.get("files.autoSaveDelayMs")),
      );
    }

    function clearTimers(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }

    const attemptAll = () => {
      for (const doc of wb.documents.getState().documents) void attempt(doc.id, "focus");
    };

    let previousActive = wb.activeDocument()?.id ?? null;
    const offs: (() => void)[] = [
      wb.onDidChangeText((change) => schedule(change.docId)),
      wb.onDidSave((event) => {
        reported.delete(event.docId);
        cancel(event.docId);
      }),
      wb.onDidCloseDocument((doc) => {
        cancel(doc.id);
        reported.delete(doc.id);
      }),
      wb.onDidChangeActiveDocument((doc) => {
        const left = previousActive;
        previousActive = doc?.id ?? null;
        if (left !== null && left !== previousActive) void attempt(left, "focus");
      }),
      wb.settings.subscribe("files.autoSave", (value) => {
        clearTimers();
        if (value !== "afterDelay") return;
        for (const doc of wb.documents.getState().documents) {
          if (wb.isDirty(doc.id)) schedule(doc.id);
        }
      }),
    ];
    window.addEventListener("blur", attemptAll);
    offs.push(() => window.removeEventListener("blur", attemptAll));
    offs.push(clearTimers);

    // The title carries the state, so the menu and palette show it; re-registering rebuilds both.
    let unregister = () => {};
    const register = () => {
      unregister();
      unregister = wb.commands.register({
        id: "files.toggleAutoSave",
        title: `Autosave: ${autosaveStateLabel(mode())}`,
        run: () => wb.settings.set("files.autoSave", mode() === "off" ? "afterDelay" : "off"),
      });
    };
    register();
    offs.push(wb.settings.subscribe("files.autoSave", register));
    offs.push(() => unregister());

    return () => offs.forEach((off) => off());
  },
};
