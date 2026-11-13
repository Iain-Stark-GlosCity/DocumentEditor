import { describe, expect, it } from "vitest";
import type { RenderContext } from "../core/format";
import { renderMarkdown } from "./index";

const context: RenderContext = { path: null, resolveAsset: (p) => p };
const html = async (text: string, settings?: RenderContext["settings"]) =>
  (await renderMarkdown(text, { ...context, settings })).html;

describe("heading ids", () => {
  it("gives GitHub-style slugs, prefixed by the sanitiser", async () => {
    const out = await html("# Hello, World!\n\n## Section 2.1: The `code` bit\n\n### Ça va?");
    expect(out).toContain('id="user-content-hello-world"');
    expect(out).toContain('id="user-content-section-21-the-code-bit"');
    expect(out).toContain('id="user-content-ça-va"');
  });

  it("de-duplicates repeated headings with -1, -2", async () => {
    const out = await html("# Same\n\n## Same\n\n### Same");
    expect(out).toContain('id="user-content-same"');
    expect(out).toContain('id="user-content-same-1"');
    expect(out).toContain('id="user-content-same-2"');
  });

  it("does not give an id to a heading with no usable text", async () => {
    const out = await html("# !!!\n\n## ");
    expect(out).not.toContain("id=");
  });

  it("does not collide with an id the author wrote in raw HTML", async () => {
    const out = await html('<h2 id="intro">Raw</h2>\n\n# Intro');
    expect(out).toContain('id="user-content-intro"');
    expect(out).toContain('id="user-content-intro-1"');
  });

  it("points in-document links at the prefixed id", async () => {
    const out = await html("[go](#hello-world)\n\n# Hello World");
    expect(out).toContain('href="#user-content-hello-world"');
    expect(out).toContain('id="user-content-hello-world"');
  });

  it("handles links to non-ASCII headings (percent-encoded in the link)", async () => {
    const out = await html("[go](#café)\n\n# Café");
    expect(out).toContain('id="user-content-café"');
    expect(out).toMatch(/href="#user-content-caf%C3%A9"/);
  });

  it("leaves links to ids that do not exist as written", async () => {
    const out = await html("[go](#nowhere)\n\n# Somewhere");
    expect(out).toContain('href="#nowhere"');
  });

  it("keeps footnote links and ids working", async () => {
    const out = await html("Note[^1].\n\n[^1]: The note.");
    expect(out).toContain('href="#user-content-fn-1"');
    expect(out).toContain('id="user-content-fn-1"');
    expect(out).toContain('href="#user-content-fnref-1"');
    expect(out).toContain('id="user-content-footnote-label"');
  });

  it("is not forgeable through the author's own id attribute on other tags", async () => {
    const out = await html('<p id="body">x</p>');
    expect(out).toContain('id="user-content-body"');
  });
});

describe("task lists", () => {
  it("carries the GitHub classes", async () => {
    const out = await html("- [x] done\n- [ ] todo");
    expect(out).toContain('<ul class="contains-task-list"');
    expect(out).toContain('<li class="task-list-item"');
    expect(out.match(/class="task-list-item-checkbox"/g)).toHaveLength(2);
    expect(out).toContain("checked");
  });

  it("does not add the classes to plain lists", async () => {
    const out = await html("- a\n- b");
    expect(out).not.toContain("task-list");
  });
});

describe("mermaid placeholders", () => {
  it("replaces a mermaid fence with a placeholder holding the escaped source", async () => {
    const out = await html("Text\n\n```mermaid\ngraph TD\n  A[<b>x</b>] --> B\n```\n\nMore");
    expect(out).toContain('<pre class="mermaid-source" data-line="3">');
    expect(out).toContain("A[&#x3C;b>x&#x3C;/b>] --> B");
    expect(out).not.toContain("<code");
    expect(out).not.toContain("<b>");
  });

  it("keeps the exact source, including blank lines and the trailing newline", async () => {
    const out = await html("```mermaid\ngraph TD\n\n  A --> B\n```");
    const pre = new DOMParser().parseFromString(out, "text/html").querySelector("pre")!;
    expect(pre.textContent).toBe("graph TD\n\n  A --> B\n");
  });

  it("does not touch other languages", async () => {
    const out = await html("```ts\nlet a = 1\n```");
    expect(out).not.toContain("mermaid-source");
  });

  it("can be turned off, leaving an ordinary code block", async () => {
    const out = await html("```mermaid\ngraph TD\n```", { "markdown.mermaid": false });
    expect(out).not.toContain("mermaid-source");
    expect(out).toContain('<code class="language-mermaid">');
  });

  it("is not forgeable with other classes on pre", async () => {
    const out = await html('<pre class="evil mermaid-source">x</pre>');
    expect(out).toContain('<pre class="mermaid-source" data-line="1">');
    expect(out).not.toContain("evil");
  });
});
