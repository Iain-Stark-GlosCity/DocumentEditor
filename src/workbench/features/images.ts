import { EditorView } from "@codemirror/view";
import {
  altTextFor,
  baseName,
  extensionForMime,
  IMAGE_EXTENSIONS,
  imageFolderFor,
  isImageMime,
  isImagePath,
  isInside,
  dirName,
  linkPathFor,
  pastedImageName,
  placeWithoutCollision,
  planFileImport,
  toPosixPath,
} from "../../core/images";
import { FileExistsError } from "../../platform/platform";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

const DROP_CLASS = "cm-file-drop-active";
const COMMAND_ID = "markdown.insertImage";

const dropIndicatorTheme = EditorView.baseTheme({
  [`&.${DROP_CLASS}`]: {
    outline: "2px dashed var(--accent, currentColor)",
    outlineOffset: "-2px",
  },
});

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Which provider of the active document can write image links, if any. */
function imageProvider(wb: Workbench) {
  const doc = wb.activeDocument();
  const provider = doc && wb.registry.byId(doc.providerId);
  return doc && provider?.imageSyntax ? { doc, provider } : null;
}

/**
 * An untitled document has nowhere to keep images, so the user is asked to save it first.
 * Resolves with the document's path, or null if they declined or the save did not happen.
 */
async function ensureSaved(wb: Workbench, docId: string): Promise<string | null> {
  const current = () => wb.documents.getState().documents.find((d) => d.id === docId);
  if (current()?.path) return current()?.path ?? null;
  const choice = await wb.ask({
    title: "Save the document first",
    message:
      "Images are kept beside the document, so it needs a file name before one can be added.",
    actions: [
      { value: "save", label: "Save as…" },
      { value: "cancel", label: "Cancel" },
    ],
    cancelValue: "cancel",
  });
  if (choice !== "save") return null;
  if (!(await wb.save(docId))) return null;
  return current()?.path ?? null;
}

async function bytesOf(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.readAsArrayBuffer(file);
  });
}

/** Writes bytes to the first free name in `folder`; resolves with the path used. */
async function writeNew(wb: Workbench, folder: string, name: string, bytes: Uint8Array) {
  const placed = await placeWithoutCollision(folder, name, async (path) => {
    try {
      await wb.platform.writeBinaryFile(path, bytes, { overwrite: false });
      return "placed";
    } catch (e) {
      if (e instanceof FileExistsError) return "exists";
      throw e;
    }
  });
  return placed.path;
}

/** Copies a file into `folder` under a free name, or reuses it if it is already there. */
async function copyInto(wb: Workbench, folder: string, name: string, source: string) {
  const placed = await placeWithoutCollision(
    folder,
    name,
    async (path) => {
      try {
        await wb.platform.copyFile(source, path, { overwrite: false });
        return "placed";
      } catch (e) {
        if (e instanceof FileExistsError) return "exists";
        throw e;
      }
    },
    source,
  );
  return placed.path;
}

type Insertion =
  /** Replace the selection, as a paste does. */
  | { kind: "selection" }
  /** Insert at the caret without replacing anything. */
  | { kind: "caret" }
  /** Insert at a document position (a drop); null means the caret. */
  | { kind: "at"; pos: number | null };

/** Inserts into the document's editor as one undoable transaction. False if it is not shown. */
function insertText(wb: Workbench, docId: string, text: string, where: Insertion): boolean {
  const view = wb.activeView();
  if (!view || wb.activeDocument()?.id !== docId) return false;
  const { state } = view;
  if (where.kind === "selection") {
    view.dispatch({
      ...state.replaceSelection(text),
      userEvent: "input.paste",
      scrollIntoView: true,
    });
    return true;
  }
  const from =
    where.kind === "at" && where.pos !== null
      ? Math.min(where.pos, state.doc.length)
      : state.selection.main.head;
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
    userEvent: where.kind === "at" ? "input.drop" : "input",
    scrollIntoView: true,
  });
  return true;
}

function reportFailure(wb: Workbench, what: string, error: unknown): void {
  wb.notify({ kind: "error", message: `Could not add ${what}: ${errorText(error)}` });
}

const NEEDS_DOCUMENT =
  "Open a Markdown document to add images or links to it. Nothing was inserted.";

/** The document position under a point, or null to use the caret. */
function positionAt(view: EditorView, x: number, y: number): number | null {
  const rect = view.dom.getBoundingClientRect();
  const laidOut = rect.width > 0 && rect.height > 0;
  if (laidOut && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)) return null;
  return view.posAtCoords({ x, y }, false) ?? null;
}

/** Adds image files (picked or dropped) and other files (dropped) to the document. */
async function addFiles(
  wb: Workbench,
  docId: string,
  paths: readonly string[],
  where: Insertion,
): Promise<void> {
  const documentPath = await ensureSaved(wb, docId);
  const provider = imageProvider(wb)?.provider;
  if (documentPath === null || !provider?.imageSyntax) return;
  const folderPattern = wb.settings.get("markdown.images.folder");
  const docDir = dirName(documentPath);

  const lines: string[] = [];
  for (const path of paths) {
    try {
      if (isImagePath(path)) {
        const plan = planFileImport(documentPath, path, folderPattern);
        const target =
          plan.kind === "in-place" ? plan.path : await copyInto(wb, plan.folder, plan.name, path);
        lines.push(
          provider.imageSyntax(linkPathFor(documentPath, target), altTextFor(baseName(path))),
        );
      } else if (provider.linkSyntax) {
        const link = isInside(docDir, path) ? linkPathFor(documentPath, path) : toPosixPath(path);
        lines.push(provider.linkSyntax(link, baseName(path)));
      }
    } catch (e) {
      reportFailure(wb, baseName(path), e);
    }
  }
  if (lines.length > 0 && !insertText(wb, docId, lines.join("\n"), where)) {
    wb.notify({
      kind: "warning",
      message: "The document changed while the files were added. Nothing was inserted.",
    });
  }
}

async function addPastedImage(wb: Workbench, docId: string, file: File): Promise<void> {
  try {
    // Read first: the user may be asked to save, and the clipboard is not kept for long.
    const bytes = await bytesOf(file);
    const documentPath = await ensureSaved(wb, docId);
    const provider = imageProvider(wb)?.provider;
    if (documentPath === null || !provider?.imageSyntax) return;

    const folder = imageFolderFor(documentPath, wb.settings.get("markdown.images.folder"));
    const name = pastedImageName(new Date(), extensionForMime(file.type));
    const path = await writeNew(wb, folder, name, bytes);

    if (
      !insertText(wb, docId, provider.imageSyntax(linkPathFor(documentPath, path), ""), {
        kind: "selection",
      })
    ) {
      wb.notify({
        kind: "warning",
        message: `The image was saved as ${path} but the document changed, so it was not inserted.`,
      });
      return;
    }
    const limitMb = wb.settings.get("markdown.images.warnAboveMb");
    if (limitMb > 0 && bytes.length > limitMb * 1024 * 1024) {
      const size = (bytes.length / (1024 * 1024)).toFixed(1);
      wb.notify({
        kind: "warning",
        message: `That image is ${size} MB. It was added unchanged, but large images can make the document slow to open.`,
      });
    }
  } catch (e) {
    reportFailure(wb, "the image", e);
  }
}

/** Splits dropped paths into what is linked from the document and what opens as its own tab. */
async function handleDrop(wb: Workbench, paths: string[], x: number, y: number): Promise<void> {
  const target = imageProvider(wb);
  const opens = paths.filter((p) => !isImagePath(p) && wb.registry.forPath(p) !== undefined);
  const inserts = paths.filter((p) => !opens.includes(p));

  if (inserts.length > 0) {
    if (!target) {
      wb.notify({ kind: "info", message: NEEDS_DOCUMENT });
    } else {
      const view = wb.activeView();
      const pos = view ? positionAt(view, x, y) : null;
      await addFiles(wb, target.doc.id, inserts, { kind: "at", pos });
    }
  }
  // Opening changes the active document, so it comes after the insertion above.
  if (opens.length > 0) await wb.openPaths(opens);
}

function setDropIndicator(wb: Workbench, on: boolean): void {
  wb.activeView()?.dom.classList.toggle(DROP_CLASS, on && imageProvider(wb) !== null);
}

/** Paste, drop and a command for adding images to a document that can show them. */
export const images: Feature = {
  id: "images",

  editorExtensions: (_doc, wb) => [
    dropIndicatorTheme,
    EditorView.domEventHandlers({
      paste(event) {
        const target = imageProvider(wb);
        const data = event.clipboardData;
        if (!target || !data) return false;
        // Word and Excel put a picture of the text on the clipboard beside the text: text wins.
        if (data.getData("text/plain") !== "") return false;
        const files: File[] = [];
        for (const item of Array.from(data.items)) {
          if (item.kind === "file" && isImageMime(item.type)) {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
        if (files.length === 0) return false;
        event.preventDefault();
        void (async () => {
          for (const file of files) await addPastedImage(wb, target.doc.id, file);
        })();
        return true;
      },
    }),
  ],

  commands: (wb) => [
    {
      id: COMMAND_ID,
      title: "Insert image…",
      enabled: () => imageProvider(wb) !== null && wb.activeView() !== null,
      run: async () => {
        const target = imageProvider(wb);
        if (!target) return;
        const paths = await wb.platform.showOpenDialog({
          filters: [{ name: "Images", extensions: [...IMAGE_EXTENSIONS] }],
          multiple: true,
        });
        if (paths.length === 0) return;
        await addFiles(wb, target.doc.id, paths, { kind: "caret" });
        wb.focusEditor();
      },
    },
  ],

  menuItems: [{ menu: "edit", group: "9_insert", command: COMMAND_ID }],

  activate(wb) {
    let active = true;
    const stops: (() => void)[] = [];
    const hook = (registration: Promise<() => void>) =>
      registration.then(
        (stop) => (active ? stops.push(stop) : stop()),
        (e: unknown) => wb.notify({ kind: "error", message: errorText(e) }),
      );
    void hook(
      wb.platform.onFilesDropped((event) => {
        setDropIndicator(wb, false);
        void handleDrop(wb, event.paths, event.x, event.y);
      }),
    );
    void hook(wb.platform.onFileDragOver((position) => setDropIndicator(wb, position !== null)));
    return () => {
      active = false;
      setDropIndicator(wb, false);
      for (const stop of stops.splice(0)) stop();
    };
  },
};
