import { unzipSync } from "fflate";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { documentText, editor, expect, test } from "./fixtures";

/** A small but real Word file, made by the `docx` package. */
async function makeDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Quarterly report")],
          }),
          new Paragraph({
            children: [
              new TextRun("Sales rose "),
              new TextRun({ text: "twelve per cent", bold: true }),
              new TextRun({ text: " in the quarter", color: "C00000" }),
            ],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const bytesOf = (page: import("@playwright/test").Page, path: string) =>
  page.evaluate((p) => {
    const bytes = window.__demoPlatform?.binaryFiles.get(p);
    return bytes ? Array.from(bytes) : null;
  }, path);

test("a Word file opens as a read-only formatting view with its parts beside it", async ({
  app,
}) => {
  const original = await makeDocx();
  await app.evaluate((bytes) => {
    window.__demoPlatform?.seedBinary("/demo/report.docx", bytes);
    window.__demoPlatform?.requestOpen(["/demo/report.docx"]);
  }, Array.from(original));
  await expect(app.getByRole("tab", { name: /report\.docx/ })).toBeVisible();
  await expect(editor(app)).toContainText("Quarterly report");

  const view = await documentText(app);
  expect(view).toContain("# Quarterly report");
  expect(view).toContain("**twelve per cent**");
  expect(view).toContain('colour="C00000"');
  expect(view).toContain("<!-- p style=");

  // Read-only: typing changes nothing, and the status bar says so.
  await editor(app).click();
  await app.keyboard.type("SHOULD NOT APPEAR");
  expect(await documentText(app)).not.toContain("SHOULD NOT APPEAR");
  await expect(app.getByText("Read-only", { exact: true })).toBeVisible();

  // The parts are listed beside it.
  await expect(app.getByRole("treeitem", { name: /document\.xml/ }).first()).toBeVisible();
});

test("editing one part of a Word file changes only that part, and broken XML is refused", async ({
  app,
}) => {
  const original = await makeDocx();
  await app.evaluate((bytes) => {
    window.__demoPlatform?.seedBinary("/demo/report.docx", bytes);
    window.__demoPlatform?.requestOpen(["/demo/report.docx"]);
  }, Array.from(original));
  await expect(app.getByRole("tab", { name: /report\.docx/ })).toBeVisible();

  await app
    .locator("[role=treeitem]")
    .filter({ hasText: /^document\.xml(?!\.)/ })
    .first()
    .click();
  await expect(app.getByRole("tab", { name: /report\.docx › document\.xml/ })).toBeVisible();

  // Edit the text inside the part and save it back into the archive.
  await editor(app).click();
  await app.keyboard.press("Shift+Alt+F"); // Tidy: whitespace only
  await app.keyboard.press("Control+f");
  await app.keyboard.type("Quarterly report");
  await app.keyboard.press("Enter");
  await app.keyboard.press("Escape");
  await app.keyboard.type("Annual report");
  await app.keyboard.press("Control+s");
  await expect.poll(async () => (await bytesOf(app, "/demo/report.docx.bak")) !== null).toBe(true);

  const saved = await bytesOf(app, "/demo/report.docx");
  expect(saved).not.toBeNull();
  const before = unzipSync(original);
  const after = unzipSync(Uint8Array.from(saved ?? []));
  expect(Object.keys(after)).toEqual(Object.keys(before));
  const changed = Object.keys(before).filter(
    (name) => Buffer.compare(Buffer.from(before[name] ?? []), Buffer.from(after[name] ?? [])) !== 0,
  );
  expect(changed).toEqual(["word/document.xml"]);
  expect(new TextDecoder().decode(after["word/document.xml"])).toContain("Annual report");
  // The Formatting view follows the saved part, and says nothing about it: the user made the change.
  await app
    .getByRole("tab", { name: /report\.docx/ })
    .filter({ hasNotText: "›" })
    .click();
  // The browser build has no file watcher, so tell it what the desktop one would.
  await app.evaluate(() => window.__demoPlatform?.triggerFileChange("/demo/report.docx"));
  await expect.poll(() => documentText(app)).toContain("Annual report");
  await app.waitForTimeout(600);
  await expect(app.getByText(/changed on disk/)).toHaveCount(0);
  // The one-off backup is the original, untouched.
  expect(
    Buffer.compare(
      Buffer.from(Uint8Array.from((await bytesOf(app, "/demo/report.docx.bak")) ?? [])),
      Buffer.from(original),
    ),
  ).toBe(0);

  // Broken XML is refused and the archive is left alone.
  await app.getByRole("tab", { name: /report\.docx › document\.xml/ }).click();
  await editor(app).click();
  await app.keyboard.press("Control+Home");
  await app.keyboard.type("<broken");
  await app.keyboard.press("Control+s");
  await expect(app.getByText(/is not well-formed XML/)).toBeVisible();
  await expect(app.getByText(/Nothing was saved/)).toBeVisible();
  expect(await bytesOf(app, "/demo/report.docx")).toEqual(saved);
});

/** A Word file with a heading, a paragraph and a table, to reveal elements of. */
async function makeDocxWithTable(): Promise<Uint8Array> {
  const cell = (text: string) => new TableCell({ children: [new Paragraph(text)] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Quarterly report")],
          }),
          new Paragraph({
            children: [
              new TextRun("Sales rose "),
              new TextRun({ text: "twelve per cent", bold: true }),
            ],
          }),
          new Table({
            rows: [
              new TableRow({ children: [cell("Cell alpha"), cell("Cell bravo")] }),
              new TableRow({ children: [cell("Cell charlie"), cell("Cell delta")] }),
            ],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const selectedText = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

test("Reveal in source XML jumps from a line of the view to that element in the part", async ({
  app,
}) => {
  const original = await makeDocxWithTable();
  await app.evaluate((bytes) => {
    window.__demoPlatform?.seedBinary("/demo/report.docx", bytes);
    window.__demoPlatform?.requestOpen(["/demo/report.docx"]);
  }, Array.from(original));
  await expect(app.getByRole("tab", { name: /report\.docx/ })).toBeVisible();
  await expect(editor(app)).toContainText("Sales rose");
  const viewTab = app.getByRole("tab", { name: /report\.docx/ }).filter({ hasNotText: "›" });
  const partTab = app.getByRole("tab", { name: /report\.docx › document\.xml/ });

  // From a paragraph, with the key.
  await app.locator(".cm-line", { hasText: "Sales rose" }).click();
  await app.keyboard.press("Control+Alt+x");
  await expect(partTab).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => selectedText(app)).toContain("twelve per cent");
  expect(await selectedText(app)).toMatch(/^<w:p[ >]/);
  expect(await selectedText(app)).toMatch(/<\/w:p>$/);
  expect(await selectedText(app)).not.toContain("Quarterly report");

  // From a paragraph inside a table cell, with the View menu. The same tab is used again.
  await viewTab.click();
  await app.locator(".cm-line", { hasText: "Cell delta" }).first().click();
  await app.getByRole("menuitem", { name: "View", exact: true }).click();
  await app.getByRole("menuitem", { name: /Reveal in source XML/ }).click();
  await expect(partTab).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => selectedText(app)).toContain("Cell delta");
  expect(await selectedText(app)).toMatch(/^<w:p[ >]/);
  expect(await selectedText(app)).not.toContain("Cell charlie");
  await expect(app.getByRole("tab", { name: /report\.docx › document\.xml/ })).toHaveCount(1);

  // On a line with no source (the legend at the top) the command does nothing.
  await viewTab.click();
  await app.locator(".cm-line").first().click();
  await app.keyboard.press("Control+Alt+x");
  await expect(viewTab).toHaveAttribute("aria-selected", "true");
});
