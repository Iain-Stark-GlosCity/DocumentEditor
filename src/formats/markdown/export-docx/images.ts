/**
 * Pictures for the Word export: what kind of image some bytes are (from the bytes, never the file
 * name), how many pixels it has (read from its header) and how large to show it. Pure: no DOM, no
 * decoding of pixel data.
 */

/** The picture kinds Word shows inline and the `docx` package can embed. */
export type ImageKind = "png" | "jpg" | "gif" | "bmp";

export interface PixelSize {
  width: number;
  height: number;
}

/** Widest a picture is shown: the 6 inch text column, at 96 pixels to the inch. */
export const MAX_WIDTH_PX = 6 * 96;
/** Tallest a picture is shown, so that it always fits on an A4 page between the margins. */
export const MAX_HEIGHT_PX = 9 * 96;
/** Larger headers than this are not believed (a damaged file). */
const MAX_PIXELS_SIDE = 100_000;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((b, i) => bytes[at + i] === b);

/** The kind of picture, from its first bytes. Null for anything else (SVG, WebP, text...). */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39)) {
    return bytes[5] === 0x61 ? "gif" : null;
  }
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const i32le = (b: Uint8Array, i: number) =>
  b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24);

function sane(width: number, height: number): PixelSize | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1 || width > MAX_PIXELS_SIDE || height > MAX_PIXELS_SIDE) return null;
  return { width, height };
}

function pngSize(b: Uint8Array): PixelSize | null {
  // Signature (8), chunk length (4), "IHDR" (4), width (4), height (4).
  if (b.length < 24 || !startsWith(b, [0x49, 0x48, 0x44, 0x52], 12)) return null;
  return sane(u32be(b, 16), u32be(b, 20));
}

function gifSize(b: Uint8Array): PixelSize | null {
  if (b.length < 10) return null;
  return sane(u16le(b, 6), u16le(b, 8));
}

function bmpSize(b: Uint8Array): PixelSize | null {
  if (b.length < 26) return null;
  const header = i32le(b, 14);
  // BITMAPCOREHEADER has 16-bit sizes; every later header has 32-bit ones (height < 0 is top-down).
  if (header === 12) return sane(u16le(b, 18), u16le(b, 20));
  if (header < 16) return null;
  return sane(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)));
}

/** Start-of-frame markers: every baseline, progressive, lossless and arithmetic variant. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(b: Uint8Array): PixelSize | null {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker.
    while (i < b.length && b[i] === 0xff) i += 1;
    if (i >= b.length) return null;
    const marker = b[i]!;
    i += 1;
    // Markers without a length: TEM, RST0-7, SOI. EOI or SOS before a frame header: give up.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 2 > b.length) return null;
    const length = u16be(b, i);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      if (i + 7 > b.length) return null;
      return sane(u16be(b, i + 5), u16be(b, i + 3));
    }
    i += length;
  }
  return null;
}

/** Pixel size from the picture's header, or null when the header cannot be read. */
export function readPixelSize(bytes: Uint8Array, kind: ImageKind): PixelSize | null {
  switch (kind) {
    case "png":
      return pngSize(bytes);
    case "gif":
      return gifSize(bytes);
    case "bmp":
      return bmpSize(bytes);
    case "jpg":
      return jpegSize(bytes);
  }
}

/**
 * The size to show a picture at, in pixels at 96 to the inch: its own size, scaled down (never up)
 * to fit the text column and the page, keeping its proportions. Never smaller than one pixel.
 */
export function fitToPage(
  size: PixelSize,
  maxWidth = MAX_WIDTH_PX,
  maxHeight = MAX_HEIGHT_PX,
): PixelSize {
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Why a picture was written as its alternative text instead. */
export type DegradeReason =
  /** The file could not be read: missing, remote, too large, or the document is unsaved. */
  | "unavailable"
  /** A kind Word cannot show inline from this exporter (SVG, WebP, anything not a picture). */
  | "unsupported"
  /** A PNG, JPEG, GIF or BMP whose header could not be read. */
  | "unreadable";

export type ImageResult =
  | { ok: true; kind: ImageKind; data: Uint8Array; size: PixelSize }
  | { ok: false; reason: DegradeReason };

/** Decides what becomes of the bytes of one referenced picture. */
export function classifyImage(bytes: Uint8Array | null): ImageResult {
  if (bytes === null || bytes.length === 0) return { ok: false, reason: "unavailable" };
  const kind = sniffImageKind(bytes);
  if (kind === null) return { ok: false, reason: "unsupported" };
  const size = readPixelSize(bytes, kind);
  if (size === null) return { ok: false, reason: "unreadable" };
  return { ok: true, kind, data: bytes, size };
}
