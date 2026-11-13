/**
 * XSS tests for the surface added by maths, Mermaid and highlighting. The older attacks live in
 * `render.test.ts`; these check that the new allowances let through only what they should.
 */
import { describe, expect, it } from "vitest";
import type { RenderContext } from "../core/format";
import { renderMarkdown } from "./index";

const context: RenderContext = { path: null, resolveAsset: (p) => p };
const html = async (text: string, settings?: RenderContext["settings"]) =>
  (await renderMarkdown(text, { ...context, settings })).html;

const BASE_TAGS =
  "a,b,blockquote,br,code,del,details,div,em,h1,h2,h3,h4,h5,h6,hr,i,img,input,li,ol,p,pre,section,sup,span,strong,summary,table,tbody,td,th,thead,tr,ul";
const KATEX_TAGS =
  "svg,path,line,math,semantics,annotation,mrow,mi,mn,mo,mtext,mspace,msup,msub,msubsup,mfrac,msqrt,mroot,mover,munder,munderover,mtable,mtr,mtd,mpadded,mphantom,mstyle,menclose";

/** Checks a whole output: tags, attributes, links, ids and styles. */
function assertSafe(out: string, { allowKatex }: { allowKatex: boolean }) {
  const allowed = new Set((BASE_TAGS + (allowKatex ? "," + KATEX_TAGS : "")).split(","));
  const dom = new DOMParser().parseFromString(out, "text/html");
  for (const el of dom.body.querySelectorAll("*")) {
    expect(allowed.has(el.localName), `unexpected <${el.localName}>`).toBe(true);
    for (const attr of el.attributes) {
      expect(attr.name, `${el.localName}@${attr.name}`).not.toMatch(/^on/i);
      expect(attr.value).not.toMatch(/javascript:|vbscript:|data:/i);
      if (attr.name === "style") {
        expect(allowKatex, "style only on KaTeX output").toBe(true);
        expect(attr.value).not.toMatch(/url|expression|@|\\|\/\*|var\(/i);
      }
      if (attr.name === "id" || attr.name === "name") {
        expect(attr.value).toMatch(/^user-content-/);
      }
    }
    if (el.localName === "a") {
      expect(el.getAttribute("href") ?? "").toMatch(/^(https?:|mailto:|#|[^:]*$)/i);
    }
  }
  expect(
    dom.querySelectorAll("script, style, iframe, object, embed, form, foreignObject"),
  ).toHaveLength(0);
  return dom;
}

describe("maths cannot be used to inject markup", () => {
  const attacks: Record<string, string> = {
    href: "$\\href{javascript:alert(1)}{click me}$",
    "href block": "$$\n\\href{javascript:alert(1)}{click me}\n$$",
    "href https": "$\\href{https://evil.example}{click me}$",
    url: "$\\url{https://evil.example}$",
    includegraphics: "$\\includegraphics{https://evil.example/pixel.png}$",
    htmlClass: "$\\htmlClass{evil}{x}$",
    htmlId: "$\\htmlId{evil}{x}$",
    htmlStyle: "$\\htmlStyle{background:url(https://evil.example/x.png)}{x}$",
    htmlData: "$\\htmlData{onclick=alert(1)}{x}$",
    "script in tex": "$<script>alert(1)</script>$",
    "img in tex": '$<img src=x onerror="alert(1)">$',
    "html entity trick": "$&lt;script&gt;alert(1)&lt;/script&gt;$",
    "text with markup": "$\\text{<img src=x onerror=alert(1)>}$",
    "title attribute": '$\\text{" onmouseover="alert(1)}$',
    "unclosed tag in error": "$\\frac{<b>$",
    "color with url": "$\\textcolor{url(https://evil.example)}{x}$",
    "color with expression": "$\\color{expression(alert(1))}x$",
    "bbox border": "$\\bbox[border:1px solid url(https://evil.example)]{x}$",
    "huge rule": "$\\rule{99999999em}{99999999em}$",
    "raw code element": '<code class="math-inline">\\href{javascript:alert(1)}{x}</code>',
    "raw display code": '<pre><code class="math-display">\\htmlClass{x}{y}</code></pre>',
    "annotation breakout": "$x</annotation></semantics></math><img src=x onerror=alert(1)>$",
    "svg in tex": "$<svg onload=alert(1)>$",
    "fenced math": "```math\n\\href{javascript:alert(1)}{x}\n```",
  };

  for (const [name, source] of Object.entries(attacks)) {
    it(`is safe: ${name}`, async () => {
      const out = await html(source);
      const dom = assertSafe(out, { allowKatex: true });
      // Trusted-only commands must not produce a link, an image, a class or an id of the author's.
      expect(dom.querySelectorAll("a, img, [href], [src]")).toHaveLength(0);
      expect(out).not.toMatch(/\sclass="[^"]*\bevil\b/);
      expect(out).not.toMatch(/\sid="evil|\sdata-(?!line)/);
    });
  }

  it("does not turn on raw maths markup when maths is off", async () => {
    const out = await html('<code class="math-inline">x^2</code>', { "markdown.math": false });
    expect(out).not.toContain("katex");
  });

  it("only produces KaTeX output from maths nodes, not from author HTML", async () => {
    const out = await html(
      '<span class="katex"><span style="position:fixed;top:0;left:0">cover</span></span>',
    );
    assertSafe(out, { allowKatex: false });
    expect(out).not.toContain("style=");
    expect(out).not.toContain('class="katex"');
  });

  it("still strips raw MathML and SVG from author HTML", async () => {
    for (const raw of [
      "<math><mi>x</mi></math>",
      "<svg><path d='M0 0'/></svg>",
      "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
    ]) {
      const out = await html(raw);
      expect(out, raw).not.toMatch(/<math|<svg|<path|<mglyph|<style/);
    }
  });
});

describe("Mermaid placeholders cannot be used to inject markup", () => {
  const sources: Record<string, string> = {
    "script tag": "graph TD\n  A[<script>alert(1)</script>] --> B",
    "click handler": 'graph TD\n  A --> B\n  click A callback "alert(1)"',
    "click href": 'graph TD\n  A --> B\n  click A href "javascript:alert(1)"',
    "img onerror in label": 'graph TD\n  A["<img src=x onerror=alert(1)>"] --> B',
    "close the pre": "</pre><script>alert(1)</script>",
    "html comment": "graph TD\n  A --> B <!-- <script>alert(1)</script> -->",
    "init directive": '%%{init: {"securityLevel": "loose"}}%%\ngraph TD\n  A --> B',
  };

  for (const [name, source] of Object.entries(sources)) {
    it(`keeps it as inert text: ${name}`, async () => {
      const out = await html("```mermaid\n" + source + "\n```");
      const dom = assertSafe(out, { allowKatex: false });
      const placeholders = dom.querySelectorAll("pre.mermaid-source");
      expect(placeholders).toHaveLength(1);
      // The source is data: the text content is exactly what was written.
      expect(placeholders[0]?.textContent).toBe(source + "\n");
      expect(placeholders[0]?.children).toHaveLength(0);
      expect(out).not.toContain("<script");
      expect(out).not.toContain("<img");
    });
  }

  it("allows no other attributes on the placeholder than class and data-line", async () => {
    const out = await html(
      '<pre class="mermaid-source" onclick="alert(1)" style="x:y" id="a">graph</pre>',
    );
    const pre = new DOMParser().parseFromString(out, "text/html").querySelector("pre")!;
    expect(
      Array.from(pre.attributes)
        .map((a) => a.name)
        .sort(),
    ).toEqual(["class", "data-line", "id"]);
    expect(pre.id).toBe("user-content-a");
  });
});

describe("highlighting cannot be used to inject markup", () => {
  it("keeps HTML in code blocks as text, highlighted or not", async () => {
    for (const lang of ["html", "xml", "js", "ts", "unknown", ""]) {
      const out = await html(
        "```" +
          lang +
          '\n<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>\n```',
      );
      const dom = assertSafe(out, { allowKatex: false });
      expect(dom.querySelectorAll("a, img"), lang).toHaveLength(0);
      expect(dom.querySelector("code")?.textContent).toContain("<script>alert(1)</script>");
    }
  });

  it("allows only highlight.js class names on spans", async () => {
    const out = await html(
      '<span class="hljs-keyword">a</span><span class="hljs-title function_">b</span><span class="evil">c</span><span class="hljs-keyword evil">d</span><span class="hljs-" style="color:red">e</span>',
    );
    expect(out).toContain('<span class="hljs-keyword">a</span>');
    expect(out).toContain('<span class="hljs-title function_">b</span>');
    expect(out).toContain('<span class="">c</span>');
    expect(out).not.toContain("evil");
    expect(out).not.toContain("style=");
  });

  it("allows only known classes on code", async () => {
    const out = await html('<code class="language-js evil hljs">x</code>');
    expect(out).not.toContain("evil");
  });

  it("does not let a language name inject through the class", async () => {
    const out = await html('```js" onmouseover="alert(1)\nx\n```');
    assertSafe(out, { allowKatex: false });
    expect(out).not.toContain("onmouseover=");
  });
});
