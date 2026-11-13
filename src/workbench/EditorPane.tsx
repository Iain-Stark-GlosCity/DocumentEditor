import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Workbench } from "./workbench";

/** Hosts the single CodeMirror view. The workbench decides which document it shows. */
export function EditorPane({ workbench, hidden }: { workbench: Workbench; hidden: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = new EditorView({ parent: host.current ?? undefined });
    const detach = workbench.attachView(view);
    return () => {
      detach();
      view.destroy();
    };
  }, [workbench]);

  // The host is hidden while no document is open, and a hidden element cannot take focus. So
  // when it comes back, move focus into it (the workbench only focuses on document changes).
  useEffect(() => {
    if (!hidden) workbench.focusEditor();
  }, [hidden, workbench]);

  return <div ref={host} className="editor-host" hidden={hidden} />;
}
