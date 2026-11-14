/**
 * Well-formedness check for XML parts, using the browser's own parser (`DOMParser`). Checks
 * syntax only (it does not validate against a schema), which is what stops a typo from turning a
 * document into a file that Word refuses to open.
 */

/** Returns null if the text is well-formed XML, else a short description with line and column. */
export function xmlProblem(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const failure = doc.getElementsByTagNameNS("*", "parsererror")[0] ?? null;
  if (!failure) return null;
  // Chromium appends "Below is a rendering of the page up to the first error." to the message
  // (it sits in the same text node as the reason, sometimes without a line break before it).
  const message = (failure.textContent ?? "")
    .replace(/\s*Below is a rendering of the page up to the first error\.?/gi, "")
    .trim();

  // Chromium (WebView2): "error on line 3 at column 7: Opening and ending tag mismatch ..."
  let match = /error on line (\d+) at column (\d+):\s*([^\n]*)/i.exec(message);
  if (match) return `line ${match[1]}, column ${match[2]}: ${match[3]}`;
  // Firefox: "XML Parse Error: mismatched tag ... Location: ... Line Number 3, Column 7:"
  match = /Line Number (\d+), Column (\d+)/i.exec(message);
  if (match) {
    const reason = /^(?:XML Parse Error:\s*)?([^\n]*)/i.exec(message)?.[1] ?? "";
    return `line ${match[1]}, column ${match[2]}: ${reason}`;
  }
  // Anything else (jsdom, saxes): "3:7: unexpected close tag." or free text.
  match = /^(\d+):(\d+):?\s*([^\n]*)/.exec(message);
  if (match) return `line ${match[1]}, column ${match[2]}: ${match[3]}`;
  const first = message.split("\n").find((line) => line.trim() !== "") ?? "";
  return first || "the XML could not be parsed";
}
