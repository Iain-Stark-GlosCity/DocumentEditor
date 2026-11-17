/**
 * The exporter checked by the app's own DOCX tools: every part is well-formed XML, the Formatting
 * view reads the content back in order, the integrity inspector finds nothing wrong, Python's
 * zip reader accepts the archive, no personal details are written, and every style used exists.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inspectDocxBytes } from "../../docx/inspect";
import { descendants, parseXml } from "../../docx/xml";
import { parseMarkdown, plainText } from "./parse";
import { pngBytes } from "./test-images";
import { exportMarkdown, partsOf, viewBody, xmlRoot } from "./test-support";

const RICH = `---
title: Annual review
---

# Annual review

An introduction with *emphasis*, **strong words**, ~~struck text~~, \`inline code\` and a
[web link](https://example.com/report). See also [the results](#results) and
<https://example.org/auto>.[^source]

## Plan

1. Gather the data
2. Write the report
   - Draft
   - Review
     1. First pass
3. Publish

- [ ] Book the room
- [x] Send the agenda

> Quoted advice.
>
> > Nested advice.

\`\`\`python
def total(xs):
    return sum(xs)
\`\`\`

## Results

| Region | Q1 | Q2 |
| :----- | :-: | -: |
| North | 1.2 | 1.4 |
| South | 0.9 | 1.1 |

![Company logo](logo.png)

---

Closing words with <b>raw</b> HTML &amp; entities.

[^source]: Internal figures, unaudited.
`;

describe("dogfooding a rich document", () => {
  let bytes: Uint8Array;
  let parts: Record<string, string>;

  beforeAll(async () => {
    bytes = await exportMarkdown(RICH, { "logo.png": pngBytes(1200, 400) });
    parts = partsOf(bytes);
  });

  it("(a) writes only well-formed XML parts", () => {
    const xmlParts = Object.keys(parts).filter((n) => /\.(xml|rels)$/.test(n));
    expect(xmlParts).toEqual(
      expect.arrayContaining([
        "word/document.xml",
        "word/styles.xml",
        "word/numbering.xml",
        "word/footnotes.xml",
        "[Content_Types].xml",
      ]),
    );
    for (const name of xmlParts) {
      expect(parseXml(parts[name]!).problems, name).toEqual([]);
    }
  });

  it("(b) reads back in the Formatting view, in order, with headings, lists and the table", async () => {
    const body = await viewBody(bytes);
    const expected = [
      '# <bookmark-start name="annual-review"/>Annual review',
      'An introduction with *emphasis*, **strong words**, ~~struck text~~, <span style="Code">inline code</span>',
      "[web link](https://example.com/report)",
      "[the results](#results)",
      "[https://example.org/auto](https://example.org/auto)",
      "[^1]",
      '## <bookmark-start name="plan"/>Plan',
      "1. Gather the data",
      "2. Write the report",
      "   - Draft",
      "   - Review",
      "     1. First pass",
      "3. Publish",
      '- <span font="Segoe UI Symbol">☐ </span>Book the room',
      '- <span font="Segoe UI Symbol">☑ </span>Send the agenda',
      "> Quoted advice. <!-- p style=Quote -->",
      "> Nested advice. <!-- p style=Quote indent-left=72pt -->",
      'def total(xs):<br/>    return sum(xs) <!-- p style="Source Code" -->',
      '## <bookmark-start name="results"/>Results',
      '<table style="Table Grid" width="100%"',
      "<tr header>",
      '<td width="193.4pt" shading="F2F2F2">**Region** <!-- p align=left --></td>',
      "**Q1** <!-- p align=centre -->",
      "**Q2** <!-- p align=right -->",
      "North",
      "1.4 <!-- p align=right -->",
      "South",
      "</table>",
      '<drawing kind="picture" name="Picture 1" width="432pt" height="144pt" placement="inline">![Company logo]',
      'border-bottom="single 0.75pt auto space 1pt"',
      "Closing words with raw HTML & entities.",
    ];
    let from = 0;
    for (const piece of expected) {
      const at = body.indexOf(piece, from);
      expect(at, `"${piece}" after offset ${from} in:\n${body}`).toBeGreaterThanOrEqual(0);
      from = at + piece.length;
    }
    expect(body).not.toContain("<b>");
  });

  it("(b) shows the footnote and the styles in the appendices", async () => {
    const { decodeDocx } = await import("../../docx/decode");
    const view = (await decodeDocx(bytes, { path: "/docs/report.docx" })).text;
    expect(view).toContain("[^1]: <note-number/>Internal figures, unaudited.");
    expect(view).toContain('<!-- properties title="Annual review"');
    for (const name of [
      "Heading 1",
      "Heading 2",
      "Quote",
      "Source Code",
      "Code",
      "List Paragraph",
      "Table Grid",
      "Hyperlink",
    ]) {
      expect(view).toContain(`<!-- style "${name}"`);
    }
    expect(view).not.toMatch(/styles? used but missing|not defined/i);
  });

  it("(c) gets no errors or warnings from the integrity inspector", async () => {
    const findings = await inspectDocxBytes(bytes, { path: "/docs/report.docx" });
    const serious = findings.filter((f) => f.severity !== "info");
    expect(serious.map((f) => `${f.severity} ${f.rule}: ${f.title}`)).toEqual([]);
  });

  it("(d) is a zip that Python's zipfile accepts", () => {
    const probe = spawnSync("python3", ["--version"]);
    if (probe.error) return; // No Python here: nothing to check against.
    const dir = mkdtempSync(join(tmpdir(), "md-docx-"));
    try {
      const file = join(dir, "export.docx");
      writeFileSync(file, bytes);
      const result = spawnSync("python3", ["-I", "-m", "zipfile", "-t", file], {
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(e) writes no author, last-modified-by, description or application name", () => {
    const core = xmlRoot(parts["docProps/core.xml"]);
    for (const name of ["dc:creator", "cp:lastModifiedBy", "dc:description"]) {
      const text = descendants(core, name)
        .map((e) => e.children.join(""))
        .join("");
      expect(text, name).toBe("");
    }
    expect(parts["docProps/app.xml"]).not.toMatch(/<Application>|<Company>|<Manager>/);
    expect(descendants(core, "dc:title")[0]?.children.join("")).toBe("Annual review");
  });

  it("(f) defines every paragraph, character and table style it uses", () => {
    const styles = xmlRoot(parts["word/styles.xml"]);
    const ids = new Set(descendants(styles, "w:style").map((s) => s.attrs["w:styleId"]));
    const used = new Set<string>();
    for (const part of [
      "word/document.xml",
      "word/footnotes.xml",
      "word/endnotes.xml",
      "word/numbering.xml",
    ]) {
      const root = xmlRoot(parts[part]);
      for (const name of ["w:pStyle", "w:rStyle", "w:tblStyle"]) {
        for (const el of descendants(root, name)) used.add(el.attrs["w:val"]!);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    for (const id of used) expect(ids.has(id), id).toBe(true);
    // Style ids are unique, and Word's built-in styles carry Word's own names.
    const all = descendants(styles, "w:style").map((s) => s.attrs["w:styleId"]);
    expect(new Set(all).size).toBe(all.length);
    const heading1 = descendants(styles, "w:style").find(
      (s) => s.attrs["w:styleId"] === "Heading1",
    );
    expect(descendants(heading1, "w:name")[0]?.attrs["w:val"]).toBe("heading 1");
  });

  it("keeps Word's separator notes free of a note mark", () => {
    for (const part of ["word/footnotes.xml", "word/endnotes.xml"]) {
      const root = xmlRoot(parts[part]);
      const notes = descendants(root, part.includes("foot") ? "w:footnote" : "w:endnote");
      const separators = notes.filter((n) => n.attrs["w:type"] !== undefined);
      expect(separators).toHaveLength(2);
      for (const note of separators) {
        expect(descendants(note, "w:footnoteRef")).toEqual([]);
        expect(descendants(note, "w:endnoteRef")).toEqual([]);
      }
    }
  });
});

describe("text round trip", () => {
  // Prose only: what Word shows must be exactly the Markdown's text, paragraph by paragraph.
  const PROSE = `# Report on the year's results

The council's budget rose by 4.2 per cent; most of it went on roads, schools and care.

Smith and Jones said: "It was a *good* year, all told," and **nobody** disagreed.

## A second heading

Line one ends here
and this line follows it as a soft break.

Numbers like 3.14, dates like 1 May 2024, and an em dash — all survive.
`;

  /** Strips the view's notation from a body line, leaving the text Word shows. */
  function viewText(line: string): string {
    return line
      .replace(/<!--.*?-->/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/^#{1,6} /, "")
      .replace(/\*\*|\*|~~/g, "")
      .replace(/\\(.)/g, "$1")
      .trim();
  }

  it("gives the same text, block by block", async () => {
    const bytes = await exportMarkdown(PROSE);
    const fromView = (await viewBody(bytes))
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map(viewText);
    const fromMarkdown = parseMarkdown(PROSE).children.map((block) =>
      plainText(block).replace(/\n/g, " ").trim(),
    );
    expect(fromView).toEqual(fromMarkdown);
  });
});
