/**
 * Bytes to editor text and back, for the text parts of a container file (and anything else the
 * app holds as bytes). The same rules as the desktop file reader: detect a BOM (UTF-8, UTF-16 LE
 * or BE), otherwise strict UTF-8; detect the dominant line ending and give the editor `\n` only.
 * `encodePartText(decode…)` is exact for text that did not mix line endings.
 *
 * Differences from a text file: a part with no line endings at all is `lf` (OOXML parts are LF, so
 * tidying a one-line part later must not inject CRLF), and invalid bytes throw instead of being
 * replaced, because a lossy decode followed by a save would corrupt the part.
 */
import type { FileFormat } from "../platform/platform";

export interface DecodedText {
  text: string;
  format: FileFormat;
}

function utf8Decoder(): TextDecoder {
  // fatal: invalid sequences throw. ignoreBOM: leave the BOM alone (we strip it ourselves).
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
}

function decodeUtf16(body: Uint8Array, littleEndian: boolean): string {
  if (body.length % 2 !== 0) {
    throw new Error("The text is not valid UTF-16 (it has an odd number of bytes)");
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const units: number[] = [];
  for (let i = 0; i < body.length; i += 2) units.push(view.getUint16(i, littleEndian));
  // Validate surrogate pairs; a lone surrogate would not survive a round trip.
  for (let i = 0; i < units.length; i++) {
    const unit = units[i] as number;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = units[i + 1];
      if (next === undefined || next < 0xdc00 || next > 0xdfff) {
        throw new Error("The text is not valid UTF-16 (unpaired surrogate)");
      }
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("The text is not valid UTF-16 (unpaired surrogate)");
    }
  }
  let out = "";
  const chunk = 8192;
  for (let i = 0; i < units.length; i += chunk) {
    out += String.fromCharCode(...units.slice(i, i + chunk));
  }
  return out;
}

export function decodePartText(bytes: Uint8Array): DecodedText {
  let encoding: FileFormat["encoding"] = "utf-8";
  let bom = false;
  let body = bytes;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bom = true;
    body = bytes.subarray(3);
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    bom = true;
    body = bytes.subarray(2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    bom = true;
    body = bytes.subarray(2);
  }

  let raw: string;
  if (encoding === "utf-8") {
    try {
      raw = utf8Decoder().decode(body);
    } catch {
      throw new Error("The text is not valid UTF-8, so it cannot be opened as text");
    }
  } else {
    raw = decodeUtf16(body, encoding === "utf-16le");
  }

  let crlf = 0;
  let lf = 0;
  for (let i = raw.indexOf("\n"); i !== -1; i = raw.indexOf("\n", i + 1)) {
    if (i > 0 && raw.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  const eol = crlf > lf ? "crlf" : "lf";
  const text = crlf > 0 ? raw.replaceAll("\r\n", "\n") : raw;
  return { text, format: { encoding, bom, eol, mixedEol: crlf > 0 && lf > 0 } };
}

/** An unpaired surrogate: UTF-8 would replace it with U+FFFD, UTF-16 would write bytes that
 *  `decodePartText` then refuses. Either way the saved part would not read back as the text. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Throws if `text` cannot be written exactly (it holds an unpaired surrogate). */
export function encodePartText(text: string, format: FileFormat): Uint8Array {
  const lone = LONE_SURROGATE.exec(text);
  if (lone) {
    throw new Error(
      `The text has an invalid character (an unpaired surrogate) at offset ${lone.index}, which cannot be saved exactly`,
    );
  }
  const body = format.eol === "crlf" ? text.replaceAll("\n", "\r\n") : text;
  if (format.encoding === "utf-8") {
    const encoded = new TextEncoder().encode(body);
    if (!format.bom) return encoded;
    const out = new Uint8Array(encoded.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(encoded, 3);
    return out;
  }
  const little = format.encoding === "utf-16le";
  const offset = format.bom ? 2 : 0;
  const out = new Uint8Array(offset + body.length * 2);
  const view = new DataView(out.buffer);
  if (format.bom) view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < body.length; i++) view.setUint16(offset + i * 2, body.charCodeAt(i), little);
  return out;
}
