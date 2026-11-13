/**
 * Images `![alt](src "title")`, drawn as block widgets in the block pass.
 *
 * - An image alone on its line (outside quotes and lists) replaces the whole line while no
 *   selection is on that line.
 * - Any other image hides its source while no selection touches it, and is drawn below its line.
 * - While the source is revealed, the image stays drawn below the line, so entering and leaving
 *   the construct changes the layout as little as possible.
 */
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { LiveOptions, LiveRenderer } from "../types";
import { ImageWidget, type ImageSource } from "../widgets";

const REMOTE = /^(https?:)?\/\//i;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** Decides what URL an image source may be loaded from. Mirrors the preview's rules. */
export function imageSource(raw: string, options: LiveOptions): ImageSource {
  const src = raw.trim();
  if (src === "") return { kind: "blocked", reason: "This image has no address" };
  if (/^data:image\/(png|gif|jpe?g|webp|avif|bmp);/i.test(src)) return { kind: "url", url: src };
  if (REMOTE.test(src)) {
    if (!options.loadRemoteImages()) {
      return { kind: "blocked", reason: "Remote images are turned off in settings" };
    }
    return { kind: "url", url: src.startsWith("//") ? `https:${src}` : src };
  }
  const scheme = SCHEME.exec(src)?.[1];
  // A one-letter "scheme" is a Windows drive (`C:\`), which is a path.
  if (scheme !== undefined && scheme.length > 1) {
    return { kind: "blocked", reason: "This image address is not allowed" };
  }
  const url = options.resolveAsset?.(src) ?? "";
  return url
    ? { kind: "url", url }
    : { kind: "blocked", reason: "Save the document to show images beside it" };
}

function inContainer(node: SyntaxNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === "Blockquote" || p.name === "ListItem") return true;
  }
  return false;
}

export const image: LiveRenderer = {
  id: "image",
  nodes: ["Image"],
  // Nothing inline: the block pass owns images, and their alt text is not rendered.
  decorate: () => false,
  decorateBlock(n, out) {
    const doc = out.state.doc;
    const line = doc.lineAt(n.from);
    if (n.to > line.to) return false; // An image split over lines stays as source.
    const marks = n.getChildren("LinkMark");
    const open = marks[0];
    const close = marks[1];
    const url = n.getChild("URL");
    if (!open || !close || !url) return false; // Reference images stay as source.
    const alt = doc.sliceString(open.to, close.from);
    const titleNode = n.getChild("LinkTitle");
    const title = titleNode ? doc.sliceString(titleNode.from + 1, titleNode.to - 1) : "";
    const source = imageSource(
      doc.sliceString(url.from, url.to).replace(/^<|>$/g, ""),
      out.options,
    );
    const lone = line.text.trim() === doc.sliceString(n.from, n.to) && !inContainer(n);

    if (lone && !out.linesTouched(n.from, n.to)) {
      out.add(
        line.from,
        line.to,
        Decoration.replace({ widget: new ImageWidget(source, alt, title, 0), block: true }),
      );
      return false;
    }
    if (!lone && !out.touches(n.from, n.to)) out.hide(n.from, n.to);
    out.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new ImageWidget(source, alt, title, line.to - n.from),
        block: true,
        side: 1,
      }),
    );
    return false;
  },
};
