/**
 * Text that is safe to put in a Word part. XML 1.0 forbids most C0 control characters, U+FFFE,
 * U+FFFF and unpaired surrogates; one of them in `document.xml` makes Word report the whole file as
 * corrupt. They are removed (never replaced), so the rest of the text is unchanged.
 */

const hex = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
const range = (from: number, to: number) => `${hex(from)}-${hex(to)}`;

/**
 * C0 controls other than tab, line feed and carriage return; U+FFFE and U+FFFF; a high surrogate
 * with no low one after it; a low surrogate with no high one before it. Built from code points so
 * that the source holds no control characters.
 */
const ILLEGAL = new RegExp(
  `[${range(0x00, 0x08)}${hex(0x0b)}${hex(0x0c)}${range(0x0e, 0x1f)}${hex(0xfffe)}${hex(0xffff)}]` +
    `|[${range(0xd800, 0xdbff)}](?![${range(0xdc00, 0xdfff)}])` +
    `|(?<![${range(0xd800, 0xdbff)}])[${range(0xdc00, 0xdfff)}]`,
  "g",
);

/** Removes the characters XML 1.0 does not allow. Tab, line feed and carriage return are kept. */
export function xmlSafe(text: string): string {
  return text.replace(ILLEGAL, "");
}

/** `xmlSafe`, and carriage returns too: for text that goes into a single run. */
export function runSafe(text: string): string {
  return xmlSafe(text).replace(/\r/g, "");
}
