/**
 * An `asset:` address is the render worker's private way of naming a local file (see
 * `workbench/preview/paths.ts`): the main thread turns it into a real file URL. Only the
 * pipeline's own resolver may write one, so an address the author wrote must never survive.
 */
import { describe, expect, it } from "vitest";
import type { RenderContext } from "../core/format";
import { renderHtml } from "./html";
import { renderMarkdown } from "./index";

const context: RenderContext = {
  path: "C:\\docs\\note.md",
  resolveAsset: (p) => `asset://doc/${encodeURIComponent(`C:\\docs\\${p}`)}`,
};

describe("author-written asset addresses", () => {
  const forged: Record<string, string> = {
    "markdown image": "![x](asset://doc/C%3A%2FUsers%2Fme%2Fsecret.png)",
    "markdown image in angle brackets": "![x](<asset://doc/C%3A%2Fsecret.png>)",
    "markdown image, unsaved placeholder": "![x](asset://unsaved/secret.png)",
    "raw html image": '<img src="asset://doc/C%3A%2Fsecret.png">',
    "raw html image, upper case": '<img src="ASSET://doc/C%3A%2Fsecret.png">',
    "raw html image, leading space": '<img src=" asset://doc/C%3A%2Fsecret.png">',
    "reference image": "![x][r]\n\n[r]: asset://doc/C%3A%2Fsecret.png",
  };

  for (const [name, source] of Object.entries(forged)) {
    it(`is removed from Markdown: ${name}`, async () => {
      const { html } = await renderMarkdown(source, context);
      expect(html).not.toMatch(/asset:/i);
      expect(html).not.toContain("secret.png");
    });
  }

  it("is removed from the HTML preview", async () => {
    const { html } = await renderHtml(
      '<img src="asset://doc/C%3A%2Fsecret.png"><img src="ASSET://doc/x">',
      context,
    );
    expect(html).not.toMatch(/asset:/i);
  });

  it("still lets the resolver turn a relative image into one", async () => {
    const { html } = await renderMarkdown("![a](pics/a.png)", context);
    expect(html).toContain('src="asset://doc/C%3A%5Cdocs%5Cpics%2Fa.png"');
    const raw = await renderHtml('<img src="pics/a.png">', context);
    expect(raw.html).toContain('src="asset://doc/C%3A%5Cdocs%5Cpics%2Fa.png"');
  });
});
