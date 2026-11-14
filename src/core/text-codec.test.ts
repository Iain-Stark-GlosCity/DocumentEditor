import { describe, expect, it } from "vitest";
import type { Encoding, Eol, FileFormat } from "../platform/platform";
import { decodePartText, encodePartText } from "./text-codec";

const encodings: Encoding[] = ["utf-8", "utf-16le", "utf-16be"];
const eols: Eol[] = ["lf", "crlf"];
const samples = ["", "one line", "a\nb\n", "tab\there\n\nend", "café \u{1F600} 中文\n", "a\rb"];

describe("text codec round trips", () => {
  for (const encoding of encodings) {
    for (const bom of [false, true]) {
      // UTF-16 without a BOM cannot be detected, so it is only a valid input with one.
      if (encoding !== "utf-8" && !bom) continue;
      for (const eol of eols) {
        for (const text of samples) {
          const label = `${encoding} bom=${bom} ${eol} ${JSON.stringify(text)}`;
          it(label, () => {
            const format: FileFormat = { encoding, bom, eol, mixedEol: false };
            const bytes = encodePartText(text, format);
            const back = decodePartText(bytes);
            expect(back.text).toBe(text);
            expect(back.format.encoding).toBe(encoding);
            expect(back.format.bom).toBe(bom);
            // Text with no newline has no line ending to detect: it reads as lf.
            if (text.includes("\n")) expect(back.format.eol).toBe(eol);
            else expect(back.format.eol).toBe("lf");
            expect(back.format.mixedEol).toBe(false);
            // And the exact inverse, byte for byte, when the eol was detected.
            expect(encodePartText(back.text, back.format)).toEqual(bytes);
          });
        }
      }
    }
  }
});

describe("decodePartText", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("reads empty input as empty LF text", () => {
    expect(decodePartText(new Uint8Array())).toEqual({
      text: "",
      format: { encoding: "utf-8", bom: false, eol: "lf", mixedEol: false },
    });
  });

  it("gives a part with no line endings eol lf, so tidying later adds no CRLF", () => {
    expect(decodePartText(bytes("<a/>")).format.eol).toBe("lf");
  });

  it("keeps a lone carriage return in the text and reports no mixing", () => {
    const decoded = decodePartText(bytes("a\rb\r"));
    expect(decoded.text).toBe("a\rb\r");
    expect(decoded.format.eol).toBe("lf");
    expect(decoded.format.mixedEol).toBe(false);
    expect(encodePartText(decoded.text, decoded.format)).toEqual(bytes("a\rb\r"));
  });

  it("detects the dominant ending of mixed text and flags it", () => {
    const decoded = decodePartText(bytes("a\r\nb\r\nc\nd"));
    expect(decoded.text).toBe("a\nb\nc\nd");
    expect(decoded.format).toMatchObject({ eol: "crlf", mixedEol: true });
    const other = decodePartText(bytes("a\nb\nc\r\nd"));
    expect(other.format).toMatchObject({ eol: "lf", mixedEol: true });
  });

  it("throws on invalid UTF-8 instead of decoding lossily", () => {
    expect(() => decodePartText(Uint8Array.from([0x61, 0xff, 0x62]))).toThrow(/not valid UTF-8/);
    expect(() => decodePartText(Uint8Array.from([0xc3]))).toThrow(/not valid UTF-8/);
  });

  it("throws on malformed UTF-16", () => {
    expect(() => decodePartText(Uint8Array.from([0xff, 0xfe, 0x61]))).toThrow(/UTF-16/);
    expect(() => decodePartText(Uint8Array.from([0xff, 0xfe, 0x00, 0xd8]))).toThrow(/UTF-16/);
    expect(() => decodePartText(Uint8Array.from([0xff, 0xfe, 0x00, 0xdc]))).toThrow(/UTF-16/);
  });

  it("does not treat a BOM as text", () => {
    expect(decodePartText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])).text).toBe("a");
    expect(decodePartText(Uint8Array.from([0xfe, 0xff, 0x00, 0x61])).text).toBe("a");
  });
});
