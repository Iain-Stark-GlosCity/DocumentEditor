import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { OutlineItem, TextFormatProvider } from "../../core/format";
import { markdownEditing, markdownFormatCommands } from "./editing";

/**
 * The unified pipeline is large, so it is loaded on first use (CLAUDE.md rule 6) and never
 * ends up in the startup bundle.
 */
type RenderModule = typeof import("../../render");
let pipeline: Promise<RenderModule> | undefined;
let loaded: RenderModule | undefined;

function loadPipeline(): Promise<RenderModule> {
  pipeline ??= import("../../render").then((module) => (loaded = module));
  return pipeline;
}

/** Markdown with GitHub-flavoured extensions as the base. */
export const markdownProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md", "markdown", "mdown", "mkd"],
  viewModes: ["source", "split"],
  commands: markdownFormatCommands,
  editorExtensions: (context) => {
    // Opening a Markdown document starts loading the pipeline in the background, so that the
    // synchronous `outline` below has it ready by the time the outline panel asks.
    void loadPipeline();
    return [
      // Enter, Backspace and URL paste are handled by `markdownEditing` so that each has a
      // settings switch.
      markdown({ base: markdownLanguage, addKeymap: false, pasteURLAsLink: false }),
      markdownEditing(context.setting),
    ];
  },
  async render(text, context) {
    return (await loadPipeline()).renderMarkdown(text, context);
  },
  /**
   * `outline` is synchronous in the FormatProvider interface, so it cannot await the dynamic
   * import. Until the pipeline has loaded it returns an empty outline and starts the load;
   * callers should ask again after the first render.
   */
  outline(text): OutlineItem[] {
    if (!loaded) {
      void loadPipeline();
      return [];
    }
    return loaded.outlineMarkdown(text);
  },
};
