/**
 * "Clean up this file…": the guided repairs a format offers for a container file (see
 * src/core/repair.ts). It lists the ones that apply, shows what the chosen one will change, asks,
 * and then saves it in one verified write (one backup, only the listed parts touched). The plan is
 * worked out from the file's bytes as they are now, and the save is refused if the file has
 * changed since. The format decides everything about the repairs; this file only drives them.
 */
import { splitContainerPath } from "../../core/container-path";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

export const CLEAN_UP_COMMAND = "file.cleanUp";

const baseName = (path: string) =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** The container behind the active document if its format offers repairs, else null. */
export function repairableContainer(wb: Workbench): string | null {
  const doc = wb.activeDocument();
  if (!doc?.path) return null;
  try {
    const container = wb.platform.containers?.containerOf(doc.path) ?? null;
    if (container === null) return null;
    const provider = wb.registry.forPath(container);
    return provider?.kind === "text" && provider.binary?.repairs ? container : null;
  } catch {
    return null;
  }
}

/** Open documents of this container (the view and its parts) that have unsaved edits. */
function unsavedParts(wb: Workbench, container: string): string[] {
  const lower = container.toLowerCase();
  const out: string[] = [];
  for (const doc of wb.documents.getState().documents) {
    if (!doc.path || !wb.isDirty(doc.id)) continue;
    const split = splitContainerPath(doc.path);
    if ((split ? split.container : doc.path).toLowerCase() === lower) out.push(doc.title);
  }
  return out;
}

/** Runs the whole flow. Resolves true if a repair was applied. */
export async function cleanUp(wb: Workbench): Promise<boolean> {
  const container = repairableContainer(wb);
  const provider = container ? wb.registry.forPath(container) : undefined;
  const repairs = provider?.kind === "text" ? provider.binary?.repairs : undefined;
  const access = wb.platform.containers;
  if (!container || !repairs || !access) {
    wb.notify({ message: "This file has no clean-ups." });
    return false;
  }
  const file = baseName(container);

  const unsaved = unsavedParts(wb, container);
  if (unsaved.length > 0) {
    wb.notify({
      kind: "warning",
      message: `Save or close ${unsaved.join(", ")} first: it has unsaved changes that a clean-up would conflict with.`,
    });
    return false;
  }

  let bytes: Uint8Array;
  let offers;
  try {
    bytes = (await wb.platform.readBinaryFile(container)).bytes;
    offers = await repairs.offers(bytes, { path: container });
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not check ${file}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
  if (offers.length === 0) {
    wb.notify({ message: `Nothing to clean up in ${file}.` });
    return false;
  }

  const id = await wb.pick(
    offers.map((o) => ({ value: o.id, label: o.title, detail: o.summary })),
    { title: "Clean up", placeholder: "Choose a clean-up" },
  );
  if (id === null) return false;

  let plan;
  try {
    plan = await repairs.plan(bytes, { path: container, id });
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not prepare that clean-up: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
  if (!plan) {
    wb.notify({ message: "That clean-up no longer applies. Nothing was changed." });
    return false;
  }

  const lines = [
    ...plan.details,
    ...(plan.skipped.length > 0 ? ["", "Left alone:", ...plan.skipped.map((s) => `• ${s}`)] : []),
    "",
    `This is saved straight into ${file} and cannot be undone in the editor. A backup copy is kept beside it the first time (${file}.bak).`,
  ];
  const choice = await wb.ask({
    title: `${plan.title}?`,
    message: lines.join("\n"),
    actions: [
      { value: "apply", label: "Apply" },
      { value: "cancel", label: "Cancel" },
    ],
    cancelValue: "cancel",
    initialFocus: "cancel",
  });
  if (choice !== "apply") return false;

  // The tabs may have been edited while the dialog was open.
  const unsavedNow = unsavedParts(wb, container);
  if (unsavedNow.length > 0) {
    wb.notify({
      kind: "warning",
      message: `Save or close ${unsavedNow.join(", ")} first. Nothing was changed.`,
    });
    return false;
  }
  try {
    await access.replaceParts(container, plan.changes, { basis: bytes });
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not apply the clean-up: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
  wb.notify({
    message: `${plan.title}: done. ${file} was saved; the view updates when the file reloads.`,
  });
  return true;
}

export const cleanUpFeature: Feature = {
  id: "clean-up",

  commands: (wb) => [
    {
      id: CLEAN_UP_COMMAND,
      title: "Clean up this file…",
      enabled: () => repairableContainer(wb) !== null,
      run: () => void cleanUp(wb),
    },
  ],

  menuItems: [{ menu: "file", group: "4_cleanup", command: CLEAN_UP_COMMAND }],
};
