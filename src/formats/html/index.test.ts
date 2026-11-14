import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../../create-registry";
import { htmlProvider } from ".";

function viewOf(doc: string, anchor = 0, head = anchor): EditorView {
  const context = {
    mode: "source" as const,
    path: null,
    setting: <T>(_key: string, fallback: T) => fallback,
  };
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: htmlProvider.editorExtensions(context),
    }),
    parent: document.body,
  });
}

function press(view: EditorView, key: string, shiftKey = false): boolean {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key, shiftKey }), "editor");
}

describe("the HTML provider", () => {
  it("claims .html and .htm, in any case, and offers source and split", () => {
    const registry = createRegistry();
    for (const path of ["a.html", "b.HTM", "C:\\x\\y.Html"]) {
      expect(registry.forPath(path)?.id).toBe("html");
    }
    expect(registry.forPath("a.md")?.id).toBe("markdown");
    expect(htmlProvider.viewModes).toEqual(["source", "split"]);
    expect(htmlProvider.spellcheck).toBe(false);
  });

  it("renders a preview and refuses one over the size limit", async () => {
    const context = { path: null, resolveAsset: (p: string) => p };
    const small = await htmlProvider.render?.("<h1>Hi</h1>", context);
    expect(small?.html).toContain("<h1");
    const big = await htmlProvider.render?.("<p>x</p>".repeat(700_000), context);
    expect(big?.html).toMatch(/too large to preview/);
    expect(big?.html).not.toContain("<h1");
  });

  it("has an outline", () => {
    const state = EditorState.create({ doc: "<h1>A</h1>" });
    expect(htmlProvider.outline?.(state).map((i) => i.text)).toEqual(["A"]);
  });
});

describe("indentation keys", () => {
  it("Tab indents by two spaces and Shift-Tab takes it back", () => {
    const view = viewOf("<div>\n<p>x</p>\n</div>", 6);
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("<div>\n  <p>x</p>\n</div>");
    expect(press(view, "Tab", true)).toBe(true);
    expect(view.state.doc.toString()).toBe("<div>\n<p>x</p>\n</div>");
    view.destroy();
  });

  it("indents every selected line", () => {
    const doc = "a\nb\nc";
    const view = viewOf(doc, 0, doc.length);
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("  a\n  b\n  c");
    view.destroy();
  });

  it("Escape then Tab leaves the editor instead of indenting", () => {
    const view = viewOf("x");
    press(view, "Escape");
    expect(press(view, "Tab")).toBe(false);
    expect(view.state.doc.toString()).toBe("x");
    // Only the next Tab: the one after indents again.
    expect(press(view, "Tab")).toBe(true);
    view.destroy();
  });
});
