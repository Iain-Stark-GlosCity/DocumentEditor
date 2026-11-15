/**
 * Looking at a binary part of a container (an image, a font, an embedded object): a dialog that
 * says what it is and how big, previews it when it is a picture, saves a copy to disk, and can
 * replace a picture with one of the same type. The part's bytes are read afresh from the file. The preview is a `data:` URL in an `<img>`, which
 * the strict CSP already allows and which can never run script.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { joinContainerPath } from "../../core/container-path";
import type { Feature, FeatureComponentProps } from "../feature";
import { FONT_EXTENSIONS, loadFontPreview } from "./font-preview";
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

/** The bytes as a `data:` URL, encoded by the browser rather than by building a string by hand. */
function toDataUrl(type: string, bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not encode the picture"));
    // Part bytes are never backed by a SharedArrayBuffer; the cast only satisfies `BlobPart`.
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  });
}

let current: BinaryPartInfo | null = null;
const listeners = new Set<() => void>();
const set = (info: BinaryPartInfo | null) => {
  current = info;
  for (const l of [...listeners]) l();
};

let latestRequest = 0;

/** Opens the viewer for a part. Notifies if the part cannot be read. */
export async function showBinaryPart(
  wb: Workbench,
  container: string,
  part: string,
): Promise<boolean> {
  const name = part.slice(part.lastIndexOf("/") + 1);
  // Only the newest request may show: a slow read of an earlier part must not replace a later one.
  const request = ++latestRequest;
  try {
    const { bytes } = await wb.platform.readBinaryFile(joinContainerPath(container, part));
    const type = IMAGE_TYPES[extensionOf(name)];
    const preview = type && bytes.length <= MAX_PREVIEW_BYTES ? await toDataUrl(type, bytes) : null;
    if (request !== latestRequest) return false;
    set({
      container,
      part,
      name,
      size: bytes.length,
      bytes,
      preview,
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

/** The sizes a BMP's DIB header can have (core, OS/2, info, the v2 to v5 headers). */
const BMP_DIB_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

/**
 * The picture type the first bytes show, or null if they are not one of the supported pictures.
 * It checks each type's full signature and that its fixed header is all there, so a file cut off
 * at the start or any text that happens to begin "BM" is refused. It does not decode the picture.
 */
export function sniffPicture(bytes: Uint8Array): string | null {
  const at = (i: number, text: string) =>
    [...text].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  const u32 = (i: number) =>
    ((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16)) +
    (bytes[i + 3] ?? 0) * 0x1000000;
  // PNG: the 8-byte signature, then the 25-byte IHDR chunk that must come first.
  if (bytes.length >= 33 && bytes[0] === 0x89 && at(1, "PNG\r\n\u001a\n") && at(12, "IHDR"))
    return "png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  // GIF: the header and the 7-byte logical screen descriptor.
  if (bytes.length >= 13 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "gif";
  // BMP: the 14-byte file header and a DIB header of a size that exists.
  if (bytes.length >= 26 && at(0, "BM") && BMP_DIB_SIZES.has(u32(14))) return "bmp";
  // WEBP: a RIFF file of type WEBP whose first chunk is one of the VP8 kinds.
  if (
    bytes.length >= 16 &&
    at(0, "RIFF") &&
    at(8, "WEBP") &&
    (at(12, "VP8 ") || at(12, "VP8L") || at(12, "VP8X"))
  )
    return "webp";
  return null;
}

/** Picture types by file extension, as `sniffPicture` names them. */
function typeOfName(name: string): string | null {
  const ext = extensionOf(name);
  return ext === "jpg" ? "jpeg" : IMAGE_TYPES[ext] ? ext : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const replacedListeners = new Set<(container: string) => void>();

/**
 * Calls back with the container after a part of it was replaced from the viewer. That write is
 * not a document save, so views that list the container's parts (and their sizes) listen here.
 */
export function onDidReplacePart(listener: (container: string) => void): () => void {
  replacedListeners.add(listener);
  return () => void replacedListeners.delete(listener);
}

/** The biggest picture accepted as a replacement. */
export const MAX_REPLACEMENT_BYTES = 50 * 1024 * 1024;

/**
 * Replaces a picture inside the file with one the user chooses. The new picture must be the same
 * type (a PNG for a PNG), because the file's relationships and content types name the type. The
 * change is written through the checked save path, which keeps a one-off backup, and it is not
 * undoable in the editor, so the user is asked first.
 */
async function replacePicture(wb: Workbench, info: BinaryPartInfo): Promise<void> {
  const wanted = typeOfName(info.name);
  if (!wanted) return;
  const ext = extensionOf(info.name);
  let chosen: string[];
  try {
    chosen = await wb.platform.showOpenDialog({
      filters: [
        {
          name: `${wanted.toUpperCase()} picture`,
          extensions: ext === "jpeg" ? ["jpeg", "jpg"] : [ext],
        },
      ],
      multiple: false,
    });
  } catch (error) {
    wb.notify({ kind: "error", message: `Could not open the file dialog: ${errorText(error)}` });
    return;
  }
  const path = chosen[0];
  if (path === undefined) return;
  let bytes: Uint8Array;
  try {
    bytes = (await wb.platform.readBinaryFile(path)).bytes;
  } catch (error) {
    wb.notify({ kind: "error", message: `Could not read that file: ${errorText(error)}` });
    return;
  }
  if (bytes.length > MAX_REPLACEMENT_BYTES) {
    wb.notify({
      kind: "error",
      message: "That picture is too large (the limit is 50 MB). Nothing was changed.",
    });
    return;
  }
  const found = sniffPicture(bytes);
  if (found !== wanted) {
    wb.notify({
      kind: "error",
      message: found
        ? `That is a ${found.toUpperCase()} picture, but ${info.name} is a ${wanted.toUpperCase()}. Convert it to ${wanted.toUpperCase()} first; nothing was changed.`
        : `That file is not a ${wanted.toUpperCase()} picture. Nothing was changed.`,
    });
    return;
  }
  const partPath = joinContainerPath(info.container, info.part);
  // Compared with the part as it is on disk now, not as the viewer read it.
  let same: boolean;
  try {
    same = sameBytes((await wb.platform.readBinaryFile(partPath)).bytes, bytes);
  } catch (error) {
    wb.notify({ kind: "error", message: `Could not read ${info.name}: ${errorText(error)}` });
    return;
  }
  if (same) {
    // Rewriting the file for nothing would still change it on disk and take a backup.
    wb.notify({ message: `That is the same picture as ${info.name}. Nothing was changed.` });
    return;
  }
  const choice = await wb.ask({
    title: `Replace ${info.name}?`,
    message: `${info.name} will be replaced inside ${baseNameOf(info.container)} with the chosen picture (${describeSize(bytes.length)}). Everywhere the file uses this picture shows the new one. A backup copy of the file is kept beside it the first time.\n\nThis cannot be undone in the editor.`,
    actions: [
      { value: "replace", label: "Replace picture" },
      { value: "cancel", label: "Cancel" },
    ],
    cancelValue: "cancel",
    initialFocus: "cancel",
  });
  if (choice !== "replace") return;
  try {
    await wb.platform.writeBinaryFile(partPath, bytes, { overwrite: true });
  } catch (error) {
    wb.notify({ kind: "error", message: `Could not replace ${info.name}: ${errorText(error)}` });
    return;
  }
  // Not a document save, so nothing else hears of it through `onDidSave`.
  for (const listener of [...replacedListeners]) listener(info.container);
  wb.notify({
    message: `Replaced ${info.name}. The Formatting view updates when the file reloads.`,
  });
  await showBinaryPart(wb, info.container, info.part);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const baseNameOf = (path: string) =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

async function saveCopy(wb: Workbench, info: BinaryPartInfo): Promise<void> {
  const ext = extensionOf(info.name);
  try {
    const target = await wb.platform.showSaveDialog({
      filters: [{ name: describeKind(info.name), extensions: ext ? [ext] : ["*"] }],
      defaultPath: info.name,
    });
    if (target === null) return;
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
  // Both are kept with the part they describe, so neither outlives it or leaks to the next one.
  const [dimensions, setDimensions] = useState<{ info: BinaryPartInfo; text: string } | null>(null);
  const [failed, setFailed] = useState<BinaryPartInfo | null>(null);
  const [font, setFont] = useState<{ info: BinaryPartInfo; family: string | null } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = info !== null;

  useEffect(() => {
    if (!open) return;
    // The opener is what had focus before the dialog appeared, not a button inside it.
    opener.current = document.activeElement as HTMLElement | null;
    return () => {
      const previous = opener.current;
      opener.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    // Focus moves in when the dialog opens. When it shows a part again (after a replace) focus is
    // already inside, on the button the person used, and stays there.
    if (info && !root.current?.contains(document.activeElement))
      root.current?.querySelector<HTMLElement>("button")?.focus();
  }, [info]);

  useEffect(() => {
    if (!info || !FONT_EXTENSIONS.includes(extensionOf(info.name))) return;
    let live = true;
    let release: (() => void) | undefined;
    void loadFontPreview(info.name, info.bytes).then((preview) => {
      if (!live) {
        preview?.release();
        return;
      }
      release = preview?.release;
      setFont({ info, family: preview?.family ?? null });
    });
    return () => {
      live = false;
      release?.();
      setFont(null);
    };
  }, [info]);

  if (!info) return null;
  const isFont = FONT_EXTENSIONS.includes(extensionOf(info.name));
  const fontLoaded = font?.info === info;
  const fontFamily = fontLoaded ? font.family : null;
  const size = dimensions?.info === info ? dimensions.text : "";
  const close = () => set(null);

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
    // Focus on the dialog itself (after a click on its text) must not let Tab leave it.
    if (document.activeElement === root.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
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
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id="binary-part-title">{info.name}</h2>
        <p className="binary-part-meta">
          {describeKind(info.name)}, {describeSize(info.size)}
          {size && `, ${size}`}
          <br />
          <span className="binary-part-path">{info.part}</span>
        </p>
        {info.preview && failed !== info ? (
          <div className="binary-part-preview">
            <img
              src={info.preview}
              alt={`Preview of ${info.name}`}
              onLoad={(e) =>
                setDimensions({
                  info,
                  text: `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} pixels`,
                })
              }
              onError={() => setFailed(info)}
            />
          </div>
        ) : isFont && fontFamily ? (
          <div
            className="binary-part-font"
            role="img"
            aria-label={`Sample text in ${info.name}`}
            style={{ fontFamily: `"${fontFamily}", sans-serif` }}
          >
            <p className="binary-part-font-name">The quick brown fox jumps over the lazy dog</p>
            <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
            <p>abcdefghijklmnopqrstuvwxyz 0123456789 .,;:!?&amp;@£€%</p>
            <p className="binary-part-font-small">
              Pack my box with five dozen liquor jugs. 1234567890
            </p>
          </div>
        ) : (
          <p>
            {isFont && fontLoaded ? "This font could not be read, so it cannot be previewed. " : ""}
            {info.preview
              ? "This picture could not be shown. "
              : IMAGE_TYPES[extensionOf(info.name)]
                ? "This picture is too large to preview here."
                : "This part cannot be shown as text or as a picture."}{" "}
            You can save a copy to look at it in another program.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => void saveCopy(workbench, info)}>
            Save a copy…
          </button>
          {typeOfName(info.name) && (
            <button type="button" onClick={() => void replacePicture(workbench, info)}>
              Replace picture…
            </button>
          )}
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
