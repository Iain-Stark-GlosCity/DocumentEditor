/**
 * Turns the render pipeline's HTML into the DOM nodes the preview shows, applying the things
 * that depend on the main thread: real image URLs and the remote-image setting.
 *
 * The HTML given here is always the sanitised output of a provider's `render`. Nothing else is
 * ever injected into the preview (CLAUDE.md rule 5). The only changes made are to `src` on
 * images, and a class on images that are not loaded.
 */
import { readAssetPlaceholder } from "./paths";

export interface PrepareOptions {
  /** `Platform.assetUrl`. */
  assetUrl(absolutePath: string): string;
  loadRemoteImages: boolean;
}

const REMOTE = /^(https?:)?\/\//i;

export const BLOCKED_IMAGE_CLASS = "preview-image-blocked";

function block(image: HTMLImageElement, reason: string): void {
  const src = image.getAttribute("src");
  if (src !== null) image.setAttribute("data-blocked-src", src);
  image.removeAttribute("src");
  image.removeAttribute("srcset");
  image.classList.add(BLOCKED_IMAGE_CLASS);
  image.setAttribute("title", reason);
}

/** Parses `html` in an inert template and rewrites its images. Returns the fragment. */
export function prepareFragment(html: string, options: PrepareOptions): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  for (const image of Array.from(fragment.querySelectorAll("img"))) {
    const src = image.getAttribute("src") ?? "";
    // Alternative sources would bypass the rules below, and the pipeline never emits them.
    image.removeAttribute("srcset");
    const local = readAssetPlaceholder(src);
    if (local?.kind === "file") {
      image.setAttribute("src", options.assetUrl(local.path));
    } else if (local?.kind === "unresolved") {
      block(image, "Save the document to show images beside it");
    } else if (/^asset:/i.test(src)) {
      // An `asset:` URL written by the author, not made by us: never load it.
      block(image, "This image address is not allowed");
    } else if (REMOTE.test(src)) {
      if (!options.loadRemoteImages) block(image, "Remote images are turned off in settings");
    }
  }
  return fragment;
}
