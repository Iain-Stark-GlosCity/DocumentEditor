import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { TextFormatProvider } from "../../core/format";
import { outlineFromState } from "./outline";
import { tableCommands, tableExtensions } from "./tables";
import type { OutlineItem, TextFormatProvider } from "../../core/format";
import { markdownImage, markdownLink } from "./images";

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
  editorExtensions: () => [markdown({ base: markdownLanguage })],
  commands: [...tableCommands],
  editorExtensions: (context) => {
  imageSyntax: markdownImage,
  linkSyntax: markdownLink,
  editorExtensions: () => {
    // Opening a Markdown document starts loading the pipeline in the background, so that the
    // synchronous `outline` below has it ready by the time the outline panel asks.
    void loadPipeline();
    return [
      markdown({ base: markdownLanguage }),
      ...tableExtensions(() => context.setting("markdown.tables.autoFormat", true)),
    ];
  },
  async render(text, context) {
    return (await loadPipeline()).renderMarkdown(text, context);
  },
  outline: outlineFromState,
};
