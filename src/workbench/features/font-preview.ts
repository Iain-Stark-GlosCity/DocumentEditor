/**
 * Previewing a font from a container. Word embeds fonts as `.odttf`: an ordinary TrueType font
 * whose first 32 bytes are XOR-ed with the GUID in the file's name, written backwards (ECMA-376
 * Part 1, 17.8.1). The font is loaded into the page with the `FontFace` API from the bytes
 * themselves, which involves no network fetch and so no change to the content security policy.
 */

const GUID = /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/i;

/** The 16 key bytes for an obfuscated font file name, or null if the name holds no GUID. */
export function fontKeyFromName(name: string): Uint8Array | null {
  const m = GUID.exec(name);
  if (!m) return null;
  const hex = m.slice(1).join("");
  const bytes = new Uint8Array(16);
  // The GUID's hex digits, last pair first.
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(30 - i * 2, 32 - i * 2), 16);
  return bytes;
}

/** Applies (or removes: it is its own inverse) the font obfuscation. Returns a new array. */
export function xorFont(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  const out = bytes.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] = (out[i] ?? 0) ^ (key[i % 16] ?? 0);
  return out;
}

/** True if the bytes start like a TrueType, OpenType, WOFF or WOFF2 font. */
export function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  return (
    tag === "OTTO" ||
    tag === "true" ||
    tag === "wOFF" ||
    tag === "wOF2" ||
    (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
  );
}

export const FONT_EXTENSIONS = ["ttf", "otf", "odttf", "woff", "woff2"];

export interface FontPreview {
  /** The CSS family name to use in the preview, unique to this preview. */
  family: string;
  /** Removes the font from the page. */
  release(): void;
}

let counter = 0;

/**
 * Loads the font for preview. Resolves null if it cannot be read as a font (an obfuscated font
 * with no usable key, a damaged file, or a browser without `FontFace`).
 */
export async function loadFontPreview(
  name: string,
  bytes: Uint8Array,
): Promise<FontPreview | null> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return null;
  let data = bytes;
  if (!looksLikeFont(data)) {
    const key = fontKeyFromName(name);
    if (key) data = xorFont(bytes, key);
  }
  if (!looksLikeFont(data)) return null;
  const family = `part-preview-${++counter}`;
  try {
    const face = new FontFace(
      family,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    await face.load();
    document.fonts.add(face);
    return { family, release: () => void document.fonts.delete(face) };
  } catch {
    return null;
  }
}
