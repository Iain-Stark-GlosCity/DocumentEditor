import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockField, inlinePlugin, liveExtensions, liveOptions, openLinkAtCursor } from "./index";
import { findAnchor, linkAt, slugify } from "./links";
import { fullyParsed } from "./test-helpers";
import { toggleTaskAt } from "./widgets";

let views: EditorView[] = [];

function makeView(doc: string, anchor = doc.length, extra: Extension = []): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [history(), markdown({ base: markdownLanguage }), liveExtensions(), extra],
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => v.destroy());
  views = [];
});

const text = (view: EditorView) => view.contentDOM.textContent ?? "";

describe("the live view", () => {
  it("draws rendered text and reveals source as the caret moves in", () => {
    const view = makeView("Some **bold** words\n\nend", 0);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(text(view)).toContain("Some bold words");
    expect(view.contentDOM.querySelector(".cm-live-strong")?.textContent).toBe("bold");

    view.dispatch({ selection: { anchor: 7 } });
    expect(text(view)).toContain("Some **bold** words");
    // Moving the caret never changes the text.
    expect(view.state.doc.toString()).toBe("Some **bold** words\n\nend");
  });

  it("marks the editor so the stylesheet can scope live rules", () => {
    const view = makeView("x");
    expect(view.dom.classList.contains("cm-live")).toBe(true);
  });

  it("follows edits, including new constructs typed by the user", () => {
    const view = makeView("a\n\nb");
    view.dispatch({ changes: { from: 0, insert: "*x* " }, selection: { anchor: 6 } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(view.contentDOM.querySelector(".cm-live-em")?.textContent).toBe("x");
  });

  it("only decorates what is visible in a large document", () => {
    const doc = "Some **bold** text and *more*.\n\n".repeat(30_000);
    const view = makeView(doc, 0);
    const plugin = view.plugin(inlinePlugin);
    expect(plugin).toBeTruthy();
    const { to } = view.viewport;
    expect(to).toBeLessThan(doc.length / 2);
    let last = 0;
    plugin?.decorations.between(0, doc.length, (_f, t) => {
      last = Math.max(last, t);
    });
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThanOrEqual(view.state.doc.lineAt(to).to);
  });

  it("keeps the block pass to a window around the viewport", async () => {
    const doc = "![a](x.png)\n\n".repeat(20_000);
    const view = makeView(doc, 0);
    await Promise.resolve();
    const { window, decorations } = view.state.field(blockField);
    expect(window.to).toBeLessThan(doc.length);
    let count = 0;
    decorations.between(0, doc.length, (f) => {
      count++;
      expect(f).toBeLessThanOrEqual(window.to);
    });
    expect(count).toBeGreaterThan(0);

    // Scrolling far away moves the window with the viewport.
    const far = doc.length - 10;
    view.dispatch({ selection: { anchor: far }, scrollIntoView: true });
    view.dispatch({ effects: EditorView.scrollIntoView(far) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const moved = view.state.field(blockField).window;
    if (view.viewport.to > window.to) expect(moved.to).toBeGreaterThanOrEqual(view.viewport.to);
  });
});

describe("task checkboxes", () => {
  it("toggles the character in the source as one undoable change", () => {
    const view = makeView("- [ ] buy milk\n\nend");
    const box = view.contentDOM.querySelector<HTMLInputElement>("input.cm-live-task");
    expect(box).toBeTruthy();
    expect(box?.getAttribute("aria-label")).toBe("Task: buy milk");
    expect(box?.checked).toBe(false);

    const before = view.state.doc;
    box?.click();
    expect(view.state.doc.toString()).toBe("- [x] buy milk\n\nend");
    // Exactly one character changed.
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      if (before.sliceString(i, i + 1) !== view.state.doc.sliceString(i, i + 1)) changed++;
    }
    expect(changed).toBe(1);
    expect(view.contentDOM.querySelector<HTMLInputElement>("input.cm-live-task")?.checked).toBe(
      true,
    );

    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk\n\nend");
  });

  it("is a keyboard-focusable checkbox that keeps its element across toggles", () => {
    const view = makeView("- [x] done\n\nend");
    const box = view.contentDOM.querySelector<HTMLInputElement>("input.cm-live-task");
    expect(box?.type).toBe("checkbox");
    expect(box?.tabIndex).toBe(0);
    box?.focus();
    box?.click(); // Space on a focused checkbox arrives as a click.
    expect(view.state.doc.toString()).toBe("- [ ] done\n\nend");
    expect(view.contentDOM.querySelector("input.cm-live-task")).toBe(box);
    expect(document.activeElement).toBe(box);
  });

  it("toggleTaskAt refuses anything but a task box", () => {
    const view = makeView("- [ ] a\n[y] b");
    expect(toggleTaskAt(view, 0)).toBe(false);
    expect(toggleTaskAt(view, 9)).toBe(false);
    expect(toggleTaskAt(view, 3)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] a\n[y] b");
  });
});

describe("links", () => {
  it("finds the target of inline, reference, auto and bare links", () => {
    const state = fullyParsed(
      EditorState.create({
        doc: "[a](http://x) [b][r] <http://y> <me@x.org> www.z.org [c]\n\n[r]: http://ref\n[C]: c.md",
        extensions: markdown({ base: markdownLanguage }),
      }),
    );
    expect(linkAt(state, 1)).toBe("http://x");
    expect(linkAt(state, 15)).toBe("http://ref");
    expect(linkAt(state, 24)).toBe("http://y");
    expect(linkAt(state, 34)).toBe("mailto:me@x.org");
    expect(linkAt(state, 45)).toBe("http://www.z.org");
    expect(linkAt(state, 54)).toBe("c.md");
    const plain = fullyParsed(
      EditorState.create({
        doc: "no links here",
        extensions: markdown({ base: markdownLanguage }),
      }),
    );
    expect(linkAt(plain, 3)).toBeNull();
  });

  it("opens the link at the caret through the host callback", () => {
    const openLink = vi.fn();
    const view = makeView("see [docs](https://x.org)", 6, liveOptions.of({ openLink }));
    expect(openLinkAtCursor(view)).toBe(true);
    expect(openLink).toHaveBeenCalledWith("https://x.org");
  });

  it("follows in-document anchors in the editor itself", () => {
    const openLink = vi.fn();
    const doc = "[go](#second-part)\n\n# First\n\n## Second *part*\n";
    const view = makeView(doc, 2, liveOptions.of({ openLink }));
    expect(openLinkAtCursor(view)).toBe(true);
    expect(openLink).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(doc.indexOf("## Second"));
  });

  it("makes GitHub-style anchors", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Über café 2")).toBe("über-café-2");
    const state = fullyParsed(
      EditorState.create({
        doc: "# A\n\n# A\n",
        extensions: markdown({ base: markdownLanguage }),
      }),
    );
    expect(findAnchor(state, "a-1")).toBe(5);
  });
});
