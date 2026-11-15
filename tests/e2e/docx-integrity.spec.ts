import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function makeDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Quarterly report")],
          }),
          new Paragraph({ children: [new TextRun("Sales rose in the quarter")] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** The same file with three deliberate faults, each found in a different part. */
function breakIt(original: Uint8Array): Uint8Array {
  const parts = unzipSync(original);
  const document = strFromU8(parts["word/document.xml"] ?? new Uint8Array());
  parts["word/document.xml"] = strToU8(
    document
      // 1. a style that styles.xml does not define
      .replace('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="GhostStyle"/>')
      // 2. a list that numbering.xml does not define
      .replace(
        "<w:p><w:r>",
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="99"/></w:numPr></w:pPr><w:r>',
      ),
  );
  const rels = strFromU8(parts["word/_rels/document.xml.rels"] ?? new Uint8Array());
  // 3. a relationship to an image that is not in the package
  parts["word/_rels/document.xml.rels"] = strToU8(
    rels.replace(
      "</Relationships>",
      '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/></Relationships>',
    ),
  );
  return zipSync(parts);
}

async function openDocx(app: Page, name: string, bytes: Uint8Array): Promise<void> {
  await app.evaluate(
    ({ path, data }) => {
      window.__demoPlatform?.seedBinary(path, data);
      window.__demoPlatform?.requestOpen([path]);
    },
    { path: `/demo/${name}`, data: Array.from(bytes) },
  );
  await expect(
    app.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }).first(),
  ).toBeVisible();
}

const selectedText = (app: Page) => app.evaluate(() => window.getSelection()?.toString() ?? "");

test("a clean Word file reports no errors or warnings", async ({ app }) => {
  await openDocx(app, "clean.docx", await makeDocx());
  const status = app.getByRole("button", { name: /^Integrity:/ });
  await expect(status).toBeVisible();
  await expect(status).not.toContainText(/error|warning/i);
});

test("the integrity pane finds three deliberate faults and jumps to the exact XML", async ({
  app,
}) => {
  await openDocx(app, "broken.docx", breakIt(await makeDocx()));
  const status = app.getByRole("button", { name: /^Integrity:/ });
  await expect(status).toContainText("2 errors");
  await expect(status).toContainText("1 warning");

  await app.keyboard.press("Control+Alt+i");
  const pane = app
    .getByRole("region", { name: /integrity/i })
    .or(app.locator(".integrity-pane"))
    .first();
  await expect(pane).toBeVisible();

  // Each finding: expand it, then use its location button.
  const jump = async (finding: RegExp, location: RegExp) => {
    await pane.getByText(finding).first().click();
    await pane.getByRole("button", { name: location }).first().click();
  };

  await jump(/style GhostStyle/, /document\.xml.*GhostStyle/);
  await expect(app.getByRole("tab", { name: /broken\.docx › document\.xml/ })).toBeVisible();
  await expect.poll(() => selectedText(app)).toBe('<w:pStyle w:val="GhostStyle"/>');

  await app
    .getByRole("tab", { name: /^broken\.docx/ })
    .first()
    .click();
  await jump(/list 99/, /document\.xml.*99/);
  await expect.poll(() => selectedText(app)).toContain('<w:numId w:val="99"/>');

  await app
    .getByRole("tab", { name: /^broken\.docx/ })
    .first()
    .click();
  await jump(/rId99/, /document\.xml\.rels.*rId99/);
  await expect(app.getByRole("tab", { name: /broken\.docx › document\.xml\.rels/ })).toBeVisible();
  await expect.poll(() => selectedText(app)).toContain('Target="media/missing.png"');
});

test("the copied report has rule codes and locations but none of the document's text", async ({
  app,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDocx(app, "broken.docx", breakIt(await makeDocx()));
  await app.keyboard.press("Control+Alt+i");
  await app.getByRole("button", { name: /copy report/i }).click();
  const report = await app.evaluate(() => navigator.clipboard.readText());
  expect(report).toMatch(/ERROR numbering\./);
  expect(report).toMatch(/at word\/document\.xml/);
  expect(report).not.toContain("GhostStyle");
  expect(report).not.toContain("Quarterly report");
  expect(report).not.toContain("Sales rose");
});
