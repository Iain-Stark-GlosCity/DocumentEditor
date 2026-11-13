import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import katex from "katex";
import { describe, expect, it, vi } from "vitest";
import type { RenderContext } from "../../core/format";
import { renderMarkdown } from "../index";
import {
  cleanStyle,
  MAX_FORMULA_LENGTH,
  rehypeMath,
  renderFormula,
  sanitiseKatexHtml,
} from "./katex";

const context: RenderContext = { path: null, resolveAsset: (p) => p };
const html = async (text: string, settings?: RenderContext["settings"]) =>
  (await renderMarkdown(text, { ...context, settings })).html;

const hasKatex = (out: string) => out.includes('class="katex"');
/** The TeX source KaTeX keeps in its MathML annotation, for every formula in the output. */
function sources(out: string): string[] {
  const dom = new DOMParser().parseFromString(out, "text/html");
  return Array.from(dom.querySelectorAll("annotation")).map((a) => a.textContent ?? "");
}

describe("maths: what is and is not maths", () => {
  it("renders inline maths", async () => {
    const out = await html("Let $x^2 + y_i$ be small.");
    expect(hasKatex(out)).toBe(true);
    expect(sources(out)).toEqual(["x^2 + y_i"]);
    expect(out).toContain("katex-mathml");
    expect(out).toContain("<math");
    expect(out).not.toContain("math-inline");
  });

  it("renders $$ blocks as display maths and keeps data-line on the wrapper", async () => {
    const out = await html("Before\n\n$$\n\\frac{a}{b}\n$$\n\nAfter");
    expect(out).toContain('<div class="math-display" data-line="3">');
    expect(out).toContain("katex-display");
    expect(sources(out)).toEqual(["\\frac{a}{b}"]);
    expect(out).not.toContain("<pre");
  });

  it("renders $$...$$ inside a paragraph as maths", async () => {
    const out = await html("so $$a+b$$ here");
    expect(sources(out)).toEqual(["a+b"]);
  });

  it("renders a fenced math block", async () => {
    const out = await html("```math\nE = mc^2\n```");
    expect(sources(out)).toEqual(["E = mc^2"]);
    expect(out).toContain("math-display");
  });

  const prose = [
    "It costs $5 and $10.",
    "Prices: $5, $10 and $20.",
    "It costs $5 and $10 and then $20.",
    "From $5-$10 only.",
    "US$5 to $10.50 a head.",
    "Pay $20,000 and $30,000.",
    "A lone $ sign.",
    "Space after $ x $ is not maths.",
    "Ends with a dollar $",
    "$5",
    "just $$ two",
    "$5 each\nor $10 for two",
  ];
  for (const text of prose) {
    it(`leaves prose alone: ${JSON.stringify(text)}`, async () => {
      const out = await html(text);
      expect(hasKatex(out)).toBe(false);
      expect(out).toContain("$");
    });
  }

  it("treats $5 and $x$ sensibly: the amount stays, the formula renders", async () => {
    const out = await html("It costs $5 and $x$ is a variable.");
    expect(sources(out)).toEqual(["x"]);
    expect(out).toContain("costs $5 and ");
  });

  it("does not close on a dollar followed by a digit", async () => {
    expect(hasKatex(await html("see $a$5 and nothing"))).toBe(false);
    expect(sources(await html("see $a$ 5"))).toEqual(["a"]);
  });

  it("renders several formulas in one line", async () => {
    expect(sources(await html("$a$ and $b$ and $c$"))).toEqual(["a", "b", "c"]);
  });

  it("does not need escapes or emphasis to be spared inside maths", async () => {
    expect(sources(await html("$a_i * b_i * c_i$"))).toEqual(["a_i * b_i * c_i"]);
    expect(sources(await html("$\\{x\\}$"))).toEqual(["\\{x\\}"]);
    expect(sources(await html("$a \\$ b$"))).toEqual(["a \\$ b"]);
  });

  it("allows maths to continue onto the next line", async () => {
    expect(sources(await html("so $a +\nb$ done"))).toEqual(["a +\nb"]);
  });

  it("respects escaped dollars", async () => {
    const out = await html("\\$x\\$ is text");
    expect(hasKatex(out)).toBe(false);
    expect(out).toContain("$x$ is text");
  });

  it("ignores dollars in code", async () => {
    const out = await html("`$x$` and\n\n```\n$$\ny\n$$\n```");
    expect(hasKatex(out)).toBe(false);
    expect(out).toContain("<code>$x$</code>");
  });

  it("can be turned off", async () => {
    const out = await html("Let $x$ and\n\n$$\ny\n$$", { "markdown.math": false });
    expect(hasKatex(out)).toBe(false);
    expect(out).toContain("$x$");
  });
});

describe("maths: errors", () => {
  it("shows a parse error inline, in the error class, with the message", async () => {
    const out = await html("Bad $\\frac{$ here");
    expect(out).toContain('class="katex-error"');
    expect(out).toContain("title=");
    expect(out).toContain("\\frac{");
    expect(out).not.toMatch(/style=/);
    expect(out).toContain("here");
  });

  it("shows an unknown command as an error and keeps rendering the rest", async () => {
    const out = await html("$\\nosuchcommand$ and $y$");
    expect(out).toContain("katex-error");
    // The colour comes from the stylesheet, not from KaTeX's fixed red.
    expect(out).not.toMatch(/cc0001|cc0000/i);
    expect(sources(out)).toContain("y");
  });

  it("does not throw when KaTeX itself throws", () => {
    const broken = {
      renderToString() {
        throw new RangeError("Maximum call stack size exceeded");
      },
    } as unknown as typeof katex;
    const nodes = renderFormula(broken, "x", false);
    expect(nodes).toMatchObject([
      {
        tagName: "span",
        properties: { className: ["katex-error"], title: "Maximum call stack size exceeded" },
        children: [{ type: "text", value: "x" }],
      },
    ]);
  });

  it("refuses a very long formula instead of rendering it", async () => {
    const out = await html("$$\n" + "x+".repeat(MAX_FORMULA_LENGTH) + "x\n$$");
    expect(out).toContain("katex-error");
    expect(out).toContain("longer than");
  });

  it("limits macro expansion", async () => {
    const out = await html("$\\def\\a{\\a\\a}\\a$");
    expect(out).toContain("katex-error");
  });

  it("does not leak macros between formulas", async () => {
    const out = await html("$\\gdef\\foo{bar}\\foo$ then $\\foo$");
    // The first formula is fine; the second no longer knows `\\foo`.
    expect(out).toContain("katex-error");
    expect(out).not.toContain("bar</span>");
  });
});

describe("maths: loading", () => {
  it("does not import KaTeX for a document without maths", async () => {
    const load = vi.fn(async () => katex as unknown as typeof import("katex"));
    const plugin = rehypeMath({ load: load as never });
    await plugin({ type: "root", children: [] });
    expect(load).not.toHaveBeenCalled();
  });
});

/** Every tag/attribute pair in a tree, for comparing before and after sanitising. */
function shape(node: Nodes, out = new Set<string>()): Set<string> {
  if (node.type === "element") {
    out.add(node.tagName);
    for (const key of Object.keys(node.properties)) out.add(`${node.tagName}@${key}`);
  }
  if ("children" in node) for (const child of node.children) shape(child, out);
  return out;
}

const CORPUS = [
  "x^2+y_i",
  "\\frac{a}{b}+\\sqrt[3]{x}+\\sqrt{\\frac12}",
  "\\sum_{i=0}^n i \\int_a^b f \\lim_{x\\to\\infty}",
  "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\begin{bmatrix}1\\end{bmatrix}\\begin{vmatrix}1\\end{vmatrix}",
  "\\begin{array}{c|c}a&b\\\\\\hline c&d\\end{array}",
  "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\\begin{cases}a&b\\\\c&d\\end{cases}",
  "\\cancel{x}\\bcancel{y}\\xcancel{z}\\sout{w}",
  "\\overbrace{abc}^{d}\\underbrace{abc}_{e}\\xrightarrow{abc}\\xleftarrow[b]{a}",
  "\\textcolor{red}{x}\\color{blue}y\\colorbox{yellow}{z}\\fcolorbox{red}{blue}{q}",
  "\\boxed{x}\\fbox{y}\\rule{1em}{2em}\\phantom{x}\\hphantom{y}\\vphantom{z}\\smash{w}",
  "\\mathbb{R}\\mathcal{L}\\mathfrak{g}\\mathscr{S}\\mathbf{b}\\mathit{i}\\mathsf{s}\\mathtt{t}",
  "\\text{abc \\textbf{d} \\textit{e}} \\mathrm{x}",
  "\\left(\\frac{a}{b}\\right)\\bigg[\\Big\\{\\left. x \\right|_y",
  "\\hat{x}\\widehat{xyz}\\tilde{a}\\vec{v}\\dot{x}\\ddot{y}\\bar{z}\\overline{ab}\\underline{cd}",
  "\\binom{n}{k}\\stackrel{a}{b}\\overset{c}{d}\\underset{e}{f}\\operatorname{sin}\\pmod{n}",
  "a \\quad b \\qquad c \\, d \\; e \\! f \\hspace{1em} g \\kern 2pt \\mkern 3mu",
  "\\LaTeX \\TeX \\KaTeX \\not= \\neq \\in \\notin \\raisebox{3pt}{x}",
  "\\Huge x \\tiny y \\large z \\displaystyle \\scriptstyle",
  "\\begin{CD} A @>a>> B \\\\ @VbVV @AAcA \\\\ C @= D \\end{CD}",
  "\\overleftarrow{AB}\\overrightarrow{AB}\\overleftrightarrow{AB}\\Overrightarrow{AB}",
  "\\mathclap{x}\\llap{y}\\rlap{z}\\clap{w}\\tag{1} \\verb|a b|",
  "\\href{javascript:alert(1)}{x}\\url{https://x.example}\\includegraphics{x.png}",
  "\\htmlClass{a}{x}\\htmlId{a}{x}\\htmlStyle{color:red}{x}\\htmlData{a=b}{x}",
  "\\frac{",
];

describe("maths: the KaTeX sanitiser", () => {
  const render = (source: string, displayMode: boolean) =>
    katex.renderToString(source, {
      displayMode,
      output: "htmlAndMathml",
      throwOnError: false,
      trust: false,
      strict: "ignore",
    });

  it("keeps everything KaTeX emits for ordinary maths (the schema is complete)", () => {
    for (const source of CORPUS) {
      for (const display of [false, true]) {
        const raw = render(source, display);
        const before = shape(fromHtml(raw, { fragment: true }));
        const after = shape({ type: "root", children: sanitiseKatexHtml(raw) });
        // `xmlns` is meaningless in an HTML document; `style` is checked by cleanStyle.
        const lost = [...before].filter((item) => !after.has(item));
        const real = lost.filter((item) => !item.endsWith("@xmlns") && !item.endsWith("@style"));
        expect(real, source).toEqual([]);
      }
    }
  });

  it("keeps the layout styles KaTeX needs", () => {
    const out = sanitiseKatexHtml(render("\\frac{a}{b}", false));
    const styles: string[] = [];
    const visit = (nodes: readonly Nodes[]) => {
      for (const node of nodes) {
        if (node.type === "element") {
          const style = node.properties["style"];
          if (typeof style === "string") styles.push(style);
          visit(node.children);
        }
      }
    };
    visit(out);
    expect(styles.length).toBeGreaterThan(3);
    expect(styles.join("")).toMatch(/height:[\d.]+em/);
    expect(styles.join("")).toMatch(/vertical-align:/);
  });

  it("does not let trusted-only commands through: they render as error text", () => {
    for (const source of [
      "\\href{javascript:alert(1)}{click}",
      "\\url{https://evil.example}",
      "\\includegraphics{https://evil.example/x.png}",
      "\\htmlClass{evil}{x}",
      "\\htmlId{evil}{x}",
      "\\htmlStyle{background:url(https://evil.example)}{x}",
      "\\htmlData{a=b}{x}",
    ]) {
      const dom = new DOMParser().parseFromString(render(source, false), "text/html");
      expect(
        dom.querySelectorAll("a, img, [id], [href], [src], [style*='url(']"),
        source,
      ).toHaveLength(0);
      for (const el of dom.body.querySelectorAll("*")) {
        for (const attr of el.attributes) expect(attr.name, source).not.toMatch(/^data-|^on/);
      }
    }
  });

  it("drops dangerous markup if KaTeX (or a bug in it) ever produced any", () => {
    const evil =
      '<span class="katex" onclick="alert(1)" id="x" style="background:url(https://evil.example/a.png);color:red;position:fixed;width:100vw">' +
      '<a href="javascript:alert(1)">link</a><img src="x" onerror="alert(1)"><script>alert(1)</script>' +
      '<svg onload="alert(1)"><foreignObject><iframe src="x"></iframe></foreignObject><path d="M0 0" fill="url(#x)"></path><use href="#x"></use></svg>' +
      '<math><mglyph><style>x</style></mglyph><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>' +
      "<div>block</div></span>";
    const out = sanitiseKatexHtml(evil);
    const dom = document.createElement("div");
    const text = JSON.stringify(out);
    expect(text).not.toMatch(
      /onclick|onerror|onload|javascript|href|"id"|iframe|script|foreignObject|fill|annotation-xml|"use"|"img"|"a"|"div"|url\(/,
    );
    expect(dom).toBeTruthy();
    const style = (out[0] as Element).properties["style"];
    expect(style).toBe("color:red;width:100vw;");
  });

  describe("cleanStyle", () => {
    it("keeps plain layout declarations", () => {
      expect(cleanStyle("height:0.6879em;vertical-align:-0.0833em;margin-right:0.05em")).toBe(
        "height:0.6879em;vertical-align:-0.0833em;margin-right:0.05em;",
      );
      expect(cleanStyle("color:#cc0000;border-color:rgb(1, 2, 3)")).toBe(
        "color:#cc0000;border-color:rgb(1, 2, 3);",
      );
    });
    it("drops anything with urls, functions, unknown properties or odd characters", () => {
      expect(cleanStyle("background:url(x)")).toBeUndefined();
      expect(cleanStyle("background-color:url(x)")).toBeUndefined();
      expect(cleanStyle("color:expression(alert(1))")).toBeUndefined();
      expect(cleanStyle("width:calc(100% - 1px)")).toBeUndefined();
      expect(cleanStyle("width:var(--x)")).toBeUndefined();
      expect(cleanStyle("position:fixed")).toBeUndefined();
      expect(cleanStyle("position:absolute;top:0")).toBe("top:0;");
      expect(cleanStyle("position:relative")).toBe("position:relative;");
      expect(cleanStyle("z-index:9999;opacity:0")).toBeUndefined();
      expect(cleanStyle("color:red\\;x")).toBeUndefined();
      expect(cleanStyle("width:1em/*")).toBeUndefined();
    });
  });
});
