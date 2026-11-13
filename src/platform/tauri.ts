import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  FileChange,
  FileData,
  FileFilter,
  FileFormat,
  Platform,
  RecoverySnapshot,
} from "./platform";

/** Rust commands reject with a plain string; surface it as a proper Error. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Platform backed by the Rust commands in `src-tauri/src/commands.rs`. */
export class TauriPlatform implements Platform {
  readFile(path: string): Promise<FileData> {
    return call<FileData>("read_file", { path });
  }

  writeFile(path: string, text: string, format: FileFormat): Promise<{ modifiedMs: number }> {
    return call<{ modifiedMs: number }>("write_file", { path, text, format });
  }

  async showOpenDialog(options: { filters: FileFilter[]; multiple: boolean }): Promise<string[]> {
    const result = await open({
      multiple: options.multiple,
      directory: false,
      filters: options.filters,
    });
    if (result === null) return [];
    return Array.isArray(result) ? result : [result];
  }

  showSaveDialog(options: { filters: FileFilter[]; defaultPath?: string }): Promise<string | null> {
    return save({ filters: options.filters, defaultPath: options.defaultPath });
  }

  async watchFile(path: string, onChange: (change: FileChange) => void): Promise<() => void> {
    const unlisten = await listen<FileChange>("file-changed", (event) => {
      if (event.payload.path === path) onChange(event.payload);
    });
    try {
      await call<void>("watch_file", { path });
    } catch (error) {
      unlisten();
      throw error;
    }
    return () => {
      unlisten();
      void call<void>("unwatch_file", { path });
    };
  }

  writeRecovery(snapshot: RecoverySnapshot): Promise<void> {
    return call<void>("write_recovery", { snapshot });
  }

  clearRecovery(id: string): Promise<void> {
    return call<void>("clear_recovery", { id });
  }

  listRecovery(): Promise<RecoverySnapshot[]> {
    return call<RecoverySnapshot[]>("list_recovery");
  }

  async onOpenRequest(handler: (paths: string[]) => void): Promise<() => void> {
    // Listen first, then drain what was queued before we were ready, so nothing is lost.
    const unlisten = await listen<string[]>("open-request", (event) => handler(event.payload));
    const queued = await call<string[]>("take_open_requests");
    if (queued.length > 0) handler(queued);
    return unlisten;
  }

  onCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
    return getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await handler())) event.preventDefault();
    });
  }

  setWindowTitle(title: string): Promise<void> {
    return getCurrentWindow().setTitle(title);
  }

  readSettings(): Promise<string | null> {
    return call<string | null>("read_settings");
  }

  writeSettings(json: string): Promise<void> {
    return call<void>("write_settings", { json });
  }
}
