/**
 * Paths into container files. A DOCX (and ODT, XLSX, PPTX, EPUB) is a zip of parts; each part can
 * be opened as if it were a file of its own, at a path made of the container's path, then `!/`,
 * then the part's name inside the archive:
 *
 *     C:\docs\report.docx!/word/document.xml
 *
 * The rest of the app treats such a path like any other (the same title logic, the same watcher,
 * the same read and write calls); only the platform knows it is inside an archive. Pure string
 * handling, so it works the same on every host.
 */

export const CONTAINER_SEPARATOR = "!/";

export interface ContainerPathParts {
  /** The path of the container file, for example `C:\docs\report.docx`. */
  container: string;
  /** The part's name inside the archive, always with `/` separators, for example `word/document.xml`. */
  part: string;
}

/** Splits a path into its container and part, or returns null for an ordinary path. */
export function splitContainerPath(path: string): ContainerPathParts | null {
  const at = path.indexOf(CONTAINER_SEPARATOR);
  if (at <= 0) return null;
  const part = path.slice(at + CONTAINER_SEPARATOR.length);
  if (part === "" || part.endsWith("/")) return null;
  return { container: path.slice(0, at), part };
}

/** The path of a part inside a container. A leading `/` on the part is ignored. */
export function joinContainerPath(container: string, part: string): string {
  return `${container}${CONTAINER_SEPARATOR}${part.replace(/^\/+/, "")}`;
}

export function isContainerPartPath(path: string): boolean {
  return splitContainerPath(path) !== null;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * A short title for a tab: the file name, or for a part `report.docx › document.xml` so parts of
 * different containers cannot be confused.
 */
export function containerTitle(path: string): string {
  const parts = splitContainerPath(path);
  if (!parts) return baseName(path);
  return `${baseName(parts.container)} \u203a ${baseName(parts.part)}`;
}
