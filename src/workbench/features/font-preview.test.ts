import { afterEach, describe, expect, it, vi } from "vitest";
import { fontKeyFromName, loadFontPreview, looksLikeFont, xorFont } from "./font-preview";

describe("fontKeyFromName", () => {
  it("reads the GUID backwards, last byte first", () => {
    const key = fontKeyFromName("{00112233-4455-6677-8899-AABBCCDDEEFF}.odttf");
    expect(Array.from(key ?? [])).toEqual([
      0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11,
      0x00,
    ]);
  });
  it("accepts a name without braces or dashes and ignores a name with no GUID", () => {
    expect(fontKeyFromName("00112233445566778899aabbccddeeff.odttf")).not.toBeNull();
    expect(fontKeyFromName("font1.odttf")).toBeNull();
  });
});

describe("xorFont", () => {
  const key = fontKeyFromName("{00112233-4455-6677-8899-AABBCCDDEEFF}.odttf")!;
  const plain = Uint8Array.from([0, 1, 0, 0, ...Array.from({ length: 60 }, (_, i) => i)]);
  it("changes only the first 32 bytes and undoes itself", () => {
    const hidden = xorFont(plain, key);
    expect(Array.from(hidden.slice(32))).toEqual(Array.from(plain.slice(32)));
    expect(Array.from(hidden.slice(0, 32))).not.toEqual(Array.from(plain.slice(0, 32)));
    expect(Array.from(xorFont(hidden, key))).toEqual(Array.from(plain));
  });
  it("does not change its input and copes with short data", () => {
    const copy = plain.slice();
    xorFont(plain, key);
    expect(Array.from(plain)).toEqual(Array.from(copy));
    expect(xorFont(new Uint8Array([1, 2]), key)).toHaveLength(2);
  });
});

describe("looksLikeFont", () => {
  it("recognises the common font signatures only", () => {
    expect(looksLikeFont(Uint8Array.from([0, 1, 0, 0, 9]))).toBe(true);
    expect(looksLikeFont(new TextEncoder().encode("OTTO...."))).toBe(true);
    expect(looksLikeFont(new TextEncoder().encode("wOF2...."))).toBe(true);
    expect(looksLikeFont(new TextEncoder().encode("PNG....."))).toBe(false);
    expect(looksLikeFont(new Uint8Array(2))).toBe(false);
  });
});

describe("loadFontPreview", () => {
  const NAME = "{00112233-4455-6677-8899-AABBCCDDEEFF}.odttf";
  const key = fontKeyFromName(NAME)!;
  const plain = Uint8Array.from([0, 1, 0, 0, ...Array.from({ length: 60 }, (_, i) => i)]);
  const added = new Set<unknown>();
  const sources: ArrayBuffer[] = [];
  let failLoad = false;

  function stub() {
    class FakeFontFace {
      constructor(
        public family: string,
        source: ArrayBuffer,
      ) {
        sources.push(source);
      }
      load() {
        return failLoad ? Promise.reject(new Error("bad font")) : Promise.resolve();
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add: (f: unknown) => added.add(f), delete: (f: unknown) => added.delete(f) },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
    added.clear();
    sources.length = 0;
    failLoad = false;
  });

  it("resolves null where the browser has no FontFace", async () => {
    expect(await loadFontPreview("a.ttf", plain)).toBeNull();
  });

  it("adds a plain font under a unique family and removes it on release", async () => {
    stub();
    const a = await loadFontPreview("a.ttf", plain);
    const b = await loadFontPreview("b.ttf", plain);
    expect(a?.family).toMatch(/^part-preview-\d+$/);
    expect(a?.family).not.toBe(b?.family);
    expect(added.size).toBe(2);
    a?.release();
    expect(added.size).toBe(1);
    b?.release();
    expect(added.size).toBe(0);
  });

  it("undoes the obfuscation of an odttf font from the GUID in its name", async () => {
    stub();
    const preview = await loadFontPreview(NAME, xorFont(plain, key));
    expect(preview).not.toBeNull();
    expect(Array.from(new Uint8Array(sources[0]!))).toEqual(Array.from(plain));
  });

  it("resolves null, and adds nothing, for bytes that are not a font or fail to load", async () => {
    stub();
    expect(await loadFontPreview("a.ttf", new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(await loadFontPreview("plain-name.odttf", xorFont(plain, key))).toBeNull();
    failLoad = true;
    expect(await loadFontPreview("a.ttf", plain)).toBeNull();
    expect(added.size).toBe(0);
  });

  it("copes with bytes that are a view into a larger buffer", async () => {
    stub();
    const big = new Uint8Array(200);
    big.set(plain, 100);
    await loadFontPreview("a.ttf", big.subarray(100, 100 + plain.length));
    expect(Array.from(new Uint8Array(sources[0]!))).toEqual(Array.from(plain));
  });
});
