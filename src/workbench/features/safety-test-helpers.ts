/** Shared setup for the autosave, recovery and external-change tests. Not part of the app. */
import { vi } from "vitest";
import { MemoryPlatform } from "../../platform/memory";
import type { FileFormat, RecoverySnapshot } from "../../platform/platform";
import type { Feature } from "../feature";
import { makeWorkbench } from "../test-helpers";
import type { Workbench } from "../workbench";

const started: Workbench[] = [];

export function disposeAll(): void {
  for (const workbench of started.splice(0)) workbench.dispose();
}

export interface BootOptions {
  features: readonly Feature[];
  files?: Record<string, string | { text: string; format: FileFormat }>;
  /** Paths opened at start-up, as if passed on the command line. */
  open?: string[];
  snapshots?: RecoverySnapshot[];
  platform?: MemoryPlatform;
}

/** Call after `vi.useFakeTimers()`. */
export async function boot(options: BootOptions) {
  const platform = options.platform ?? new MemoryPlatform();
  for (const [path, file] of Object.entries(options.files ?? {})) {
    if (typeof file === "string") platform.seedFile(path, file);
    else platform.seedFile(path, file.text, file.format);
  }
  for (const snapshot of options.snapshots ?? []) platform.recovery.set(snapshot.id, snapshot);
  if (options.open?.length) platform.requestOpen(options.open);
  const { workbench } = makeWorkbench({ platform, features: options.features });
  started.push(workbench);
  workbench.start();
  await settle(1);
  const id = workbench.activeDocument()?.id ?? "";
  return { platform, workbench, id };
}

export const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

export const messages = (workbench: Workbench) =>
  workbench.ui.getState().notifications.map((n) => n.message);

/** Answers the dialog on top with the action `value`. */
export async function answerDialog(workbench: Workbench, value: string): Promise<void> {
  await settle(0);
  const dialog = workbench.ui.getState().dialogs[0];
  if (!dialog) throw new Error("No dialog is open");
  workbench.resolveDialog(dialog.id, value);
  await settle(0);
}

/** Clicks a notification's action button. */
export function pressAction(workbench: Workbench, label: string): void {
  for (const note of workbench.ui.getState().notifications) {
    const action = note.actions?.find((a) => a.label === label);
    if (action) {
      workbench.dismissNotification(note.id);
      action.run();
      return;
    }
  }
  throw new Error(`No notification action "${label}"`);
}
