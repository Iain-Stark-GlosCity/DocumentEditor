import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildDecorations } from "./builder";
import { imageSource } from "./renderers/images";
import { decorations, describe as describeSet, hidden, liveState } from "./test-helpers";
import { liveRenderers, type LiveRenderer } from "./types";

const inline = (text: string) => decorations(liveState(text));
const hiddenIn = (text: string) => hidden(liveState(text));
const block = (text: string, options = {}) => decorations(liveState(text, { options }), "block");

describe("emphasis, strong, strikethrough and inline code", () => {
  it.each([
    ["*a*", "*", "cm-live-em"],
    ["_a_", "_", "cm-live-em"],
    ["**a**", "**", "cm-live-strong"],
    ["__a__", "__", "cm-live-strong"],
    ["~~a~~", "~~", "cm-live-strike"],
    ["`a`", "`", "cm-live-inline-code"],
    ["``a`b``", "``", "cm-live-inline-code"],
  ])("%s: markers hidden and content styled when the caret is away", (source, marker, cls) => {
    const result = inline(`x ${source} y`);
    expect(result.filter((d) => d.startsWith("hide"))).toEqual([
      `hide ${JSON.stringify(marker)}`,
      `hide ${JSON.stringify(marker)}`,
    ]);
    expect(result.some((d) => d.startsWith(`mark ${cls} `))).toBe(true);
  });

  it.each(["x ‸**a** y", "x **‸a** y", "x **a‸** y", "x **a**‸ y"])(
    "reveals the markers when a caret touches the construct, edges included: %s",
    (source) => {
      const result = inline(source);
      expect(result.filter((d) => d.startsWith("hide"))).toEqual([]);
      expect(result).toEqual([
        'mark cm-live-syntax "**"',
        'mark cm-live-strong "a"',
        'mark cm-live-syntax "**"',
      ]);
    },
  );

  it("keeps markers hidden when the caret is one character away", () => {
    expect(hiddenIn("x‸ **a** y")).toEqual(['hide "**"', 'hide "**"']);
    expect(hiddenIn("x **a** ‸y")).toEqual(['hide "**"', 'hide "**"']);
  });

  it("reveals when a selection range overlaps the construct", () => {
    const state = liveState("ab **cd** ef", { selection: EditorSelection.single(0, 4) });
    expect(hidden(state)).toEqual([]);
  });

  it("reveals each construct touched by one of several carets", () => {
    const result = hiddenIn("‸*a* *b* **c‸**");
    expect(result).toEqual(['hide "*"', 'hide "*"']); // only `*b*` stays rendered
  });

  it("does not render markup inside inline code", () => {
    expect(hiddenIn("`*a*`")).toEqual(['hide "`"', 'hide "`"']);
  });
});

describe("malformed markup", () => {
  it.each([
    "**a",
    "a**",
    "~~a",
    "`a",
    "[a](b",
    "[a]",
    "[a] (b)",
    "![a](b",
    "<http://x",
    "\\",
    "&nosuchentity",
    "# ",
    "```",
  ])("hides nothing in %j", (source) => {
    expect(hiddenIn(source)).toEqual([]);
  });

  it("hides only the balanced part", () => {
    expect(hiddenIn("**a *b*")).toEqual(['hide "*"', 'hide "*"']);
  });
});

describe("links", () => {
  it("shows link text and hides the brackets and URL", () => {
    expect(inline('see [the docs](https://x.org "T") now')).toEqual([
      'hide "["',
      'mark cm-live-link "the docs"',
      'hide "](https://x.org \\"T\\")"',
    ]);
  });

  it("gives the link text a title with the target", () => {
    const state = liveState("[a](https://x.org)");
    const set = buildDecorations(state, "inline", { from: 0, to: state.doc.length });
    const marks: string[] = [];
    set.between(0, state.doc.length, (_f, _t, d) => {
      const attrs = (d.spec as { attributes?: { title?: string } }).attributes;
      if (attrs?.title) marks.push(attrs.title);
    });
    expect(marks).toEqual(["https://x.org\nCtrl+click to open"]);
  });

  it("reveals the whole link when the caret touches it", () => {
    expect(hiddenIn("[a](u)‸")).toEqual([]);
    expect(hiddenIn("‸[a](u)")).toEqual([]);
    expect(hiddenIn("[a‸](u)")).toEqual([]);
  });

  it("renders full and collapsed reference links, not a bare [text]", () => {
    expect(hiddenIn("[a][r]\n\n[r]: http://x")).toEqual(['hide "["', 'hide "][r]"']);
    expect(hiddenIn("[a]\n\n[a]: http://x")).toEqual([]);
  });

  it("leaves a link with empty text as source", () => {
    expect(hiddenIn("[](http://x)")).toEqual([]);
  });

  it("hides the angle brackets of autolinks", () => {
    expect(inline("<https://x.org> <a@b.co>")).toEqual([
      'hide "<"',
      'mark cm-live-link "https://x.org"',
      'hide ">"',
      'hide "<"',
      'mark cm-live-link "a@b.co"',
      'hide ">"',
    ]);
  });

  it("styles bare URLs without hiding anything", () => {
    expect(inline("go to https://x.org today")).toEqual(['mark cm-live-link "https://x.org"']);
  });
});

describe("escapes and entities", () => {
  it("hides the backslash of an escape unless revealed", () => {
    expect(inline("a \\* b")).toEqual(['hide "\\\\"']);
    expect(inline("a \\*‸ b")).toEqual(['mark cm-live-syntax "\\\\"']);
  });

  it("shows an entity as its character unless revealed", () => {
    expect(inline("a &amp; b")).toEqual(['widget EntityWidget "&amp;"']);
    expect(inline("a &amp;‸ b")).toEqual(['mark cm-live-syntax "&amp;"']);
  });
});

describe("headings", () => {
  it("hides the ATX marker and sizes the line by level", () => {
    for (let level = 1; level <= 6; level++) {
      const marker = "#".repeat(level);
      expect(inline(`${marker} Title`)).toEqual([
        `line 1 cm-live-h${level} cm-live-heading`,
        `hide ${JSON.stringify(`${marker} `)}`,
      ]);
    }
  });

  it("reveals the marker when the caret is anywhere on the heading line", () => {
    expect(inline("## Ti‸tle")).toEqual([
      "line 1 cm-live-h2 cm-live-heading",
      'mark cm-live-syntax "##"',
    ]);
  });

  it("hides a closing sequence too", () => {
    expect(hiddenIn("## Title ##")).toEqual(['hide "## "', 'hide " ##"']);
  });

  it("keeps the marker of an empty heading", () => {
    expect(hiddenIn("#\n\n## ")).toEqual([]);
  });

  it("renders inline markup inside a heading", () => {
    expect(hiddenIn("# A *b*")).toEqual(['hide "# "', 'hide "*"', 'hide "*"']);
  });

  it("styles setext headings and dims (never hides) the underline", () => {
    expect(inline("Title\n=====\n\nSub\n---")).toEqual([
      "line 1 cm-live-h1 cm-live-heading",
      "line 2 cm-live-setext-underline",
      'mark cm-live-syntax "====="',
      "line 4 cm-live-h2 cm-live-heading",
      "line 5 cm-live-setext-underline",
      'mark cm-live-syntax "---"',
    ]);
  });
});

describe("block quotes", () => {
  it("hides the markers and draws one bar per level", () => {
    expect(inline("> a\n> > b\n> c")).toEqual([
      "line 1 cm-live-quote cm-live-quote-1",
      'hide "> "',
      "line 2 cm-live-quote cm-live-quote-2",
      'hide "> "',
      'hide "> "',
      "line 3 cm-live-quote cm-live-quote-2",
      'hide "> "',
    ]);
  });

  it("reveals the markers only on the caret's line", () => {
    expect(hiddenIn("> a\n> b‸\n> c")).toEqual(['hide "> "', 'hide "> "']);
    expect(inline("> a‸")).toContain('mark cm-live-syntax ">"');
  });
});

describe("lists", () => {
  it("draws bullets by depth and keeps ordered numbers as typed", () => {
    expect(inline("- a\n  * b\n    + c\n\n3. x\n4) y")).toEqual([
      'widget BulletWidget "-"',
      'widget BulletWidget "*"',
      'widget BulletWidget "+"',
      'mark cm-live-list-number "3."',
      'mark cm-live-list-number "4)"',
    ]);
    const state = liveState("- a\n  - b\n    - c\n      - d");
    const depths: number[] = [];
    buildDecorations(state, "inline", { from: 0, to: state.doc.length }).between(
      0,
      state.doc.length,
      (_f, _t, d) => {
        const w = d.spec.widget as { depth?: number } | undefined;
        if (w?.depth) depths.push(w.depth);
      },
    );
    expect(depths).toEqual([1, 2, 3, 4]);
  });

  it("reveals a bullet only when the caret touches the marker", () => {
    expect(hiddenIn("‸- a")).toEqual([]);
    expect(hiddenIn("-‸ a")).toEqual([]);
    expect(hiddenIn("- ‸a")).toEqual(['widget BulletWidget "-"']);
    expect(hiddenIn("- a‸")).toEqual(['widget BulletWidget "-"']);
  });

  it("keeps nested indentation as typed", () => {
    // Nothing before a nested marker is hidden.
    const state = liveState("- a\n  - b");
    const set = buildDecorations(state, "inline", { from: 0, to: state.doc.length });
    const ranges: [number, number][] = [];
    set.between(0, state.doc.length, (f, t, d) => {
      if (d.point && f !== t) ranges.push([f, t]);
    });
    expect(ranges).toEqual([
      [0, 1],
      [6, 7],
    ]);
  });

  it("shows task items as a checkbox, and done items struck through", () => {
    expect(inline("- [ ] open\n- [x] done\n1. [X] numbered")).toEqual([
      'widget TaskWidget "- [ ]"',
      'widget TaskWidget "- [x]"',
      'mark cm-live-task-done " done"',
      'widget TaskWidget "1. [X]"',
      'mark cm-live-task-done " numbered"',
    ]);
  });

  it("reveals the task marker when the caret touches it", () => {
    expect(hiddenIn("- [ ]‸ open")).toEqual([]);
    expect(hiddenIn("- [ ] ‸open")).toEqual(['widget TaskWidget "- [ ]"']);
  });
});

describe("horizontal rules", () => {
  it("draws a rule unless the caret is on its line", () => {
    expect(hiddenIn("a\n\n***\n\nb")).toEqual(['widget RuleWidget "***"']);
    expect(hiddenIn("a\n\n**‸*\n\nb")).toEqual([]);
  });
});

describe("code blocks", () => {
  it("styles a fenced block, dims the fences and labels the language", () => {
    expect(inline("```ts\nlet *a* = 1\n```")).toEqual([
      "line 1 cm-live-codeblock cm-live-codeblock-begin cm-live-fence cm-live-fence-dim",
      'mark cm-live-code-lang "ts"',
      "line 2 cm-live-codeblock",
      "line 3 cm-live-codeblock cm-live-codeblock-end cm-live-fence cm-live-fence-dim",
    ]);
  });

  it("undims the fences while the caret is anywhere in the block", () => {
    const result = inline("```\nx‸\n```");
    expect(result.filter((d) => d.includes("fence-dim"))).toEqual([]);
  });

  it("handles an unclosed fence and indented code", () => {
    // An unclosed fence runs to the end of the document.
    expect(inline("‸```\nopen\n")).toEqual([
      "line 1 cm-live-codeblock cm-live-codeblock-begin cm-live-fence",
      "line 2 cm-live-codeblock",
      "line 3 cm-live-codeblock cm-live-codeblock-end",
    ]);
    expect(inline("para\n\n    code *a*\n    more")).toEqual([
      "line 3 cm-live-codeblock cm-live-codeblock-begin",
      "line 4 cm-live-codeblock cm-live-codeblock-end",
    ]);
  });
});

describe("front matter", () => {
  it("is dimmed, never hidden, and not mistaken for a rule or heading", () => {
    expect(inline("---\ntitle: x\n---\n\n# H")).toEqual([
      "line 1 cm-live-frontmatter",
      "line 2 cm-live-frontmatter",
      "line 3 cm-live-frontmatter",
      "line 5 cm-live-h1 cm-live-heading",
      'hide "# "',
    ]);
  });

  it("needs a closing line (otherwise the first line is an ordinary rule)", () => {
    expect(hiddenIn("---\ntitle: x")).toEqual(['widget RuleWidget "---"']);
    expect(inline("---\ntitle: x")).not.toContain("line 1 cm-live-frontmatter");
  });
});

describe("tables, HTML and other blocks", () => {
  it("are left as source", () => {
    expect(inline("| *a* | b |\n|---|---|\n| `c` | d |")).toEqual([]);
    expect(inline("<div>\n*a*\n</div>")).toEqual([]);
    expect(inline("[r]: http://x")).toEqual([]);
  });
});

describe("nested constructs", () => {
  const nested = "> - [b **c**](u) d";

  it("renders every level when the caret is away", () => {
    expect(hiddenIn(nested)).toEqual([
      'hide "> "',
      'widget BulletWidget "-"',
      'hide "["',
      'hide "**"',
      'hide "**"',
      'hide "](u)"',
    ]);
  });

  it("reveals the line's block markers and the touched constructs only", () => {
    // Inside the bold text: the bold and the link around it are revealed, the quote marker is
    // on the caret's line, and the bullet is not touched.
    expect(hiddenIn("> - [b **c‸**](u) d")).toEqual(['widget BulletWidget "-"']);
    // At the end of the line: only the quote marker is revealed.
    expect(hiddenIn(`${nested}‸`)).toEqual([
      'widget BulletWidget "-"',
      'hide "["',
      'hide "**"',
      'hide "**"',
      'hide "](u)"',
    ]);
  });
});

describe("images", () => {
  const options = {
    resolveAsset: (p: string) => `asset://doc/${p}`,
    loadRemoteImages: () => true,
  };

  it("replaces a line holding only an image with the image", () => {
    expect(block("a\n\n![alt](pic.png)\n\nb", options)).toEqual([
      'block ImageWidget "![alt](pic.png)"',
    ]);
  });

  it("reveals the source on that line and keeps the image below it", () => {
    const state = liveState("a\n\n![alt](pic.png)‸\n\nb", { options });
    expect(decorations(state, "block")).toEqual(['block ImageWidget ""']);
    const set = buildDecorations(state, "block", { from: 0, to: state.doc.length });
    set.between(0, state.doc.length, (from, to, d) => {
      expect(from).toBe(state.doc.line(3).to);
      expect(to).toBe(from);
      expect(d.spec.side).toBe(1);
    });
  });

  it("hides an inline image's source and draws it below the line", () => {
    expect(block("text ![a](x.png) more", options)).toEqual([
      'hide "![a](x.png)"',
      'block ImageWidget ""',
    ]);
    expect(block("text ![a](x.png)‸ more", options)).toEqual(['block ImageWidget ""']);
  });

  it("keeps images in quotes and lists on their line", () => {
    expect(block("> ![a](x.png)", options)).toEqual(['hide "![a](x.png)"', 'block ImageWidget ""']);
  });

  it("leaves reference images and images split over lines as source", () => {
    expect(block("![a][r]\n\n[r]: x.png", options)).toEqual([]);
    expect(block("![a\nb](x.png)", options)).toEqual([]);
  });

  it("does not draw images inside code", () => {
    expect(block("```\n![a](x.png)\n```", options)).toEqual([]);
    expect(block("`![a](x.png)`", options)).toEqual([]);
  });

  it("is never rendered by the inline pass", () => {
    expect(inline("![a **b**](x.png)")).toEqual([]);
  });

  it("decides image sources like the preview", () => {
    const remoteOff = { ...options, loadRemoteImages: () => false };
    expect(imageSource("pic.png", options)).toEqual({ kind: "url", url: "asset://doc/pic.png" });
    expect(imageSource("https://x/a.png", options)).toEqual({
      kind: "url",
      url: "https://x/a.png",
    });
    expect(imageSource("//x/a.png", options)).toEqual({ kind: "url", url: "https://x/a.png" });
    expect(imageSource("https://x/a.png", remoteOff)).toEqual({
      kind: "blocked",
      reason: "Remote images are turned off in settings",
    });
    expect(imageSource("javascript:alert(1)", options).kind).toBe("blocked");
    expect(imageSource("file:///C:/a.png", options).kind).toBe("blocked");
    expect(imageSource("data:image/png;base64,AA==", options).kind).toBe("url");
    expect(imageSource("data:text/html;base64,AA==", options).kind).toBe("blocked");
    expect(imageSource("pic.png", { loadRemoteImages: () => true })).toEqual({
      kind: "blocked",
      reason: "Save the document to show images beside it",
    });
    expect(imageSource("", options).kind).toBe("blocked");
  });
});

describe("IME composition", () => {
  it("never hides or replaces anything on the protected line", () => {
    const state = liveState("**a** - b\n\n**c**");
    const line = state.doc.line(1);
    const set = buildDecorations(state, "inline", {
      from: 0,
      to: state.doc.length,
      protect: { from: line.from, to: line.to },
    });
    expect(describeSet(state, set).filter((d) => /^(hide|widget)/.test(d))).toEqual([
      'hide "**"',
      'hide "**"',
    ]);
  });
});

describe("the extension point", () => {
  it("lets a provided renderer take over a node type before the built-in ones", () => {
    const table: LiveRenderer = {
      id: "test-table",
      nodes: ["Table", "Emphasis"],
      decorate(node, out) {
        out.lineClass(node.from, `rendered-${node.name}`);
        return false;
      },
    };
    const state = liveState("| a |\n|---|\n| b |\n\n*e*", {
      extensions: liveRenderers.of(table),
    });
    expect(decorations(state)).toEqual(["line 1 rendered-Table", "line 5 rendered-Emphasis"]);
  });
});

describe("viewport and performance", () => {
  /** About 1 MB of mixed Markdown. */
  function bigDocument(): string {
    const chunk = [
      "## Section heading with *emphasis*",
      "",
      "Some **bold** text, `code`, a [link](https://example.com) and ~~strike~~.",
      "> A quote with a [ref][r]",
      "- item one",
      "- [ ] a task",
      "  1. nested",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "![img](pic.png)",
      "",
    ].join("\n");
    return chunk.repeat(Math.ceil(1_000_000 / chunk.length));
  }

  it("only decorates the range it is given", () => {
    const state = liveState(bigDocument());
    expect(state.doc.length).toBeGreaterThan(1_000_000);
    const from = 500_000;
    const to = 503_000;
    const set = buildDecorations(state, "inline", { from, to });
    let count = 0;
    set.between(0, state.doc.length, (f, t) => {
      count++;
      expect(t).toBeGreaterThanOrEqual(state.doc.lineAt(from).from);
      expect(f).toBeLessThanOrEqual(state.doc.lineAt(to).to);
    });
    expect(count).toBeGreaterThan(50);
  });

  it("builds the decorations for a viewport of a 1 MB document quickly", () => {
    const state = liveState(bigDocument());
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      const from = 100_000 * i;
      buildDecorations(state, "inline", { from, to: from + 5_000 });
      buildDecorations(state, "block", { from: Math.max(0, from - 20_000), to: from + 25_000 });
    }
    // Ten viewports, both passes. Generous: a frame budget is ~16 ms per viewport.
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
