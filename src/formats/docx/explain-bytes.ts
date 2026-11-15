/** Bytes of a .docx to the explanation of one element. Loaded with `import()`. */
import { readZip } from "../../core/archive";
import type { Explanation } from "../../core/explain";
import { decodePart } from "./decode";
import { explainParagraph } from "./explain";

export async function explainDocxBytes(
  bytes: Uint8Array,
  context: { path: string; part: string; locator: string },
): Promise<Explanation | null> {
  const zip = readZip(bytes);
  const names = zip.entries.filter((e) => !e.isDirectory).map((e) => e.name);
  return explainParagraph(
    {
      names: () => names,
      text(name) {
        const info = zip.info(name);
        if (!info || info.isDirectory) return undefined;
        try {
          return decodePart(zip.bytes(name));
        } catch {
          return undefined;
        }
      },
    },
    context.part,
    context.locator,
  );
}
