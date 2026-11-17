/**
 * "Export…": saves the active document in another format a provider offers (Markdown to a Word
 * document, for example). The provider does the converting (`TextFormatProvider.exporters`); this
 * only asks where to save, gives the exporter the current text (unsaved edits included) and a way
 * to read the files the document refers to, and writes the result. Nothing the exporter reads or
 * writes can reach the network.
 */
import type { ExportContext } from "../../core/format";
import { resolveRelativePath } from "../preview/paths";
import type { Feature } from "../feature";
import type { Workbench } from "../workbench";

export const EXPORT_COMMAND = "file.export";

/** The most any one referenced file may be (a picture, say) before it is left out. */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const baseName = (path: string) =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
const withoutExtension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

function decodeDataUrl(reference: string): Uint8Array | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/is.exec(reference);
  if (!match) return null;
  try {
    if (match[1]) {
      const binary = atob(match[2]!.replace(/\s/g, ""));
      if (binary.length > MAX_ASSET_BYTES) return null;
      return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }
    const bytes = new TextEncoder().encode(decodeURIComponent(match[2]!));
    return bytes.length > MAX_ASSET_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

/** The context an exporter is given for a document. Exported for tests. */
export function exportContext(wb: Workbench, path: string | null): ExportContext {
  return {
    path,
    title: path ? withoutExtension(baseName(path)) : "Untitled",
    resolveAsset: (relative) => {
      const absolute = path === null ? null : resolveRelativePath(path, relative);
      return absolute === null ? "" : wb.platform.assetUrl(absolute);
    },
    async readAsset(reference) {
      const ref = reference.trim();
      if (/^data:/i.test(ref)) return decodeDataUrl(ref);
      // Remote and other schemes are never fetched.
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^[a-z]:[\\/]/i.test(ref)) return null;
      if (path === null) return null;
      const absolute = resolveRelativePath(path, ref);
      if (absolute === null) return null;
      try {
        return (await wb.platform.readBinaryFile(absolute, { maxBytes: MAX_ASSET_BYTES })).bytes;
      } catch {
        return null;
      }
    },
  };
}

/** Runs the export flow for the active document. Resolves true if a file was written. */
export async function exportDocument(wb: Workbench): Promise<boolean> {
  const doc = wb.activeDocument();
  const provider = doc ? wb.registry.byId(doc.providerId) : undefined;
  const exporters = provider?.kind === "text" ? (provider.exporters ?? []) : [];
  if (!doc || exporters.length === 0) {
    wb.notify({ message: "This kind of file has nothing to export to." });
    return false;
  }
  const exporter =
    exporters.length === 1
      ? exporters[0]!
      : await (async () => {
          const id = await wb.pick(
            exporters.map((e) => ({ value: e.id, label: e.name, detail: `.${e.fileExtension}` })),
            { title: "Export", placeholder: "Choose a format" },
          );
          return exporters.find((e) => e.id === id);
        })();
  if (!exporter) return false;

  const text = wb.getText(doc.id);
  if (text === undefined) return false;
  const defaultName = `${withoutExtension(doc.path ? baseName(doc.path) : doc.title)}.${exporter.fileExtension}`;
  const dir = doc.path ? doc.path.slice(0, doc.path.length - baseName(doc.path).length) : "";
  const target = await wb.platform.showSaveDialog({
    filters: [{ name: exporter.name, extensions: [exporter.fileExtension] }],
    defaultPath: `${dir}${defaultName}`,
  });
  if (target === null) return false;

  let bytes: Uint8Array;
  try {
    bytes = await exporter.export(text, exportContext(wb, doc.path));
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not export ${doc.title}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
  try {
    // The save dialog has already asked about replacing an existing file.
    await wb.platform.writeBinaryFile(target, bytes, { overwrite: true });
  } catch (error) {
    wb.notify({
      kind: "error",
      message: `Could not save ${baseName(target)}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
  wb.notify({ message: `Exported ${doc.title} as ${baseName(target)}.` });
  return true;
}

export const exportFeature: Feature = {
  id: "export",

  commands: (wb) => [
    {
      id: EXPORT_COMMAND,
      title: "Export…",
      enabled: () => {
        const doc = wb.activeDocument();
        const provider = doc ? wb.registry.byId(doc.providerId) : undefined;
        return provider?.kind === "text" && (provider.exporters?.length ?? 0) > 0;
      },
      run: () => void exportDocument(wb),
    },
  ],

  menuItems: [{ menu: "file", group: "2_save", command: EXPORT_COMMAND, order: 5 }],
};
