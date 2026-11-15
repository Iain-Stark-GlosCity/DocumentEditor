/**
 * Bytes of a .docx to the Formatting view. Loaded with `import()` from the provider, so the zip
 * reader and the generator stay out of the startup bundle.
 */
import { readZip } from "../../core/archive";
import type { DecodedView } from "../../core/format";
import { generateDocxViewMapped, MAX_MAIN_PART, type PartSource } from "./view";

/** Part bytes to text: UTF-8 by default, UTF-16 when a BOM says so; the BOM is dropped. */
export function decodePart(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function decodeDocx(
  bytes: Uint8Array,
  context: { path: string },
): Promise<DecodedView> {
  void context;
  const zip = readZip(bytes);
  if (!zip.has("word/document.xml")) {
    throw new Error("This file does not look like a Word document: it has no word/document.xml");
  }
  const names = zip.entries.filter((e) => !e.isDirectory).map((e) => e.name);
  const cache = new Map<string, string | undefined>();
  const source: PartSource = {
    names: () => names,
    text(name) {
      if (cache.has(name)) return cache.get(name);
      let text: string | undefined;
      const info = zip.info(name);
      if (info && !info.isDirectory) {
        // A part too large to show: hand over a stand-in of the right length rather than
        // decoding it (the generator reports the size and stops).
        if (name === "word/document.xml" && info.size > MAX_MAIN_PART) text = " ".repeat(info.size);
        else {
          try {
            text = decodePart(zip.bytes(name));
          } catch {
            text = undefined;
          }
        }
      }
      cache.set(name, text);
      return text;
    },
  };
  return generateDocxViewMapped(source);
}
