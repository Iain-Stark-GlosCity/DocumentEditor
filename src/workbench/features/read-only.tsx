/**
 * View-only documents (a format with `readOnly: true`, such as the generated Formatting view of a
 * DOCX). The editor refusing edits, Save being unavailable and the document never counting as
 * unsaved are enforced by the workbench; this feature only tells the user about it, with a
 * status bar item whose tooltip says why.
 */
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument } from "../hooks";

export const READ_ONLY_EXPLANATION =
  "This is a generated view, so it cannot be edited or saved. Use Save as… to keep a text copy.";

function ReadOnlyStatus({ workbench }: FeatureComponentProps) {
  const doc = useActiveDocument(workbench);
  if (!doc || !workbench.isReadOnly(doc)) return null;
  return (
    <span
      className="read-only-status"
      role="note"
      tabIndex={0}
      aria-label={`Read-only. ${READ_ONLY_EXPLANATION}`}
      title={READ_ONLY_EXPLANATION}
    >
      Read-only
    </span>
  );
}

export const readOnly: Feature = {
  id: "read-only",
  statusItems: [{ id: "read-only", order: 5, component: ReadOnlyStatus }],
};
