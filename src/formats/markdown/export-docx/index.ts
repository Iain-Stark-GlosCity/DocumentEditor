/**
 * Markdown to a Word document. This is a placeholder that keeps the export command working end to
 * end (one paragraph per blank-line-separated block); the real converter replaces it.
 */
import type { ExportContext } from "../../../core/format";

export async function markdownToDocx(text: string, context: ExportContext): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== "");
  const doc = new Document({
    title: context.title,
    sections: [
      {
        children: blocks.map((b) => new Paragraph({ children: [new TextRun(b.trim())] })),
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
