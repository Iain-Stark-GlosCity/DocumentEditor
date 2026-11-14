import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import * as H from "./hand-samples";
import { docxProvider } from "./index";
import { handDocx } from "./test-helpers";
import { generateDocxView } from "./view";

const style = (id: string, name: string, level: number, extra = "") =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:pPr>${extra}<w:outlineLvl w:val="${level}"/></w:pPr></w:style>`;

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  style("Heading1", "heading 1", 0) +
  style("Heading2", "heading 2", 1) +
  style("Heading3", "heading 3", 2);

const run = (t: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (styleId: string | undefined, inner: string) =>
  `<w:p>${styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : ""}${inner}</w:p>`;

function outlineOf(body: string, rels = {}) {
  const view = generateDocxView(handDocx(body, { styles: STYLES, rels }));
  const state = EditorState.create({
    doc: view,
    extensions: docxProvider.editorExtensions?.({} as never) ?? [],
  });
  return { view, items: docxProvider.outline?.(state) ?? [] };
}

describe("docx outline", () => {
  it("lists headings of three levels, ignoring the legend and trailing comments", () => {
    const { items } = outlineOf(
      para("Heading1", run("Introduction")) +
        para(undefined, run("Body text.")) +
        para("Heading2", run("Background")) +
        para("Heading3", run("Detail")) +
        para("Heading1", run("Conclusion")),
    );
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [1, "Introduction"],
      [2, "Background"],
      [3, "Detail"],
      [1, "Conclusion"],
    ]);
    // Every item points at its own line.
    for (const item of items) expect(item.line).toBeGreaterThan(1);
  });

  it("gives plain text for a heading with bold, a link, tags and a bookmark", () => {
    const { view, items } = outlineOf(
      para(
        "Heading1",
        run("Results and ") +
          run("key", "<w:b/>") +
          run(" ", "") +
          '<w:hyperlink r:id="rIdLink">' +
          run("the report") +
          "</w:hyperlink>" +
          '<w:bookmarkStart w:id="1" w:name="results"/><w:bookmarkEnd w:id="1"/>' +
          run(" (2024)", '<w:color w:val="C00000"/>'),
      ),
      { rIdLink: ["hyperlink", "https://example.com/report", true] },
    );
    expect(view).toContain("**key**");
    expect(view).toContain("[the report](https://example.com/report)");
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("Results and key the report (2024)");
  });

  it("is empty for a document without headings", () => {
    expect(outlineOf(H.P("Just text")).items).toEqual([]);
  });
});
