/**
 * Shows which format the active document is treated as, and lets the user change it: a status
 * bar button and the `file.changeFormat` command, both opening a quick pick of the registered
 * formats. Changing the format never touches the text, so the document stays as dirty (or as
 * clean) as it was; the workbench rebuilds the editor for the new format.
 */
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument } from "../hooks";
import type { Workbench } from "../workbench";

const COMMAND_ID = "file.changeFormat";

/** Asks which format to use and applies it. Resolves false if the pick was dismissed. */
export async function changeFormat(wb: Workbench): Promise<boolean> {
  const doc = wb.activeDocument();
  if (!doc) return false;
  const chosen = await wb.pick(
    wb.registry.all().map((provider) => ({
      value: provider.id,
      label: provider.name,
      detail: provider.fileExtensions[0] ? `.${provider.fileExtensions[0]}` : undefined,
      checked: provider.id === doc.providerId,
    })),
    { title: "Change format", placeholder: "Choose a format" },
  );
  if (chosen === null) return false;
  // The document may have been closed while the pick was open.
  if (!wb.documents.getState().documents.some((d) => d.id === doc.id)) return false;
  wb.documents.getState().setProvider(doc.id, chosen);
  return true;
}

function FormatStatus({ workbench }: FeatureComponentProps) {
  const doc = useActiveDocument(workbench);
  if (!doc) return null;
  const name = workbench.registry.byId(doc.providerId)?.name ?? doc.providerId;
  return (
    <button
      type="button"
      className="format-button"
      aria-label={`Format: ${name}. Change format`}
      title="Change format"
      aria-haspopup="dialog"
      onClick={() => void workbench.runCommand(COMMAND_ID)}
    >
      {name}
    </button>
  );
}

export const formatSwitcher: Feature = {
  id: "format-switcher",

  commands: (wb) => [
    {
      id: COMMAND_ID,
      title: "Change format…",
      enabled: () => wb.activeDocument() !== null,
      run: () => void changeFormat(wb),
    },
  ],

  statusItems: [{ id: "format", align: "right", order: 8, component: FormatStatus }],

  menuItems: [{ menu: "edit", group: "8_format", command: COMMAND_ID }],
};
