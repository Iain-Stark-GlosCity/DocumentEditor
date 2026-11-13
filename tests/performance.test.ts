import { describe, expect, it } from "vitest";
import { outlineMarkdown, renderMarkdown } from "../src/render";

const context = { path: null, resolveAsset: (p: string) => p };

const PROSE =
  "Paragraph with *emphasis*, **strong text**, `inline code` and a [link](https://example.com/page) that carries on\n" +
  "for a while so that the paragraph has some body to it, as real prose does.\n";

/**
 * About `targetBytes` of varied, realistic Markdown: mostly prose, with headings, tables and
 * code in every section and a list or block quote every few sections.
 *
 * Note: micromark (inside remark-parse) is super-linear when a document is *dense* with lists or
 * block quotes (for example 5,000 back-to-back quotes), so a generated document made only of
 * those is not representative and is deliberately not used here.
 */
function generateDocument(targetBytes: number): string {
  const section = (i: number) => {
    const blocks = [
      `## Section ${i}`,
      PROSE,
      PROSE,
      PROSE,
      `| a | b | c |\n|---|---|---|\n| ${i} | two | three |`,
      "```ts\n" + `const value${i} = ${i};\n` + "```",
    ];
    if (i % 5 === 0)
      blocks.push("- item one\n- item two with [x](other.md)\n  - nested\n- [x] a task");
    if (i % 10 === 0) blocks.push("> A quotation\n> over two lines");
    return blocks.join("\n\n") + "\n\n";
  };
  const parts: string[] = ["---\ntitle: Large\n---\n\n# Large document\n\n"];
  let size = 0;
  for (let i = 0; size < targetBytes; i++) {
    const text = section(i);
    parts.push(text);
    size += text.length;
  }
  return parts.join("");
}

describe("performance smoke", () => {
  it("renders a ~1 MB document in a reasonable time", async () => {
    const text = generateDocument(1_000_000);
    expect(text.length).toBeGreaterThan(1_000_000);
    const start = performance.now();
    const { html } = await renderMarkdown(text, context);
    const renderMs = performance.now() - start;
    const outlineStart = performance.now();
    const outline = outlineMarkdown(text);
    const outlineMs = performance.now() - outlineStart;
    console.log(
      `PERF render ${(text.length / 1e6).toFixed(2)} MB: ${renderMs.toFixed(0)} ms; outline: ${outlineMs.toFixed(0)} ms`,
    );
    expect(html).toContain("<h2");
    expect(outline.length).toBeGreaterThan(1000);
    // Generous (about 4x what a slow dev machine takes): this catches accidental quadratic behaviour, not small slowdowns.
    expect(renderMs).toBeLessThan(20_000);
    expect(outlineMs).toBeLessThan(20_000);
  }, 120_000);
});
