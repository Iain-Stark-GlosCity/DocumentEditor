/**
 * A "copy" button on each code block, added by the preview after the pipeline's HTML is in the
 * page (it is not part of the pipeline's output, so it never reaches an export).
 *
 * The button is a real `<button>` placed last in the `<pre>`, so it is reached with Tab after the
 * code, has a name through `aria-label`, and shows its visible text from CSS, which keeps the
 * block's own text (what a reader selects and copies by hand) free of the word "Copy".
 * It carries `data-preview-ui`, which the block updater ignores.
 */
import { UI_ATTRIBUTE } from "./blockDiff";

export const COPY_BUTTON_CLASS = "code-copy";
export const COPY_LABEL = "Copy code";

/** Adds a button to every code block under `root` that lacks one. Diagrams are skipped. */
export function addCopyButtons(root: ParentNode): void {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    if (pre.classList.contains("mermaid-source")) continue;
    if (pre.closest(".mermaid-diagram, .math-display")) continue;
    const code = pre.querySelector(":scope > code");
    if (!code) continue;
    if (pre.querySelector(`:scope > button.${COPY_BUTTON_CLASS}`)) continue;
    const button = pre.ownerDocument.createElement("button");
    button.type = "button";
    button.className = COPY_BUTTON_CLASS;
    button.setAttribute(UI_ATTRIBUTE, "");
    button.setAttribute("aria-label", COPY_LABEL);
    pre.append(button);
  }
}

/** The text a copy button copies: its block's code, exactly as written. */
export function codeText(button: Element): string {
  return button.closest("pre")?.querySelector(":scope > code")?.textContent ?? "";
}

/** Copies to the clipboard; falls back to a hidden textarea where the async API is refused. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older route.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  const active = document.activeElement as HTMLElement | null;
  document.body.append(area);
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  active?.focus();
  return copied;
}
