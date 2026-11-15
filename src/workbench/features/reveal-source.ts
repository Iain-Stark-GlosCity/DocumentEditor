/**
 * "Reveal in source XML": from a line of a generated view (the Formatting view of a DOCX) to the
 * element that line was made from, opened as an editable tab of the part. The view carries a
 * source map (`src/core/source-map.ts`); this command looks up the cursor's line in it and asks the
 * workbench to reveal the part at the entry's locator.
 */
import { joinContainerPath } from "../../core/container-path";
import { sourceFor, type SourceMapEntry } from "../../core/source-map";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

export const REVEAL_SOURCE_COMMAND = "view.revealSource";

/** The source map entry for the cursor's line in the active document, if there is one. */
export function sourceAtCursor(wb: Workbench): SourceMapEntry | undefined {
  const doc = wb.activeDocument();
  if (!doc?.path || !doc.sourceMap) return undefined;
  const state = wb.activeEditorState();
  if (!state) return undefined;
  return sourceFor(doc.sourceMap, state.doc.lineAt(state.selection.main.head).number);
}

/** Opens the part and element behind the cursor's line. Returns false if there is none. */
export async function revealSource(wb: Workbench): Promise<boolean> {
  const doc = wb.activeDocument();
  const entry = sourceAtCursor(wb);
  if (!doc?.path || !entry) return false;
  return wb.revealPart(joinContainerPath(doc.path, entry.part), entry.locator);
}

export const revealSourceFeature: Feature = {
  id: "reveal-source",

  commands: (wb) => [
    {
      id: REVEAL_SOURCE_COMMAND,
      title: "Reveal in source XML",
      defaultKey: "Mod-Alt-x",
      enabled: () => sourceAtCursor(wb) !== undefined,
      run: async () => void (await revealSource(wb)),
    },
  ],

  menuItems: [
    {
      menu: "view",
      group: "5_source",
      command: REVEAL_SOURCE_COMMAND,
      label: "Reveal in source XML",
    },
  ],
};
