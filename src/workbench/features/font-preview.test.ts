import { describe, expect, it } from "vitest";
import { fontKeyFromName, looksLikeFont, xorFont } from "./font-preview";

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
