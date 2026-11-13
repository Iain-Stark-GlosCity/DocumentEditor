/**
 * Link and image handling for links followed from inside the editor (live preview). Uses the
 * same rules as the split preview (`preview/links.ts`, `preview/paths.ts`).
 */
import { classifyLink } from "./preview/links";
import { resolveRelativePath } from "./preview/paths";
import type { Workbench } from "./workbench";

/** Follows a link written in the document at `documentPath`. Anchors are the editor's job. */
export function followDocumentLink(
  workbench: Workbench,
  href: string,
  documentPath: string | null,
): void {
  const action = classifyLink(href, documentPath);
  switch (action.kind) {
    case "anchor":
      break;
    case "external":
      workbench.platform.openExternal(action.url).catch((e: unknown) => {
        workbench.notify({
          kind: "error",
          message: `Could not open ${action.url}: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
      break;
    case "file":
      if (workbench.registry.forPath(action.path)) void workbench.openPaths([action.path]);
      else workbench.notify({ message: `Link target: ${action.path}` });
      break;
    case "none":
      if (action.reason) workbench.notify({ message: action.reason });
      break;
  }
}

const ABSOLUTE = /^([a-zA-Z]:|[\\/])/;

/**
 * A URL the webview can load for an image path relative to the document, or "" when there is
 * none (unsaved document, or a path that is not relative).
 */
export function documentAssetUrl(
  workbench: Workbench,
  relativePath: string,
  documentPath: string | null,
): string {
  if (documentPath === null || ABSOLUTE.test(relativePath.trim())) return "";
  const path = resolveRelativePath(documentPath, relativePath.trim());
  return path === null ? "" : workbench.platform.assetUrl(path);
}
