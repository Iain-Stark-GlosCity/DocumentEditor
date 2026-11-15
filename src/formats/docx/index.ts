import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { TextFormatProvider } from "../../core/format";
import { outlineFromState } from "../markdown/outline";
import { docxAnnotations } from "./annotations";

/**
 * Word documents (DOCX and its macro and template variants), shown as the read-only Formatting
 * view: Markdown-like text that exposes all of the document's formatting (docs/docx-view.md). The
 * zip reader and the generator are loaded with `import()` when the first file is decoded, so they
 * stay out of the startup bundle (CLAUDE.md rule 6). The view is highlighted as Markdown, with
 * decorations that make the notation read as quiet annotations.
 */
export const docxProvider: TextFormatProvider = {
  kind: "text",
  id: "docx",
  name: "Word document",
  fileExtensions: ["docx", "docm", "dotx", "dotm"],
  viewModes: ["source"],
  readOnly: true,
  spellcheck: false,
  binary: {
    archive: "zip",
    async decode(bytes, context) {
      const { decodeDocx } = await import("./decode");
      return decodeDocx(bytes, context);
    },
    async inspect(bytes, context) {
      const { inspectDocxBytes } = await import("./inspect");
      return inspectDocxBytes(bytes, context);
    },
    async explain(bytes, context) {
      const { explainDocxBytes } = await import("./explain-bytes");
      return explainDocxBytes(bytes, context);
    },
  },
  // The view's headings are ATX Markdown on the same Lezer grammar, so the Markdown outline
  // reads them directly; HTML comments and inline tags are already skipped as markup there.
  outline: outlineFromState,
  editorExtensions: () => [markdown({ base: markdownLanguage, addKeymap: false }), docxAnnotations],
};
