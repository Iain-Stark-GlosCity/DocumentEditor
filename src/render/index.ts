import type { RenderContext, RenderResult } from "../core/format";
import { createMarkdownProcessor, type MarkdownProcessor } from "./pipeline";

export { outlineMarkdown } from "./outline";
export { createMarkdownProcessor, sanitiseSchema } from "./pipeline";
export type { PipelineOptions } from "./pipeline";

/** One processor per combination of the two switches, each built once and reused. */
const processors = new Map<string, MarkdownProcessor>();

function processorFor(math: boolean, mermaid: boolean): MarkdownProcessor {
  const key = `${math}|${mermaid}`;
  let processor = processors.get(key);
  if (!processor) {
    processor = createMarkdownProcessor({ math, mermaid });
    processors.set(key, processor);
  }
  return processor;
}

/** Markdown to sanitised HTML. Throws an `AbortError` if `context.signal` aborts. */
export async function renderMarkdown(text: string, context: RenderContext): Promise<RenderResult> {
  const math = context.settings?.["markdown.math"] !== false;
  const mermaid = context.settings?.["markdown.mermaid"] !== false;
  return { html: await processorFor(math, mermaid).render(text, context) };
}
