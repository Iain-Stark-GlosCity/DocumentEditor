import { describe, expect, it } from "vitest";
import { richSampleBytes, sourceFromZip } from "./test-helpers";
import { generateDocxView } from "./view";

/**
 * One whole document, made with the `docx` package, kept as a snapshot so any change to the
 * notation shows up in review. The package stamps the creation time, so that is fixed here.
 */
describe("the rich sample", () => {
  it("matches the snapshot", async () => {
    const source = sourceFromZip(await richSampleBytes());
    const fixed = {
      names: () => source.names(),
      text: (name: string) => {
        const text = source.text(name);
        return name === "docProps/core.xml" && text
          ? text.replace(/(<dcterms:(created|modified)[^>]*>)[^<]*/g, "$12024-05-01T10:00:00Z")
          : text;
      },
    };
    await expect(generateDocxView(fixed)).toMatchFileSnapshot(
      "../../../tests/fixtures/docx-rich-sample.view.md",
    );
  }, 30_000);
});
