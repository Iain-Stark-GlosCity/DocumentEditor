/**
 * Markdown syntax for images and file links. The destination is percent-encoded rather than
 * wrapped in `<…>`, so the result is a plain, widely understood link. Only characters that would
 * end or confuse a link destination are encoded; other characters, including non-ASCII, stay
 * readable.
 */

// Control characters are exactly what must be encoded in a link destination.
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_DESTINATION = /[\s%()<>[\]#?"'`\\\u0000-\u001f\u007f]/g;

export function encodeDestination(path: string): string {
  return path.replace(UNSAFE_IN_DESTINATION, (c) =>
    // `encodeURIComponent` leaves parentheses and quotes alone, so ASCII is encoded by hand;
    // the only non-ASCII matches are Unicode spaces, which it handles.
    c.charCodeAt(0) < 128
      ? `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
      : encodeURIComponent(c),
  );
}

/** Brackets and backslashes would end or alter the label; line breaks are not allowed in it. */
export function escapeLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\\[\]]/g, (c) => `\\${c}`)
    .trim();
}

/** `![alt](./assets/a%20b.png)`. */
export function markdownImage(path: string, alt: string): string {
  return `![${escapeLabel(alt)}](${encodeDestination(path)})`;
}

/** `[text](./notes/a%20b.pdf)`. */
export function markdownLink(path: string, text: string): string {
  return `[${escapeLabel(text)}](${encodeDestination(path)})`;
}
