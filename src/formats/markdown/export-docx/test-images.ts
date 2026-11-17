/**
 * Tiny hand-made pictures for the export tests: real headers, as each format's specification lays
 * them out, with only as much body as a reader of the header needs.
 */

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];
const i32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** A PNG signature and IHDR chunk (8-bit RGBA), followed by an IEND chunk. */
export function pngBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
    ...u32be(0), // CRC (not checked by the size reader)
    ...u32be(0),
    0x49,
    0x45,
    0x4e,
    0x44,
    0xae,
    0x42,
    0x60,
    0x82,
  ]);
}

/** A JFIF JPEG: SOI, an APP0 segment, a comment, a baseline (or other) frame header, EOI. */
export function jpegBytes(width: number, height: number, sof = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...u16be(16),
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    1,
    1,
    0,
    ...u16be(1),
    ...u16be(1),
    0,
    0,
    0xff,
    0xfe,
    ...u16be(6),
    0x68,
    0x69,
    0x21,
    0x21, // COM "hi!!"
    0xff,
    0xff, // fill byte before the next marker
    0xff,
    sof,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}

/** A GIF89a logical screen descriptor and trailer. */
export function gifBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    ...u16le(width),
    ...u16le(height),
    0,
    0,
    0,
    0x3b,
  ]);
}

/** A BMP file header and BITMAPINFOHEADER (24-bit); a negative height is a top-down bitmap. */
export function bmpBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x42,
    0x4d,
    ...i32le(54),
    0,
    0,
    0,
    0,
    ...i32le(54),
    ...i32le(40),
    ...i32le(width),
    ...i32le(height),
    ...u16le(1),
    ...u16le(24),
    ...i32le(0),
    ...i32le(0),
    ...i32le(2835),
    ...i32le(2835),
    ...i32le(0),
    ...i32le(0),
  ]);
}

export const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
);
export const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
