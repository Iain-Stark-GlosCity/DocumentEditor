import type { TextFormatProvider } from "../../core/format";

/**
 * Plain text: no language and no preview. It is also the format for any file whose extension no
 * other format claims (see `createRegistry`), so an unfamiliar file opens as text and not as
 * Markdown.
 */
export const plainTextProvider: TextFormatProvider = {
  kind: "text",
  id: "text",
  name: "Plain text",
  fileExtensions: ["txt", "text", "log"],
  viewModes: ["source"],
  editorExtensions: () => [],
};
