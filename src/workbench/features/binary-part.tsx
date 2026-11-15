/**
 * Looking at a binary part of a container (an image, a font, an embedded object): a dialog that
 * says what it is and how big, previews it when it is a picture, and saves a copy to disk. The
 * part's bytes are read afresh from the file. The preview is a `data:` URL in an `<img>`, which
 * the strict CSP already allows and which can never run script.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { joinContainerPath } from "../../core/container-path";
import type { Feature, FeatureComponentProps } from "../feature";
import type { Workbench } from "../workbench";

/** Pictures larger than this are described but not previewed. */
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
};

export interface BinaryPartInfo {
  container: string;
  /** Name inside the archive. */
  part: string;
  /** The file name part of `part`. */
  name: string;
  size: number;
  /** `data:` URL for a picture small enough to show, else null. */
  preview: string | null;
  bytes: Uint8Array;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeKind(name: string): string {
  const ext = extensionOf(name);
  if (IMAGE_TYPES[ext]) return `${ext.toUpperCase()} picture`;
  if (["ttf", "otf", "odttf", "woff", "woff2"].includes(ext)) return "Font";
  if (["emf", "wmf"].includes(ext)) return "Windows metafile picture";
  if (ext === "bin") return "Embedded object or binary data";
  return ext ? `${ext.toUpperCase()} data` : "Binary data";
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

let current: BinaryPartInfo | null = null;
const listeners = new Set<() => void>();
const set = (info: BinaryPartInfo | null) => {
  current = info;
  for (const l of [...listeners]) l();
};

/** Opens the viewer for a part. Notifies if the part cannot be read. */
export async function showBinaryPart(
  wb: Workbench,
  container: string,
  part: string,
): Promise<boolean> {
  const name = part.slice(part.lastIndexOf("/") + 1);
  try {
    const { bytes } = await wb.platform.readBinaryFile(joinContainerPath(container, part));
    const type = IMAGE_TYPES[extensionOf(name)];
    set({
      container,
      part,
      name,
      size: bytes.length,
      bytes,
      preview:
        type && bytes.length <= MAX_PREVIEW_BYTES ? `data:${type};base64,${toBase64(bytes)}` : null,
    });
    return true;
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
}

async function saveCopy(wb: Workbench, info: BinaryPartInfo): Promise<void> {
  const ext = extensionOf(info.name);
  const target = await wb.platform.showSaveDialog({
    filters: [{ name: describeKind(info.name), extensions: ext ? [ext] : ["*"] }],
    defaultPath: info.name,
  });
  if (target === null) return;
  try {
    // The save dialog has already asked about replacing an existing file.
    await wb.platform.writeBinaryFile(target, info.bytes, { overwrite: true });
    wb.notify({ message: `Saved a copy of ${info.name}.` });
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not save ${info.name}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function BinaryPartDialog({ workbench }: FeatureComponentProps) {
  const info = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current,
  );
  const root = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<string>("");

  useEffect(() => {
    if (!info) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus();
  }, [info]);

  if (!info) return null;
  const close = () => {
    setDimensions("");
    set(null);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...(root.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={root}
        className="dialog binary-part"
        role="dialog"
        aria-modal="true"
        aria-labelledby="binary-part-title"
        onKeyDown={onKeyDown}
      >
        <h2 id="binary-part-title">{info.name}</h2>
        <p className="binary-part-meta">
          {describeKind(info.name)}, {describeSize(info.size)}
          {dimensions && `, ${dimensions}`}
          <br />
          <span className="binary-part-path">{info.part}</span>
        </p>
        {info.preview ? (
          <div className="binary-part-preview">
            <img
              src={info.preview}
              alt={`Preview of ${info.name}`}
              onLoad={(e) =>
                setDimensions(
                  `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} pixels`,
                )
              }
            />
          </div>
        ) : (
          <p>
            {IMAGE_TYPES[extensionOf(info.name)]
              ? "This picture is too large to preview here."
              : "This part cannot be shown as text or as a picture."}{" "}
            You can save a copy to look at it in another program.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => void saveCopy(workbench, info)}>
            Save a copy…
          </button>
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export const binaryPart: Feature = {
  id: "binary-part",
  overlays: [BinaryPartDialog],
};
