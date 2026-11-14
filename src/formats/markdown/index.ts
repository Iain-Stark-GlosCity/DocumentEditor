import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { TextFormatProvider } from "../../core/format";
import { sourceStyle } from "./source-style";
import { markdownEditing, markdownFormatCommands } from "./editing";
import { markdownImage, markdownLink } from "./images";
import { liveCommands, markdownViewExtensions } from "./live";
import { outlineFromState } from "./outline";
import { tableCommands, tableExtensions } from "./tables";
import { markdownToolbar } from "./toolbar";

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
  viewModes: ["source", "live", "split"],
  commands: [...markdownFormatCommands, ...liveCommands, ...tableCommands],
  toolbar: markdownToolbar,
  imageSyntax: markdownImage,
  linkSyntax: markdownLink,
  editorExtensions: (context) => [
    // Enter, Backspace and URL paste are handled by `markdownEditing` so that each has a
    // settings switch.
    markdown({ base: markdownLanguage, addKeymap: false, pasteURLAsLink: false }),
    ...markdownViewExtensions(context),
    // Tables bind Tab and Enter at high precedence and decline outside a table.
    ...tableExtensions(() => context.setting("markdown.tables.autoFormat", true)),
    markdownEditing(context.setting),
    sourceStyle,
  ],
  async render(text, context) {
    return (await loadPipeline()).renderMarkdown(text, context);
  },
  outline: outlineFromState,
};
