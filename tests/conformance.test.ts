/**
 * Spec conformance: the CommonMark 0.31.2 examples and the GFM (cmark-gfm 0.29) extension
 * examples, run against the real pipeline with sanitising and data-line steps switched off
 * (the spec examples contain raw HTML and know nothing about our attributes).
 *
 * `KNOWN_FAILURES` lists examples that fail today. The test fails if a listed example starts
 * passing (so the list is kept honest) and if any unlisted example fails (regression).
 */
import { describe, expect, it } from "vitest";
import { createMarkdownProcessor } from "../src/render";
import commonmarkSource from "./fixtures/commonmark-0.31.2.spec.txt?raw";
import gfmSource from "./fixtures/gfm.spec.txt?raw";
import { normaliseHtml, parseSpec, type SpecExample } from "./spec-examples";

const context = { path: null, resolveAsset: (p: string) => p };

/**
 * Our additions to the output (maths, Mermaid placeholders, highlighting, heading ids, GitHub's
 * task-list classes) are not in the specs, so the spec runs switch them off. They are covered by
 * the unit tests in `src/render`.
 */
const SPEC_ONLY = {
  math: false,
  mermaid: false,
  highlight: false,
  headingIds: false,
  taskListClasses: false,
} as const;

/** CommonMark: plain parser, no extensions, no sanitising, no data-line. */
const commonmark = createMarkdownProcessor({
  gfm: false,
  frontmatter: false,
  dataLines: false,
  resolveAssets: false,
  sanitise: false,
  ...SPEC_ONLY,
});

/** GFM extension examples: GFM on, everything else off. */
const gfm = createMarkdownProcessor({
  gfm: true,
  frontmatter: false,
  dataLines: false,
  resolveAssets: false,
  sanitise: false,
  ...SPEC_ONLY,
});

/** Build a number -> reason map from groups of example numbers. */
function known(groups: [reason: string, numbers: number[]][]): Record<number, string> {
  return Object.fromEntries(groups.flatMap(([reason, numbers]) => numbers.map((n) => [n, reason])));
}

/**
 * Known CommonMark failures, by example number as in the spec.
 *
 * Every one of them involves raw HTML. The pipeline hands raw HTML to `rehype-raw`, which parses
 * it with a real HTML5 parser (parse5), the way a browser would, and that repairs the markup
 * that the CommonMark spec passes through verbatim. This is intended: the preview then matches
 * what a browser shows, and the output is sanitised afterwards in any case. No example that
 * avoids raw HTML fails. (Two code-block examples, 127 and 129, failed for the same reason, a
 * dropped leading newline, and are fixed in `rehypeNoteCodeNewline` / `rehypeRestoreCodeNewline`.)
 */
const COMMONMARK_KNOWN_FAILURES = known([
  [
    "unclosed raw element is closed by the HTML5 parser (spec leaves it open)",
    [
      21, 31, 150, 155, 173, 174, 175, 184, 187, 201, 344, 476, 477, 491, 494, 524, 536, 613, 614,
      615, 616, 617, 630, 631, 642, 643,
    ],
  ],
  ["stray raw end tag is dropped by the HTML5 parser", [151, 165, 623]],
  [
    "implied <tbody> inserted, or table content foster-parented, by the HTML5 parser",
    [148, 149, 160, 190, 191],
  ],
  [
    "processing instruction, doctype, CDATA or markup declaration becomes a comment or is dropped",
    [180, 181, 182, 627, 628, 629],
  ],
  ["malformed raw tag is dropped by the HTML5 parser (spec renders it as text)", [156, 157, 158]],
  ["newline inside a raw attribute value is normalised to a space", [154]],
  ["`<!-->` and `<!--->` comments are normalised to `<!---->`", [626]],
]);

/**
 * Known GFM extension failures, by example number as in the GFM spec file.
 * Only the extension examples (tables, task lists, strikethrough, autolinks, tagfilter) run;
 * the rest of that file is the CommonMark spec again.
 */
const GFM_KNOWN_FAILURES = known([
  ["extended autolinks: `ftp://` is not linked by remark-gfm", [628]],
  [
    "tagfilter is not implemented; the sanitiser removes those tags instead, which is stricter",
    [652],
  ],
]);

async function run(
  processor: ReturnType<typeof createMarkdownProcessor>,
  examples: SpecExample[],
  known: Record<number, string>,
  label: string,
) {
  const failing: number[] = [];
  const unexpectedPasses: number[] = [];
  const unexpectedFailures: string[] = [];
  for (const example of examples) {
    const actual = normaliseHtml(await processor.render(example.markdown, context));
    const expected = normaliseHtml(example.html);
    const passed = actual === expected;
    if (!passed) failing.push(example.number);
    if (!passed && !(example.number in known)) {
      unexpectedFailures.push(
        `#${example.number} (${example.section})\n  md:       ${JSON.stringify(example.markdown)}\n  expected: ${expected}\n  actual:   ${actual}`,
      );
    }
    if (passed && example.number in known) unexpectedPasses.push(example.number);
  }
  const passedCount = examples.length - failing.length;
  console.log(
    `${label}: ${passedCount}/${examples.length} pass (${((passedCount / examples.length) * 100).toFixed(1)}%)`,
  );
  return { failing, unexpectedPasses, unexpectedFailures };
}

describe("CommonMark 0.31.2 conformance", () => {
  const examples = parseSpec(commonmarkSource);

  it("parses the spec", () => {
    expect(examples).toHaveLength(652);
  });

  it("matches every example except the known failures", async () => {
    const result = await run(commonmark, examples, COMMONMARK_KNOWN_FAILURES, "CommonMark");
    expect(result.unexpectedFailures, result.unexpectedFailures.join("\n")).toEqual([]);
    expect(result.unexpectedPasses, "listed as failing but now pass: remove from the list").toEqual(
      [],
    );
  });
});

describe("GFM extension conformance", () => {
  // Only the extension examples; the rest of the GFM spec is the CommonMark spec again.
  const examples = parseSpec(gfmSource).filter((e) => e.tag !== "");

  it("finds the extension examples", () => {
    expect(examples.length).toBeGreaterThan(20);
  });

  it("matches every extension example except the known failures", async () => {
    const result = await run(gfm, examples, GFM_KNOWN_FAILURES, "GFM extensions");
    expect(result.unexpectedFailures, result.unexpectedFailures.join("\n")).toEqual([]);
    expect(result.unexpectedPasses, "listed as failing but now pass: remove from the list").toEqual(
      [],
    );
  });
});
