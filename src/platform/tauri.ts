import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  isExternalUrl,
  FileExistsError,
  type FileChange,
  type FileDragPosition,
  type FilesDroppedEvent,
  type FileData,
  type FileFilter,
  type FileFormat,
  type Platform,
  type RecoverySnapshot,
} from "./platform";

type DragDropPayload = Parameters<
  Parameters<ReturnType<typeof getCurrentWebview>["onDragDropEvent"]>[0]
>[0]["payload"];

/** Tauri reports physical pixels; the DOM works in CSS pixels. */
function cssPosition(position: { x: number; y: number }): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

/** The Rust side rejects `exists: <path>` for a refused overwrite; make that a typed error. */
function asTyped(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (text.startsWith("exists: ")) return new FileExistsError(text.slice("exists: ".length));
  return error instanceof Error ? error : new Error(text);
}

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

  statFile(path: string): Promise<{ modifiedMs: number } | null> {
    return call<{ modifiedMs: number } | null>("stat_file", { path });
  }

  writeFile(path: string, text: string, format: FileFormat): Promise<{ modifiedMs: number }> {
    return call<{ modifiedMs: number }>("write_file", { path, text, format });
  }

  async writeBinaryFile(
    path: string,
    bytes: Uint8Array,
    options: { overwrite: boolean },
  ): Promise<void> {
    // The bytes are the raw request body (no JSON, no base64). Headers must be ASCII, so the
    // path is percent-encoded; Rust decodes it.
    try {
      await invoke<void>("write_binary_file", bytes, {
        headers: {
          "x-path": encodeURIComponent(path),
          "x-overwrite": options.overwrite ? "1" : "0",
        },
      });
    } catch (error) {
      throw asTyped(error);
    }
  }

  async copyFile(from: string, to: string, options: { overwrite: boolean }): Promise<void> {
    try {
      await invoke<void>("copy_file", { from, to, overwrite: options.overwrite });
    } catch (error) {
      throw asTyped(error);
    }
  }

  async fileExists(path: string): Promise<boolean> {
    return (await this.statFile(path)) !== null;
  }

  onFilesDropped(handler: (event: FilesDroppedEvent) => void): Promise<() => void> {
    return this.onDragDrop((payload) => {
      if (payload.type === "drop" && payload.paths.length > 0) {
        handler({ paths: payload.paths, ...cssPosition(payload.position) });
      }
    });
  }

  onFileDragOver(handler: (position: FileDragPosition) => void): Promise<() => void> {
    return this.onDragDrop((payload) => {
      if (payload.type === "enter" || payload.type === "over") {
        handler(cssPosition(payload.position));
      } else {
        handler(null);
      }
    });
  }

  private onDragDrop(handler: (payload: DragDropPayload) => void): Promise<() => void> {
    return getCurrentWebview().onDragDropEvent((event) => handler(event.payload));
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
    // The Rust side tags each watch with an id and puts it in every event, so matching does not
    // depend on how the OS spells the path (case, slashes, verbatim prefix).
    interface Payload {
      id: number;
      kind: FileChange["kind"];
    }
    let watchId: number | null = null;
    const early: Payload[] = []; // Events that arrive before `watch_file` has returned its id.
    const unlisten = await listen<Payload>("file-changed", (event) => {
      if (watchId === null) early.push(event.payload);
      else if (event.payload.id === watchId) onChange({ path, kind: event.payload.kind });
    });
    let id: number;
    try {
      id = await call<number>("watch_file", { path });
    } catch (error) {
      unlisten();
      throw error;
    }
    watchId = id;
    for (const event of early) {
      if (event.id === id) onChange({ path, kind: event.kind });
    }
    return () => {
      unlisten();
      void call<void>("unwatch_file", { id });
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

  async openExternal(url: string): Promise<void> {
    // The capability file restricts schemes as well; this keeps the rule visible in one place.
    if (!isExternalUrl(url)) throw new Error(`Cannot open ${url}`);
    await openUrl(url);
  }

  assetUrl(absolutePath: string): string {
    return convertFileSrc(absolutePath);
  }
}
