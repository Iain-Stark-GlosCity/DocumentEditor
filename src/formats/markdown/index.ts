import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { TextFormatProvider } from "../../core/format";
import { markdownImage, markdownLink } from "./images";
import { outlineFromState } from "./outline";
import { tableCommands, tableExtensions } from "./tables";

/**
 * The unified pipeline is large, so it is loaded when a render is first requested (CLAUDE.md
 * rule 6) and never ends up in the startup bundle.
 */
type RenderModule = typeof import("../../render");
let pipeline: Promise<RenderModule> | undefined;

function loadPipeline(): Promise<RenderModule> {
  pipeline ??= import("../../render");
  return pipeline;
}

/** Markdown with GitHub-flavoured extensions as the base. */
export const markdownProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md", "markdown", "mdown", "mkd"],
  viewModes: ["source", "split"],
  commands: [...tableCommands],
  imageSyntax: markdownImage,
  linkSyntax: markdownLink,
  editorExtensions: (context) => [
    markdown({ base: markdownLanguage }),
    ...tableExtensions(() => context.setting("markdown.tables.autoFormat", true)),
  ],
  async render(text, context) {
    return (await loadPipeline()).renderMarkdown(text, context);
  },
  outline: outlineFromState,
};
