import { describe, expect, it } from "vitest";
import {
  classifyImage,
  fitToPage,
  MAX_HEIGHT_PX,
  MAX_WIDTH_PX,
  readPixelSize,
  sniffImageKind,
} from "./images";
import { bmpBytes, gifBytes, jpegBytes, pngBytes, SVG_BYTES, WEBP_BYTES } from "./test-images";

describe("sniffImageKind", () => {
  it("knows PNG, JPEG, GIF and BMP from their bytes", () => {
    expect(sniffImageKind(pngBytes(1, 1))).toBe("png");
    expect(sniffImageKind(jpegBytes(1, 1))).toBe("jpg");
    expect(sniffImageKind(gifBytes(1, 1))).toBe("gif");
    expect(sniffImageKind(bmpBytes(1, 1))).toBe("bmp");
  });

  it("refuses SVG, WebP, text and truncated signatures", () => {
    expect(sniffImageKind(SVG_BYTES)).toBeNull();
    expect(sniffImageKind(WEBP_BYTES)).toBeNull();
    expect(sniffImageKind(new TextEncoder().encode("hello"))).toBeNull();
    expect(sniffImageKind(pngBytes(1, 1).slice(0, 5))).toBeNull();
    expect(sniffImageKind(new Uint8Array())).toBeNull();
    expect(sniffImageKind(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x38, 0x61]))).toBeNull();
  });
});

describe("readPixelSize", () => {
  it("reads PNG IHDR", () => {
    expect(readPixelSize(pngBytes(1200, 600), "png")).toEqual({ width: 1200, height: 600 });
  });

  it("reads the JPEG frame header past APP0, comments and fill bytes", () => {
    expect(readPixelSize(jpegBytes(640, 480), "jpg")).toEqual({ width: 640, height: 480 });
    expect(readPixelSize(jpegBytes(300, 200, 0xc2), "jpg")).toEqual({ width: 300, height: 200 });
  });

  it("does not take a DHT or DAC marker for a frame header", () => {
    const bytes = jpegBytes(10, 20);
    const sof = bytes.indexOf(0xc0, 20);
    bytes[sof] = 0xc4; // DHT: a table, not a frame
    expect(readPixelSize(bytes, "jpg")).toBeNull();
  });

  it("reads GIF and BMP, including top-down BMPs", () => {
    expect(readPixelSize(gifBytes(320, 240), "gif")).toEqual({ width: 320, height: 240 });
    expect(readPixelSize(bmpBytes(64, 32), "bmp")).toEqual({ width: 64, height: 32 });
    expect(readPixelSize(bmpBytes(64, -32), "bmp")).toEqual({ width: 64, height: 32 });
  });

  it("gives null for truncated, zero-sized or absurd headers", () => {
    expect(readPixelSize(pngBytes(10, 10).slice(0, 20), "png")).toBeNull();
    expect(readPixelSize(pngBytes(0, 10), "png")).toBeNull();
    expect(readPixelSize(pngBytes(1_000_000, 10), "png")).toBeNull();
    expect(readPixelSize(jpegBytes(10, 10).slice(0, 30), "jpg")).toBeNull();
    expect(readPixelSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), "jpg")).toBeNull();
    expect(readPixelSize(gifBytes(0, 0), "gif")).toBeNull();
    expect(readPixelSize(bmpBytes(5, 5).slice(0, 20), "bmp")).toBeNull();
  });
});

describe("fitToPage", () => {
  it("never scales up", () => {
    expect(fitToPage({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
  });

  it("scales a wide picture down to the 6 inch column, keeping its proportions", () => {
    expect(fitToPage({ width: 1200, height: 600 })).toEqual({ width: MAX_WIDTH_PX, height: 288 });
  });

  it("scales a tall picture down to fit the page", () => {
    const size = fitToPage({ width: 500, height: 5000 });
    expect(size.height).toBe(MAX_HEIGHT_PX);
    expect(size.width).toBe(Math.round(500 * (MAX_HEIGHT_PX / 5000)));
  });

  it("never gives a zero side", () => {
    expect(fitToPage({ width: 100_000, height: 1 })).toEqual({ width: MAX_WIDTH_PX, height: 1 });
  });
});

describe("classifyImage", () => {
  it("says why a picture cannot be embedded", () => {
    expect(classifyImage(null)).toEqual({ ok: false, reason: "unavailable" });
    expect(classifyImage(new Uint8Array())).toEqual({ ok: false, reason: "unavailable" });
    expect(classifyImage(SVG_BYTES)).toEqual({ ok: false, reason: "unsupported" });
    expect(classifyImage(pngBytes(10, 10).slice(0, 18))).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("accepts a readable picture", () => {
    const result = classifyImage(gifBytes(3, 4));
    expect(result).toMatchObject({ ok: true, kind: "gif", size: { width: 3, height: 4 } });
  });
});
