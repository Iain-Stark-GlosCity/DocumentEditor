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

describe("byte-exact round trips of real-world inputs", () => {
  const u8 = (...parts: Array<string | number[]>): Uint8Array =>
    Uint8Array.from(
      parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)),
    );
  const utf16 = (text: string, little: boolean, bom: boolean): Uint8Array => {
    const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
    const view = new DataView(out.buffer);
    if (bom) view.setUint16(0, 0xfeff, little);
    for (let i = 0; i < text.length; i++) {
      view.setUint16((bom ? 2 : 0) + i * 2, text.charCodeAt(i), little);
    }
    return out;
  };
  const BOM8 = [0xef, 0xbb, 0xbf];
  /** Byte equality across realms (jsdom's TextEncoder returns another realm's Uint8Array). */
  const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const cases: Array<[string, Uint8Array]> = [
    ["empty", new Uint8Array(0)],
    ["UTF-8 BOM only", u8(BOM8)],
    ["two UTF-8 BOMs (the second is text)", u8(BOM8, BOM8, "a")],
    ["CRLF with a final newline", u8("a\r\nb\r\n")],
    ["CRLF without a final newline", u8("a\r\nb")],
    ["LF without a final newline", u8("a\nb")],
    ["a lone newline", u8("\n")],
    ["a lone CRLF", u8("\r\n")],
    ["old Mac CR only", u8("a\rb\rc")],
    ["CR before CRLF", u8("a\r\r\nb\r\r\n")],
    ["U+2028 and U+2029 are text, not line breaks", u8("a b c\n")],
    ["NUL bytes", u8([0], "a", [0, 0], "\n")],
    ["UTF-16LE without a BOM reads as UTF-8 with NULs", utf16("ab\r\n", true, false)],
    ["UTF-8 BOM with CRLF", u8(BOM8, "x\r\ny\r\n")],
    ["UTF-16LE with CRLF and an astral character", utf16("a\r\n\u{1F600}\r\n", true, true)],
    ["UTF-16BE with LF and U+2028", utf16("a\n \nz", false, true)],
    ["UTF-16LE BOM only", utf16("", true, true)],
    ["UTF-16BE CR only", utf16("a\rb", false, true)],
  ];
  for (const [label, bytes] of cases) {
    it(label, () => {
      const { text, format } = decodePartText(bytes);
      expect(format.mixedEol).toBe(false);
      expect(sameBytes(encodePartText(text, format), bytes)).toBe(true);
    });
  }

  it("round-trips large files exactly (8 MB UTF-8 CRLF, 8 MB UTF-16LE)", () => {
    const line = "<w:p>Paragraph with café and \u{1F600}</w:p>\r\n";
    const big = line.repeat(Math.ceil((8 * 1024 * 1024) / line.length));
    const utf8 = new TextEncoder().encode(big);
    const decoded = decodePartText(utf8);
    expect(decoded.format.eol).toBe("crlf");
    expect(decoded.text.includes("\r")).toBe(false);
    expect(sameBytes(encodePartText(decoded.text, decoded.format), utf8)).toBe(true);
    const wide = utf16(big, true, true);
    const back = decodePartText(wide);
    expect(back.format.encoding).toBe("utf-16le");
    expect(sameBytes(encodePartText(back.text, back.format), wide)).toBe(true);
  });

  it("refuses every invalid UTF-8 form rather than replacing it", () => {
    for (const bad of [
      [0xc0, 0x80], // overlong NUL
      [0xed, 0xa0, 0x80], // a surrogate encoded in UTF-8
      [0xf8, 0x88, 0x80, 0x80, 0x80], // five-byte form
      [0xf4, 0x90, 0x80, 0x80], // above U+10FFFF
      [0x61, 0xe2, 0x82], // truncated at the end
    ]) {
      expect(() => decodePartText(Uint8Array.from(bad)), bad.join(",")).toThrow(/UTF-8/);
    }
  });

  it("normalises mixed endings only when it says so (mixedEol), to the dominant style", () => {
    const { text, format } = decodePartText(u8("a\r\nb\r\nc\n"));
    expect(format).toMatchObject({ eol: "crlf", mixedEol: true });
    expect(sameBytes(encodePartText(text, format), u8("a\r\nb\r\nc\r\n"))).toBe(true);
  });

  it("refuses to encode text with an unpaired surrogate instead of corrupting it", () => {
    const formats: FileFormat[] = [
      { encoding: "utf-8", bom: false, eol: "lf", mixedEol: false },
      { encoding: "utf-16le", bom: true, eol: "lf", mixedEol: false },
      { encoding: "utf-16be", bom: true, eol: "crlf", mixedEol: false },
    ];
    for (const format of formats) {
      for (const bad of ["a\uD800b", "a\uDC00", "\uD83D", "x\uDE00\uD83D"]) {
        expect(() => encodePartText(bad, format), format.encoding).toThrow(/unpaired surrogate/);
      }
      // A proper pair is fine, and reads back exactly.
      const ok = encodePartText("a😀b", format);
      expect(decodePartText(ok).text).toBe("a😀b");
    }
  });
});
