import type { RenderContext, RenderResult } from "../core/format";
import { createMarkdownProcessor } from "./pipeline";

export { outlineMarkdown } from "./outline";
export { createMarkdownProcessor, sanitiseSchema } from "./pipeline";
export type { PipelineOptions } from "./pipeline";

/** Built once, reused for every render. */
const processor = createMarkdownProcessor();

/** Markdown to sanitised HTML. Throws an `AbortError` if `context.signal` aborts. */
export async function renderMarkdown(text: string, context: RenderContext): Promise<RenderResult> {
  return { html: await processor.render(text, context) };
}
