import { useActiveEditorState } from "../hooks";
import type { Feature, FeatureComponentProps } from "../feature";

function CursorPosition({ workbench }: FeatureComponentProps) {
  const state = useActiveEditorState(workbench);
  if (!state) return null;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return (
    <span>
      Ln {line.number}, Col {head - line.from + 1}
    </span>
  );
}

/** Line and column of the caret. */
export const statusCursor: Feature = {
  id: "status-cursor",
  statusItems: [{ id: "cursor", order: 10, component: CursorPosition }],
};
