/**
 * What a Markdown link becomes in Word. Web and mail addresses become hyperlinks, `#fragment` links
 * to a heading become links to the bookmark on it, and everything else (relative paths, `file:`,
 * `javascript:` and other schemes) keeps its text only, because a Word link to it would be broken
 * or unsafe.
 */

export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "internal"; anchor: string }
  /** Not a link in Word. `address` is shown after the text when it adds something. */
  | { kind: "none"; address?: string };

/** Longest address shown in brackets after a link's text; longer ones (data: URLs) are left out. */
const MAX_SHOWN_ADDRESS = 200;

/** Characters that may stand as they are in a URI (RFC 3986 reserved and unreserved, and `%`). */
const URI_CHAR = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/;

/** Percent-encodes anything that may not appear in a URI, so Word accepts the relationship. */
export function encodeUri(url: string): string {
  let out = "";
  const chars = Array.from(url);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (ch === "%") {
      const hex = (chars[i + 1] ?? "") + (chars[i + 2] ?? "");
      out += /^[0-9A-Fa-f]{2}$/.test(hex) ? "%" : "%25";
    } else if (ch.length === 1 && URI_CHAR.test(ch)) {
      out += ch;
    } else {
      try {
        out += encodeURIComponent(ch);
      } catch {
        // A lone surrogate cannot be encoded; it is dropped.
      }
    }
  }
  return out;
}

/** A web or mail address that is safe to make a Word hyperlink, or null. */
export function externalUrl(url: string): string | null {
  const trimmed = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === "mailto") return trimmed.length > "mailto:".length ? encodeUri(trimmed) : null;
  if (scheme !== "http" && scheme !== "https") return null;
  const encoded = encodeUri(trimmed);
  try {
    const parsed = new URL(encoded);
    return parsed.hostname === "" ? null : encoded;
  } catch {
    return null;
  }
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * Decides what a link becomes. `anchors` maps heading slugs to bookmark names; `text` is the
 * link's visible text.
 */
export function classifyLink(
  url: string,
  text: string,
  anchors: ReadonlyMap<string, string>,
): LinkTarget {
  const trimmed = url.trim();
  if (trimmed.startsWith("#")) {
    const anchor = anchors.get(decodeFragment(trimmed.slice(1)));
    // A fragment that points at nothing in this document is not worth showing.
    return anchor === undefined ? { kind: "none" } : { kind: "internal", anchor };
  }
  const external = externalUrl(trimmed);
  if (external !== null) return { kind: "external", url: external };
  if (trimmed === "" || trimmed === text.trim() || trimmed.length > MAX_SHOWN_ADDRESS) {
    return { kind: "none" };
  }
  return { kind: "none", address: trimmed };
}
