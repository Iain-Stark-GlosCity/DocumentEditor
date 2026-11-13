/** Decides what a click on a link in the preview should do. Pure; the component acts on it. */
import { resolveRelativePath } from "./paths";

export type LinkAction =
  /** Scroll the preview to the element with this id (as written, without the `#`). */
  | { kind: "anchor"; id: string }
  /** Hand to the operating system: http, https or mailto. */
  | { kind: "external"; url: string }
  /** A local file next to the document. */
  | { kind: "file"; path: string }
  /** Nothing to do; `reason` is for the user. */
  | { kind: "none"; reason: string };

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const EXTERNAL = new Set(["http", "https", "mailto"]);

/**
 * `href` is the attribute as written (not the resolved `a.href`, which would resolve against the
 * app's own address). `documentPath` is null for an unsaved document.
 */
export function classifyLink(href: string, documentPath: string | null): LinkAction {
  const text = href.trim();
  if (text === "") return { kind: "none", reason: "This link has no target." };
  if (text.startsWith("#")) {
    const id = text.slice(1);
    return id === "" ? { kind: "none", reason: "" } : { kind: "anchor", id: decodeFragment(id) };
  }
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  // A Windows drive path such as `C:\a.md` parses as a one-letter scheme. Treat it as a file.
  if (scheme !== undefined && scheme.length > 1) {
    return EXTERNAL.has(scheme)
      ? { kind: "external", url: text }
      : { kind: "none", reason: `Links of this kind are not opened: ${text}` };
  }
  if (text.startsWith("//")) {
    return { kind: "none", reason: `Links of this kind are not opened: ${text}` };
  }
  if (documentPath === null) {
    return { kind: "none", reason: `Save the document to follow relative links: ${text}` };
  }
  if (text.startsWith("/") || text.startsWith("\\") || scheme !== undefined) {
    return { kind: "none", reason: `Links of this kind are not opened: ${text}` };
  }
  const path = resolveRelativePath(documentPath, text);
  return path === null
    ? { kind: "none", reason: `This link could not be resolved: ${text}` }
    : { kind: "file", path };
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
