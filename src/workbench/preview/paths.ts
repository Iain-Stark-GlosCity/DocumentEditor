/**
 * Pure path helpers for links and images in the preview. No platform calls, so they run the
 * same in the render worker and on the main thread. Paths are the Windows or POSIX style of the
 * document they are resolved against.
 */

/** Drops `?query` and `#fragment`, then percent-decodes (`my%20file.png` is `my file.png`). */
export function decodeRelativeTarget(target: string): string {
  const end = target.search(/[?#]/);
  const bare = end < 0 ? target : target.slice(0, end);
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

/** Number of leading segments that make up the root, which `..` must never climb above. */
function rootLength(parts: readonly string[]): number {
  const first = parts[0] ?? "";
  if (/^[A-Za-z]:$/.test(first)) return 1; // C:
  if (first === "" && parts[1] === "") return Math.min(4, parts.length); // \\server\share
  if (first === "") return 1; // /
  return 0;
}

/**
 * Resolves `relative` against the folder of `documentPath`. Returns null if `documentPath` is not
 * absolute (an unsaved document has nothing to resolve against) or `relative` is empty.
 */
export function resolveRelativePath(documentPath: string, relative: string): string | null {
  const target = decodeRelativeTarget(relative);
  if (target === "") return null;
  const windows = /^[A-Za-z]:|^\\\\/.test(documentPath) || documentPath.includes("\\");
  const parts = documentPath.split(/[\\/]/);
  const root = rootLength(parts);
  if (root === 0) return null;
  parts.pop(); // The document's own file name.
  for (const segment of target.split(/[\\/]/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > root) parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const joined = parts.join(windows ? "\\" : "/");
  // A POSIX root is the empty first segment, so `["", "a"]` joins to `/a`, and a lone root to "".
  return joined === "" ? "/" : joined;
}

const IMAGE_HOST = "doc";
const UNSAVED_HOST = "unsaved";

/**
 * The URL the render worker puts in an image's `src`. `resolveAsset` cannot cross the worker
 * boundary (it is a function, and the real answer needs the platform), so the worker emits this
 * serialisable stand-in and the main thread swaps it for `Platform.assetUrl` before display. The
 * `asset:` scheme is the one the sanitiser already allows for images.
 */
export function assetPlaceholder(documentPath: string | null, relative: string): string {
  const absolute = documentPath === null ? null : resolveRelativePath(documentPath, relative);
  return absolute === null
    ? `asset://${UNSAVED_HOST}/${encodeURIComponent(relative)}`
    : `asset://${IMAGE_HOST}/${encodeURIComponent(absolute)}`;
}

export type PlaceholderTarget = { kind: "file"; path: string } | { kind: "unresolved" } | null;

/** Reads a URL made by `assetPlaceholder`. Null if it is not one of ours. */
export function readAssetPlaceholder(url: string): PlaceholderTarget {
  const match = /^asset:\/\/(doc|unsaved)\/(.*)$/i.exec(url);
  if (!match) return null;
  if ((match[1] ?? "").toLowerCase() === UNSAVED_HOST) return { kind: "unresolved" };
  try {
    return { kind: "file", path: decodeURIComponent(match[2] ?? "") };
  } catch {
    return { kind: "unresolved" };
  }
}
