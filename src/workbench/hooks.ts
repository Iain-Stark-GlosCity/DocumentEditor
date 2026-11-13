/** React hooks over the Workbench, for use by components and features. */
import type { EditorState } from "@codemirror/state";
import { useCallback, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { Command } from "../core/commands";
import type { OpenDocument } from "../core/documents";
import type { SettingKey, SettingValue } from "../core/settings";
import type { Workbench } from "./workbench";

/** A setting's current value; re-renders when it changes. */
export function useSetting<K extends SettingKey>(workbench: Workbench, key: K): SettingValue<K> {
  const subscribe = useCallback(
    (onChange: () => void) => workbench.settings.subscribe(key, onChange),
    [workbench, key],
  );
  return useSyncExternalStore(subscribe, () => workbench.settings.get(key));
}

/** The active document, or null. */
export function useActiveDocument(workbench: Workbench): OpenDocument | null {
  return useStore(workbench.documents, (s) => s.documents.find((d) => d.id === s.activeId) ?? null);
}

/** The active document's EditorState (re-renders on every edit and selection change). */
export function useActiveEditorState(workbench: Workbench): EditorState | null {
  const subscribe = useCallback(
    (onChange: () => void) => workbench.onEditorUpdate(onChange),
    [workbench],
  );
  return useSyncExternalStore(subscribe, () => workbench.activeEditorState());
}

/** All registered commands; re-renders when commands are added or removed. */
export function useCommands(workbench: Workbench): readonly Command[] {
  return useSyncExternalStore(
    (onChange) => workbench.commands.subscribe(onChange),
    () => workbench.commands.all(),
  );
}
