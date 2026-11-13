/**
 * Pure logic for inserting images: where a file goes, what it is called and how the document
 * refers to it. No React, no Tauri, no `node:path`: paths are Windows paths on a Windows host and
 * the tests run on Linux, so all path maths here is done on strings and works for both.
 *
 * Recognised paths: POSIX (`/a/b`), drive (`C:\a\b`, `C:/a/b`), UNC (`\\server\share\a`) and
 * verbatim (`\\?\C:\a`, `\\?\UNC\server\share\a`). Windows-style paths compare case-insensitively.
 */

export const IMAGE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "ico",
  "tif",
  "tiff",
];

export const DEFAULT_IMAGE_FOLDER = "assets";

// Paths -----------------------------------------------------------------------------------

interface ParsedPath {
  /** The root exactly as written (`C:\`, `\\server\share\`, `/`), or "" for a relative path. */
  root: string;
  segments: string[];
  /** Drive, UNC or backslash paths: compared case-insensitively. */
  windows: boolean;
}

const isSep = (c: string | undefined): boolean => c === "/" || c === "\\";

function rootLength(text: string): number {
  let i = 0;
  let unc = false;
  if (text.startsWith("\\\\?\\")) {
    i = 4;
    if (/^unc[\\/]/i.test(text.slice(4))) {
      unc = true;
      i += 4;
    }
  } else if (isSep(text[0]) && isSep(text[1])) {
    unc = true;
    i = 2;
  }
  if (unc) {
    // `server\share` belongs to the root.
    for (let part = 0; part < 2; part++) {
      while (i < text.length && !isSep(text[i])) i++;
      if (i < text.length) i++;
    }
    return i;
  }
  if (/^[A-Za-z]:/.test(text.slice(i))) {
    i += 2;
    if (isSep(text[i])) i++;
    return i;
  }
  return isSep(text[i]) ? i + 1 : i;
}

export function parsePath(path: string): ParsedPath {
  const length = rootLength(path);
  const root = path.slice(0, length);
  const segments = path
    .slice(length)
    .split(/[\\/]+/)
    .filter((s) => s !== "");
  const windows = /^[A-Za-z]:/.test(root) || root.startsWith("\\\\") || path.includes("\\");
  return { root, segments, windows };
}

/** True for a path that starts at a root: `/x`, `C:\x`, `C:/x`, `\\server\share\x`. */
export function isAbsolutePath(path: string): boolean {
  const { root } = parsePath(path);
  if (root === "") return false;
  // `C:x` is drive-relative, not absolute.
  return !/^[A-Za-z]:$/.test(root);
}

/** Keeps the style the path was written in: backslashes if it has any, else forward slashes. */
function separatorOf(path: string): "/" | "\\" {
  return path.includes("\\") ? "\\" : "/";
}

/** Resolves `.` and `..` segments. A `..` that would climb above the root is dropped. */
function normaliseSegments(segments: readonly string[], keepLeadingUps: boolean): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (keepLeadingUps) out.push("..");
      continue;
    }
    out.push(segment);
  }
  return out;
}

function build(root: string, segments: readonly string[], sep: "/" | "\\"): string {
  const body = segments.join(sep);
  if (root === "") return body;
  // Keep a bare drive (`C:`) as `C:\` so the result is absolute.
  const base = /[\\/]$/.test(root) ? root : root + sep;
  return base + body;
}

export function baseName(path: string): string {
  return parsePath(path).segments.at(-1) ?? "";
}

/** The folder containing the path ("" if it has none, the root for a file directly in a root). */
export function dirName(path: string): string {
  const { root, segments } = parsePath(path);
  return build(root, segments.slice(0, -1), separatorOf(path));
}

/** Joins segments (which may contain `/` or `\`) onto a folder, using the folder's separator. */
export function joinPath(dir: string, ...parts: string[]): string {
  const parsed = parsePath(dir);
  const sep = separatorOf(dir);
  const extra = parts.flatMap((p) => p.split(/[\\/]+/)).filter((s) => s !== "");
  return build(
    parsed.root,
    normaliseSegments([...parsed.segments, ...extra], parsed.root === ""),
    sep,
  );
}

function sameSegment(a: string, b: string, windows: boolean): boolean {
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sameRoot(a: ParsedPath, b: ParsedPath): boolean {
  const windows = a.windows || b.windows;
  const strip = (r: string) =>
    r
      .replace(/[\\/]+/g, "/")
      .replace(/\/$/, "")
      .replace(/^\/\/\?\//, "");
  return windows ? strip(a.root).toLowerCase() === strip(b.root).toLowerCase() : a.root === b.root;
}

/** Whether two paths name the same file (Windows-style paths ignore case and slash direction). */
export function samePath(a: string, b: string): boolean {
  const pa = parsePath(a);
  const pb = parsePath(b);
  if (!sameRoot(pa, pb) || pa.segments.length !== pb.segments.length) return false;
  const windows = pa.windows || pb.windows;
  return pa.segments.every((s, i) => sameSegment(s, pb.segments[i] ?? "", windows));
}

/** Whether `path` lies strictly below `folder` (at any depth). */
export function isInside(folder: string, path: string): boolean {
  const pf = parsePath(folder);
  const pp = parsePath(path);
  if (!sameRoot(pf, pp) || pp.segments.length <= pf.segments.length) return false;
  const windows = pf.windows || pp.windows;
  return pf.segments.every((s, i) => sameSegment(s, pp.segments[i] ?? "", windows));
}

/**
 * The POSIX-style path from folder `fromDir` to `to`, always starting `./` or `../`. Null when
 * there is no relative route (different drive or share).
 */
export function relativePath(fromDir: string, to: string): string | null {
  const pf = parsePath(fromDir);
  const pt = parsePath(to);
  if (!sameRoot(pf, pt)) return null;
  const windows = pf.windows || pt.windows;
  const from = normaliseSegments(pf.segments, false);
  const target = normaliseSegments(pt.segments, false);
  let common = 0;
  while (
    common < from.length &&
    common < target.length &&
    sameSegment(from[common] ?? "", target[common] ?? "", windows)
  ) {
    common++;
  }
  const ups = from.length - common;
  const rest = target.slice(common);
  const parts = [...Array<string>(ups).fill(".."), ...rest];
  if (parts.length === 0) return ".";
  return ups > 0 ? parts.join("/") : "./" + parts.join("/");
}

/** The path as forward-slash text, for the rare link to a file with no relative route. */
export function toPosixPath(path: string): string {
  return path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
}

/** The path from a document to a file, relative where possible, else absolute and POSIX-style. */
export function linkPathFor(documentPath: string, filePath: string): string {
  return relativePath(dirName(documentPath), filePath) ?? toPosixPath(filePath);
}

// File names ------------------------------------------------------------------------------

export function extensionOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function stemOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(path));
}

export function isImageMime(mime: string): boolean {
  return /^image\/[a-z0-9.+-]+$/i.test(mime);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** File extension for an image MIME type; `png` for anything unrecognised. */
export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.toLowerCase()] ?? "png";
}

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
// Control characters are exactly what must be replaced in a Windows file name.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
export const MAX_FILE_NAME_LENGTH = 100;

/**
 * Makes a file name safe on Windows: illegal characters become `-`, reserved device names get a
 * leading underscore, trailing dots and spaces go, and the name is cut to `maxLength` characters
 * (keeping the extension). Never returns an empty name.
 */
export function sanitiseFileName(name: string, maxLength = MAX_FILE_NAME_LENGTH): string {
  let clean = baseName(name.replace(ILLEGAL, (c) => (c === "/" || c === "\\" ? "/" : "-")));
  clean = clean
    .replace(ILLEGAL, "-")
    .replace(/^\s+/, "")
    .replace(/[. ]+$/, "");
  if (clean === "") return "image";
  const dot = clean.lastIndexOf(".");
  let stem = dot > 0 ? clean.slice(0, dot) : clean;
  let ext = dot > 0 ? clean.slice(dot) : "";
  if (ext.length > 16) ext = ext.slice(0, 16);
  stem = stem.replace(/[. ]+$/, "");
  const room = Math.max(1, maxLength - ext.length);
  if (stem.length > room) stem = stem.slice(0, room).replace(/[. ]+$/, "") || "image";
  if (RESERVED.test(stem)) stem = "_" + stem;
  return stem + ext;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `image-YYYYMMDD-HHMMSS.png` in local time. */
export function pastedImageName(now: Date, extension = "png"): string {
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `image-${date}-${time}.${extension}`;
}

/** `name-1.ext`, `name-2.ext` and so on; attempt 0 is the name itself. */
export function numberedName(name: string, attempt: number): string {
  if (attempt <= 0) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${attempt}${name.slice(dot)}` : `${name}-${attempt}`;
}

/** Alt text for a dropped or picked file: its name without the extension. */
export function altTextFor(fileName: string): string {
  return stemOf(fileName);
}

// Destination -----------------------------------------------------------------------------

/**
 * The absolute folder images go in for a document. `pattern` is relative to the document's
 * folder (`assets`, `.`, `../shared`, `${documentName}.assets`) or absolute.
 */
export function imageFolderFor(documentPath: string, pattern: string): string {
  const docDir = dirName(documentPath);
  const documentName = sanitiseFileName(stemOf(documentPath));
  const expanded = pattern.replace(/\$\{documentName\}/g, documentName).trim();
  if (expanded === "" || expanded === ".") return docDir;
  if (isAbsolutePath(expanded)) {
    const p = parsePath(expanded);
    return build(p.root, normaliseSegments(p.segments, false), separatorOf(expanded));
  }
  return joinPath(docDir, expanded);
}

export type DroppedFilePlan =
  { kind: "in-place"; path: string } | { kind: "import"; folder: string; name: string };

/** A file inside the document's folder tree is linked where it is; any other is imported. */
export function planFileImport(
  documentPath: string,
  sourcePath: string,
  folderPattern: string,
): DroppedFilePlan {
  if (isInside(dirName(documentPath), sourcePath)) return { kind: "in-place", path: sourcePath };
  return {
    kind: "import",
    folder: imageFolderFor(documentPath, folderPattern),
    name: sanitiseFileName(baseName(sourcePath)),
  };
}

export interface PlacedFile {
  path: string;
  /** False when the file was already at the destination and is reused. */
  created: boolean;
}

/**
 * Finds a free name in `folder` and places a file there. `attempt` tries to write one path and
 * says whether it did (`placed`) or found the name taken (`exists`); it may throw for any other
 * failure. If `sourcePath` is itself a candidate, that is the same file and is reused.
 */
export async function placeWithoutCollision(
  folder: string,
  name: string,
  attempt: (path: string) => Promise<"placed" | "exists">,
  sourcePath?: string,
  limit = 1000,
): Promise<PlacedFile> {
  for (let n = 0; n < limit; n++) {
    const path = joinPath(folder, numberedName(name, n));
    if (sourcePath !== undefined && samePath(path, sourcePath)) return { path, created: false };
    if ((await attempt(path)) === "placed") return { path, created: true };
  }
  throw new Error(`Could not find a free name for ${name} in ${folder}`);
}
