import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { CommandRegistry } from "../core/commands";
import type { DocumentsStore } from "../core/documents";
import type { FormatRegistry } from "../core/registry";
import type { SettingsStore } from "../core/settings";
import type { Platform } from "../platform/platform";
import { CommandPalette } from "./CommandPalette";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditorPane } from "./EditorPane";
import { EmptyState } from "./EmptyState";
import type { Feature } from "./feature";
import { defaultFeatures } from "./features";
import { MenuBar } from "./MenuBar";
import { Notifications } from "./Notifications";
import { EditorArea } from "./SidePanes";
import { StatusBar } from "./StatusBar";
import { PANEL_ID, tabId, TabStrip } from "./TabStrip";
import { Workbench } from "./workbench";
import { useZenMode } from "./zen";

export type AppProps =
  | {
      /** A ready-made controller (the App starts and disposes it). */
      workbench: Workbench;
    }
  | {
      platform: Platform;
      registry: FormatRegistry;
      /** Injectable for tests. */
      store?: DocumentsStore;
      commands?: CommandRegistry;
      settings?: SettingsStore;
      /** Default: every feature in `features/index.ts`. */
      features?: readonly Feature[];
      settingsSaveDelayMs?: number;
    };

export function App(props: AppProps) {
  const [workbench] = useState(() =>
    "workbench" in props
      ? props.workbench
      : new Workbench({ ...props, features: props.features ?? defaultFeatures }),
  );

  useEffect(() => {
    workbench.start();
    return () => workbench.dispose();
  }, [workbench]);

  const documents = useStore(workbench.documents, (s) => s.documents);
  const activeId = useStore(workbench.documents, (s) => s.activeId);
  const dirty = useStore(workbench.ui, (s) => s.dirty);
  const dialog = useStore(workbench.ui, (s) => s.dialogs[0] ?? null);
  // Zen mode hides the chrome; the command palette and dialogs still work.
  const zen = useZenMode(workbench);

  return (
    <div className={zen ? "app app--zen" : "app"}>
      {!zen && <MenuBar workbench={workbench} />}
      {!zen && (
        <TabStrip
          documents={documents}
          activeId={activeId}
          dirty={dirty}
          onSelect={(id) => workbench.documents.getState().setActive(id)}
          onClose={(id) => void workbench.closeDocument(id)}
        />
      )}
      <Notifications workbench={workbench} />
      <main
        id={PANEL_ID}
        className="editor-panel"
        role="tabpanel"
        aria-labelledby={activeId && !zen ? tabId(activeId) : undefined}
        aria-label={activeId && !zen ? undefined : "Editor"}
      >
        <EditorArea workbench={workbench}>
          {documents.length === 0 && <EmptyState workbench={workbench} />}
          <EditorPane workbench={workbench} hidden={documents.length === 0} />
        </EditorArea>
      </main>
      {!zen && <StatusBar workbench={workbench} />}
      <CommandPalette workbench={workbench} />
      {workbench.features.flatMap((feature) =>
        (feature.overlays ?? []).map((Overlay, i) => (
          <Overlay key={`${feature.id}:${i}`} workbench={workbench} />
        )),
      )}
      {dialog && (
        <ConfirmDialog
          key={dialog.id}
          title={dialog.title}
          message={dialog.message}
          actions={dialog.actions}
          cancelValue={dialog.cancelValue}
          onChoose={(value) => workbench.resolveDialog(dialog.id, value)}
        />
      )}
    </div>
  );
}
