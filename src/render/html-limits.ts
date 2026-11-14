/**
 * Limits and fixed messages of the HTML preview. Kept apart from `html.ts` so the HTML format can
 * check the size without loading the parser and sanitiser (CLAUDE.md rule 6).
 */

/** Documents longer than this many characters (about 5 MB of ASCII) are not previewed. */
export const HTML_PREVIEW_LIMIT = 5 * 1024 * 1024;

/** The class of the one note at the top of the preview. The sanitiser allows only this value. */
export const HTML_NOTE_CLASS = "html-preview-note";

/** What the note says. */
export const HTML_NOTE_TEXT = "Simplified preview: styles and scripts are not shown";

/** The message shown instead of a preview for a very large document. Fixed, trusted markup. */
export const HTML_TOO_LARGE =
  `<p class="${HTML_NOTE_CLASS} html-preview-too-large">` +
  "This file is too large to preview (over 5 MB). You can still edit it in the source view." +
  "</p>";

export function isTooLargeForPreview(text: string): boolean {
  return text.length > HTML_PREVIEW_LIMIT;
}
