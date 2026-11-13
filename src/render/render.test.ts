import { describe, expect, it } from "vitest";
import type { RenderContext } from "../core/format";
import { renderMarkdown } from "./index";

const context: RenderContext = {
  path: "C:\\docs\\note.md",
  resolveAsset: (p) => `asset://localhost/${p}`,
};

async function html(text: string, ctx: RenderContext = context): Promise<string> {
  return (await renderMarkdown(text, ctx)).html;
}

describe("basic rendering", () => {
  it("renders GFM features", async () => {
    const out = await html(
      [
        "| a | b |",
        "|:--|--:|",
        "| 1 | 2 |",
        "",
        "- [x] done",
        "- [ ] todo",
        "",
        "~~gone~~ and https://example.com",
        "",
        "Note[^1].",
        "",
        "[^1]: The note.",
      ].join("\n"),
    );
    expect(out).toContain("<table");
    expect(out).toContain('align="left"');
    expect(out).toContain('align="right"');
    expect(out).toContain('<input type="checkbox" checked disabled>');
    expect(out).toContain('<input type="checkbox" disabled>');
    expect(out).toContain("<del>gone</del>");
    expect(out).toContain('<a href="https://example.com">https://example.com</a>');
    expect(out).toContain('href="#user-content-fn-1"');
    expect(out).toContain('id="user-content-fn-1"');
  });

  it("keeps the language class on fenced code and does not highlight", async () => {
    const out = await html("```ts\nconst x = 1;\n```");
    expect(out).toContain(
      '<pre data-line="1"><code class="language-ts">const x = 1;\n</code></pre>',
    );
  });

  it("keeps a leading blank line in a fenced code block", async () => {
    const out = await html("```\n\nafter blank\n```");
    expect(out).toContain("<code>\nafter blank\n</code>");
  });

  it("does not render front matter as body text", async () => {
    const out = await html("---\ntitle: Hello\ntags: [a]\n---\n\n# Body");
    expect(out).not.toContain("title");
    expect(out).not.toContain("Hello");
    expect(out).toContain("Body");
  });

  it("allows safe raw HTML", async () => {
    const out = await html("<details><summary>More</summary>\n\nHidden\n\n</details>");
    expect(out).toContain("<details");
    expect(out).toContain("<summary>More</summary>");
  });
});

const ALLOWED_TAGS = new Set(
  "a,b,blockquote,br,code,del,details,div,em,h1,h2,h3,h4,h5,h6,hr,i,img,input,li,ol,p,pre,section,sup,span,strong,summary,table,tbody,td,th,thead,tr,ul".split(
    ",",
  ),
);

describe("sanitising", () => {
  const attacks: Record<string, string> = {
    "script tag": "<script>alert(1)</script>",
    "script after text": "hello <script>alert(1)</script>",
    "img onerror": '<img src="x" onerror="alert(1)">',
    "onclick on a div": '<div onclick="alert(1)">x</div>',
    "javascript link": "[x](javascript:alert(1))",
    "javascript link mixed case": "[x](JaVaScRiPt:alert(1))",
    "javascript link with entity": "[x](&#106;avascript:alert(1))",
    "javascript link with tab": '<a href="java\tscript:alert(1)">x</a>',
    "javascript link with newline": '<a href="jav&#x0A;ascript:alert(1)">x</a>',
    "javascript link with leading space": '<a href=" javascript:alert(1)">x</a>',
    "data url link": "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "data url raw link": '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    "data url image": "![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
    "vbscript link": "[x](vbscript:msgbox(1))",
    "svg with script": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    "svg onload": '<svg onload="alert(1)"></svg>',
    "svg foreignObject": "<svg><foreignObject><iframe src=x></iframe></foreignObject></svg>",
    iframe: '<iframe src="https://example.com"></iframe>',
    object: '<object data="x.swf"></object>',
    embed: '<embed src="x.swf">',
    form: '<form action="https://evil.example"><input name="a"><button>go</button></form>',
    "style tag": "<style>body{display:none}</style>",
    "meta refresh": '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    "base tag": '<base href="https://evil.example/">',
    "link tag": '<link rel="stylesheet" href="https://evil.example/x.css">',
    "nested script trick": "<scr<script>ipt>alert(1)</scr</script>ipt>",
    "unclosed script": "<script>alert(1)",
    "math/mglyph mutation": "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
    "noscript mutation": '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    "event handler on link": '<a href="https://example.com" onmouseover="alert(1)">x</a>',
    "style attribute": '<p style="background:url(javascript:alert(1))">x</p>',
    srcset: '<img srcset="javascript:alert(1) 1x" src="https://example.com/a.png">',
    "id clobbering": '<img name="cookie" id="body" src="https://example.com/a.png">',
  };

  for (const [name, source] of Object.entries(attacks)) {
    it(`neutralises: ${name}`, async () => {
      const out = await html(source);
      expect(out).not.toMatch(
        /<script|<iframe|<object|<embed|<form|<style|<meta|<base|<link|<svg/i,
      );
      const dom = new DOMParser().parseFromString(out, "text/html");
      for (const el of dom.body.querySelectorAll("*")) {
        expect(ALLOWED_TAGS.has(el.localName), `unexpected <${el.localName}>`).toBe(true);
        for (const attr of el.attributes) expect(attr.name).not.toMatch(/^on/i);
      }
      expect(out).not.toMatch(/javascript:/i);
      expect(out).not.toMatch(/vbscript:/i);
      expect(out).not.toMatch(/data:/i);
      expect(out).not.toMatch(/\sstyle=/i);
      expect(out).not.toMatch(/srcset/i);
      expect(out).not.toMatch(/\sid="(?!user-content-)/);
      expect(out).not.toMatch(/\sname="(?!user-content-)/);
    });
  }

  it("drops HTML comments", async () => {
    const out = await html("a <!-- secret --> b\n\n<!-- block -->\n\nc");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("secret");
  });

  it("drops comment-based conditional tricks", async () => {
    const out = await html("<!--[if IE]><script>alert(1)</script><![endif]-->x");
    expect(out).not.toMatch(/script|<!--/i);
  });

  it("neutralises encoded tricks in plain Markdown text", async () => {
    const out = await html("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&#x3C;script>");
    expect(out).not.toContain("<script");
  });

  it("only keeps disabled checkboxes", async () => {
    const out = await html('<input type="text" value="x"><input type="checkbox" checked>');
    expect(out).not.toContain('type="text"');
    expect(out).toContain("disabled");
  });

  it("lets safe links through", async () => {
    const out = await html(
      "[a](https://example.com/x?y=1) [m](mailto:a@example.com) [r](docs/other.md)",
    );
    expect(out).toContain('href="https://example.com/x?y=1"');
    expect(out).toContain('href="mailto:a@example.com"');
    expect(out).toContain('href="docs/other.md"');
  });

  it("does not let authors forge data-line", async () => {
    const out = await html('<div data-line="999">raw</div>\n\npara');
    expect(out).not.toContain('data-line="999"');
  });
});

describe("data-line", () => {
  it("marks top-level blocks with their start line", async () => {
    const out = await html("# Title\n\nPara one\ncontinues\n\n```js\ncode\n```\n\n---\n\nLast");
    expect(out).toContain('<h1 data-line="1">');
    expect(out).toContain('<p data-line="3">');
    expect(out).toContain('<pre data-line="6">');
    expect(out).toContain('<hr data-line="10">');
    expect(out).toContain('<p data-line="12">Last</p>');
  });

  it("marks list items, nested items, table rows and blockquote children", async () => {
    const source = [
      "- one",
      "- two",
      "  - nested",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "> first",
      ">",
      "> second",
    ].join("\n");
    const out = await html(source);
    expect(out).toContain('<ul data-line="1">');
    expect(out).toContain('<li data-line="1">one</li>');
    expect(out).toContain('<li data-line="2">two');
    expect(out).toContain('<li data-line="3">nested</li>');
    expect(out).toContain('<table data-line="5">');
    expect(out).toContain('<tr data-line="5">');
    expect(out).toContain('<tr data-line="7">');
    expect(out).toContain('<blockquote data-line="9">');
    expect(out).toContain('<p data-line="9">first</p>');
    expect(out).toContain('<p data-line="11">second</p>');
  });

  it("uses real file lines when front matter is present", async () => {
    const out = await html("---\ntitle: x\n---\n\n# Heading\n\ntext");
    expect(out).toContain('<h1 data-line="5">');
    expect(out).toContain('<p data-line="7">text</p>');
  });

  it("does not add data-line to inline elements", async () => {
    const out = await html("some *emph* and `code`");
    expect(out).toContain('<p data-line="1">some <em>emph</em> and <code>code</code></p>');
  });
});

describe("assets", () => {
  it("rewrites relative image sources through resolveAsset", async () => {
    const out = await html("![a](images/pic.png) ![b](./pic2.png)");
    expect(out).toContain('src="asset://localhost/images/pic.png"');
    expect(out).toContain('src="asset://localhost/./pic2.png"');
  });

  it("rewrites relative sources in raw HTML images too", async () => {
    const out = await html('<img src="pic.png" alt="x">');
    expect(out).toContain('src="asset://localhost/pic.png"');
  });

  it("leaves absolute http(s) images untouched", async () => {
    const out = await html("![a](https://example.com/a.png) ![b](http://example.com/b.png)");
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('src="http://example.com/b.png"');
  });

  it("leaves links as written, relative or not", async () => {
    const out = await html("[a](other.md) [b](https://example.com) [c](#frag)");
    expect(out).toContain('href="other.md"');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('href="#frag"');
    expect(out).not.toContain("asset://");
  });
});

describe("abort", () => {
  it("throws an AbortError when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderMarkdown("# x", { ...context, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("throws an AbortError when aborted during the render", async () => {
    const controller = new AbortController();
    const pending = renderMarkdown("# x", { ...context, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reuses one processor across calls with different contexts", async () => {
    const a = await html("![x](p.png)", { ...context, resolveAsset: (p) => `a/${p}` });
    const b = await html("![x](p.png)", { ...context, resolveAsset: (p) => `https://b/${p}` });
    expect(a).toContain('src="a/p.png"');
    expect(b).toContain('src="https://b/p.png"');
  });
});
