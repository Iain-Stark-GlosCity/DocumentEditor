import { describe, expect, it } from "vitest";
import type { RenderContext } from "../../core/format";
import { renderMarkdown } from "../index";
import { canonicalLanguage, SUPPORTED_LANGUAGES } from "./languages";
import { MAX_HIGHLIGHT_LENGTH } from "./highlight";

const context: RenderContext = { path: null, resolveAsset: (p) => p };
const html = async (text: string) => (await renderMarkdown(text, context)).html;

describe("code highlighting", () => {
  it("wraps tokens in hljs classes and nothing else", async () => {
    const out = await html('```js\nconst name = "x"; // note\n```');
    expect(out).toContain('<code class="hljs language-js">');
    expect(out).toContain('<span class="hljs-keyword">const</span>');
    expect(out).toContain('<span class="hljs-string">"x"</span>');
    expect(out).toContain('<span class="hljs-comment">// note</span>');
    expect(out).not.toMatch(/style=/);
  });

  it("keeps sub-scope classes such as function_", async () => {
    const out = await html("```ts\nfunction go() {}\n```");
    expect(out).toMatch(/class="hljs-title function_"/);
  });

  it("resolves aliases and case", async () => {
    for (const lang of ["ts", "TypeScript", "tsx"]) {
      expect(await html(`\`\`\`${lang}\nlet a: number = 1;\n\`\`\``)).toContain("hljs-keyword");
    }
    expect(await html("```py\ndef f():\n    pass\n```")).toContain("hljs-keyword");
    expect(await html('```html\n<a href="x">y</a>\n```')).toContain("hljs-tag");
  });

  it("leaves unknown languages as plain text, silently", async () => {
    const out = await html("```nosuchlang\nconst x = 1;\n```");
    expect(out).toContain('<code class="language-nosuchlang">const x = 1;\n</code>');
    expect(out).not.toContain("hljs");
  });

  it("does not highlight a block with no language", async () => {
    const out = await html("```\nconst x = 1;\n```");
    expect(out).toContain("<code>const x = 1;\n</code>");
  });

  it("does not highlight inline code", async () => {
    const out = await html("Use `const x = 1` here");
    expect(out).not.toContain("hljs");
  });

  it("does not highlight a block over the size limit", async () => {
    const big = "const a = 1;\n".repeat(Math.ceil(MAX_HIGHLIGHT_LENGTH / 13) + 10);
    const out = await html("```js\n" + big + "```");
    expect(out).not.toContain("hljs");
    expect(out).toContain("const a = 1;");
  });

  it("escapes HTML inside code and never lets it become markup", async () => {
    const out = await html('```html\n<script>alert(1)</script><img src=x onerror="alert(1)">\n```');
    expect(out).not.toMatch(/<script|<img/);
    expect(out).toContain("&#x3C;");
    const plain = await html("```text\n<script>alert(1)</script>\n```");
    expect(plain).not.toContain("<script");
  });

  it("keeps a leading blank line in a highlighted block", async () => {
    const out = await html("```js\n\nlet a;\n```");
    expect(out).toMatch(
      /<code class="hljs language-js">\n<span class="hljs-keyword">let<\/span> a;/,
    );
  });

  it("does not touch mermaid blocks", async () => {
    const out = await html("```mermaid\ngraph TD; A-->B\n```");
    expect(out).toContain('class="mermaid-source"');
    expect(out).not.toContain("hljs");
  });

  it("has a grammar for every name it advertises", async () => {
    for (const name of SUPPORTED_LANGUAGES) expect(canonicalLanguage(name)).toBe(name);
    expect(canonicalLanguage("constructor")).toBeUndefined();
    expect(canonicalLanguage("__proto__")).toBeUndefined();
  });

  it("loads every grammar and highlights something in each", async () => {
    for (const name of SUPPORTED_LANGUAGES) {
      const out = await html(`\`\`\`${name}\nfoo 1 "bar"\n\`\`\``);
      expect(out, name).toContain(`language-${name}`);
    }
  });
});
