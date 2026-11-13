import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { TextFormatProvider } from "../../core/format";

/** Markdown with GitHub-flavoured extensions as the base. Source view only for now. */
export const markdownProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md", "markdown", "mdown", "mkd"],
  viewModes: ["source"],
  editorExtensions: () => [markdown({ base: markdownLanguage })],
};
