import { describe, expect, it, vi } from "vitest";
import { updateBlocks } from "./blockDiff";
import { addCopyButtons, codeText } from "./codeCopy";
import { DiagramRenderer, hashSource, isSameDiagram, type MermaidApi } from "./mermaid";

function fakeMermaid() {
  const api = {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, text: string) => ({
      svg: `<svg id="${id}"><text>${text.length}</text></svg>`,
    })),
  };
  const load = vi.fn(async () => api as MermaidApi);
  return { api, load };
}

function page(html: string): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  root.innerHTML = html;
  return root;
}

const placeholder = (source: string, line = 1) =>
  `<pre class="mermaid-source" data-line="${line}">${source}</pre>`;

/** Applies new pipeline HTML to the live root the way the preview does. */
function apply(root: HTMLElement, html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return updateBlocks(root, template.content, { equivalent: isSameDiagram });
}

describe("diagrams", () => {
  it("does not load Mermaid when there is no placeholder", async () => {
    const { load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    await renderer.process(page("<p>hello</p>"), "light");
    expect(load).not.toHaveBeenCalled();
  });

  it("replaces a placeholder with a wrapper that keeps data-line", async () => {
    const { api, load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("graph TD", 7));
    await renderer.process(root, "light");
    const wrapper = root.querySelector(".mermaid-diagram")!;
    expect(wrapper.getAttribute("data-line")).toBe("7");
    expect(wrapper.querySelector("svg")).not.toBeNull();
    expect(root.querySelector("pre.mermaid-source")).toBeNull();
    expect(api.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict", theme: "default" }),
    );
  });

  it("uses the dark theme and redraws when the theme changes", async () => {
    const { api, load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("graph TD"));
    await renderer.process(root, "light");
    const wrapper = root.querySelector(".mermaid-diagram")!;
    await renderer.process(root, "dark");
    expect(api.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
    expect(api.render).toHaveBeenCalledTimes(2);
    // Redrawn in place.
    expect(root.querySelector(".mermaid-diagram")).toBe(wrapper);
    expect(wrapper.getAttribute("data-mermaid-theme")).toBe("dark");
    // And back: both palettes are cached, so no further render.
    await renderer.process(root, "light");
    expect(api.render).toHaveBeenCalledTimes(2);
  });

  it("shows the message and the source when a diagram fails, and remembers the failure", async () => {
    const { api, load } = fakeMermaid();
    api.render.mockRejectedValue(new Error("Parse error on line 2"));
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("not a diagram &lt;b&gt;"));
    await renderer.process(root, "light");
    const wrapper = root.querySelector(".mermaid-diagram.mermaid-error")!;
    expect(wrapper.textContent).toContain("Parse error on line 2");
    expect(wrapper.querySelector("code")?.textContent).toBe("not a diagram <b>");
    expect(wrapper.querySelector("b")).toBeNull();
  });

  it("does not use markup in the error message as HTML", async () => {
    const { api, load } = fakeMermaid();
    api.render.mockRejectedValue(new Error("<img src=x onerror=alert(1)>"));
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("x"));
    await renderer.process(root, "light");
    expect(root.querySelector("img")).toBeNull();
  });

  it("reports a Mermaid that cannot be loaded, and tries again next time", async () => {
    const { api, load } = fakeMermaid();
    load.mockRejectedValueOnce(new Error("offline"));
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("graph TD", 1) + placeholder("graph LR", 3));
    await renderer.process(root, "light");
    expect(root.querySelectorAll(".mermaid-error")).toHaveLength(1);
    const again = page(placeholder("graph TD"));
    await renderer.process(again, "light");
    expect(api.render).toHaveBeenCalled();
    expect(again.querySelector("svg")).not.toBeNull();
  });

  it("sanitises Mermaid's SVG before it enters the page", async () => {
    const { api, load } = fakeMermaid();
    api.render.mockResolvedValue({
      svg: '<svg onload="alert(1)"><script>alert(1)</script><g><text>ok</text></g></svg>',
    });
    const renderer = new DiagramRenderer({ load });
    const root = page(placeholder("graph TD"));
    await renderer.process(root, "light");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("svg")?.hasAttribute("onload")).toBe(false);
    expect(root.textContent).toContain("ok");
  });

  it("does not draw into a placeholder that was edited while it waited", async () => {
    const { load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("old"));
    const pending = renderer.process(root, "light");
    root.querySelector("pre")!.textContent = "new";
    await pending;
    expect(root.querySelector(".mermaid-diagram")).toBeNull();
  });
});

describe("diagrams with the block updater", () => {
  const doc = (a: string, diagram: string, tail: string) =>
    `<p data-line="1">${a}</p>${placeholder(diagram, 3)}<p data-line="9">${tail}</p>`;

  it("does not redraw or replace an unchanged diagram when other blocks change", async () => {
    const { api, load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = document.createElement("div");
    document.body.append(root);

    apply(root, doc("one", "graph TD", "end"));
    await renderer.process(root, "light");
    const wrapper = root.querySelector(".mermaid-diagram")!;
    const svg = wrapper.querySelector("svg")!;

    // An edit above, which also shifts the diagram's line number.
    apply(
      root,
      `<p data-line="1">one</p><p data-line="2">added</p>` +
        placeholder("graph TD", 5) +
        `<p data-line="11">end</p>`,
    );
    await renderer.process(root, "light");

    expect(root.querySelector(".mermaid-diagram")).toBe(wrapper);
    expect(wrapper.querySelector("svg")).toBe(svg);
    expect(wrapper.getAttribute("data-line")).toBe("5");
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(root.querySelector("pre.mermaid-source")).toBeNull();
  });

  it("redraws when the diagram's own source changes", async () => {
    const { api, load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = document.createElement("div");
    document.body.append(root);
    apply(root, doc("one", "graph TD", "end"));
    await renderer.process(root, "light");
    apply(root, doc("one", "graph LR", "end"));
    await renderer.process(root, "light");
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll(".mermaid-diagram")).toHaveLength(1);
  });

  it("puts a remembered diagram straight back, with no render and no gap", async () => {
    const { api, load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = document.createElement("div");
    document.body.append(root);
    apply(root, doc("one", "graph TD", "end"));
    await renderer.process(root, "light");
    apply(root, doc("one", "graph LR", "end"));
    await renderer.process(root, "light");
    // Undo: the first source is back.
    apply(root, doc("one", "graph TD", "end"));
    const pending = renderer.process(root, "light");
    expect(root.querySelector("pre.mermaid-source")).toBeNull();
    expect(root.querySelector(".mermaid-diagram svg")).not.toBeNull();
    await pending;
    expect(api.render).toHaveBeenCalledTimes(2);
  });

  it("does not start a second render for a placeholder that is already drawing", async () => {
    const { api, load } = fakeMermaid();
    const renderer = new DiagramRenderer({ load, sanitise: (s) => s });
    const root = page(placeholder("graph TD"));
    await Promise.all([renderer.process(root, "light"), renderer.process(root, "light")]);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("hashes the source, not the line", () => {
    expect(hashSource("a")).toBe(hashSource("a"));
    expect(hashSource("a")).not.toBe(hashSource("b"));
  });
});

describe("copy buttons", () => {
  const html = '<pre data-line="1"><code class="hljs language-js">let a;\n</code></pre>';

  it("adds an accessible button to code blocks, not to diagrams", () => {
    const root = page(html + placeholder("graph TD"));
    addCopyButtons(root);
    const buttons = root.querySelectorAll("button.code-copy");
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Copy code");
    expect(button.textContent).toBe("");
    expect(codeText(button)).toBe("let a;\n");
    // Idempotent.
    addCopyButtons(root);
    expect(root.querySelectorAll("button.code-copy")).toHaveLength(1);
  });

  it("is keyboard reachable and does not change the code's own text", () => {
    const root = page(html);
    addCopyButtons(root);
    const button = root.querySelector("button")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(root.querySelector("code")?.textContent).toBe("let a;\n");
  });

  it("does not make the block look changed, so the updater keeps it", () => {
    const root = document.createElement("div");
    document.body.append(root);
    apply(root, html);
    addCopyButtons(root);
    const pre = root.querySelector("pre")!;
    const result = apply(root, html.replace('data-line="1"', 'data-line="4"'));
    expect(result).toEqual({ kept: 1, removed: 0, inserted: 0 });
    expect(root.querySelector("pre")).toBe(pre);
    expect(pre.getAttribute("data-line")).toBe("4");
    expect(pre.querySelector("button.code-copy")).not.toBeNull();
  });
});
