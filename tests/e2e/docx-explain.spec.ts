import { readFileSync } from "node:fs";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import type { Page } from "@playwright/test";
import { documentText, expect, test } from "./fixtures";

async function makeDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            indent: { left: 720, hanging: 360 },
            spacing: { after: 240 },
            children: [new TextRun("Indented paragraph")],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function openDocx(app: Page, name: string, bytes: Uint8Array): Promise<void> {
  await app.evaluate(
    ({ path, data }) => {
      window.__demoPlatform?.seedBinary(path, data);
      window.__demoPlatform?.requestOpen([path]);
    },
    { path: `/demo/${name}`, data: Array.from(bytes) },
  );
  await expect(app.getByRole("tab", { name: /explain\.docx/ }).first()).toBeVisible();
}

test("the Explain pane says where a paragraph's indent comes from and reveals it", async ({
  app,
}) => {
  await openDocx(app, "explain.docx", await makeDocx());
  await app.locator(".cm-content").getByText("Indented paragraph").first().click();
  await app.keyboard.press("Control+Alt+e");

  const pane = app.getByRole("region", { name: "Explain this paragraph" });
  await expect(pane).toBeVisible();
  const left = pane.getByRole("group", { name: "Left indent" });
  await expect(left).toContainText("1.27 cm (36 pt)");
  await expect(left).toContainText("Direct formatting");
  await expect(pane.getByRole("group", { name: "Space after" })).toContainText("12 pt");

  await left.getByRole("button", { name: "Direct formatting" }).click();
  await expect(app.getByRole("tab", { name: /document\.xml/ }).first()).toBeVisible();
});

test("the repair removes the paragraph's own indent as an undoable edit, saved safely", async ({
  app,
}) => {
  const original = await makeDocx();
  await openDocx(app, "explain.docx", original);
  await app.locator(".cm-content").getByText("Indented paragraph").first().click();
  await app.keyboard.press("Control+Alt+e");
  const pane = app.getByRole("region", { name: "Explain this paragraph" });
  await pane
    .getByRole("group", { name: "Left indent" })
    .getByRole("button", { name: "Remove this paragraph's own indent" })
    .click();

  await expect(app.getByRole("tab", { name: /explain\.docx › document\.xml/ })).toBeVisible();
  await expect.poll(() => documentText(app)).not.toContain("<w:ind");
  expect(await documentText(app)).toContain("Indented paragraph");
  await app.keyboard.press("Control+z");
  await expect.poll(() => documentText(app)).toContain("<w:ind");
  await app.keyboard.press("Control+Shift+z");
  await expect.poll(() => documentText(app)).not.toContain("<w:ind");

  await app.keyboard.press("Control+s");
  await expect
    .poll(() =>
      app.evaluate(() => window.__demoPlatform?.binaryFiles.has("/demo/explain.docx.bak")),
    )
    .toBe(true);
  const saved = await app.evaluate(() => {
    const b = window.__demoPlatform?.binaryFiles.get("/demo/explain.docx");
    return b ? Array.from(b) : [];
  });
  const before = unzipSync(original);
  const after = unzipSync(Uint8Array.from(saved));
  expect(Object.keys(after)).toEqual(Object.keys(before));
  const changed = Object.keys(before).filter(
    (n) => Buffer.compare(Buffer.from(before[n] ?? []), Buffer.from(after[n] ?? [])) !== 0,
  );
  expect(changed).toEqual(["word/document.xml"]);
  expect(strFromU8(after["word/document.xml"] ?? new Uint8Array())).not.toContain("<w:ind");
});

test("reading a Word file happens in a Web Worker, not on the page's thread", async ({ app }) => {
  const started = app.waitForEvent("worker", (w) => w.url().includes("docx.worker"));
  await openDocx(app, "explain.docx", await makeDocx());
  await started;
  await expect(app.locator(".cm-content")).toContainText("Indented paragraph");
});

test("the spacing repair removes the paragraph's own spacing as an undoable edit", async ({
  app,
}) => {
  await openDocx(app, "explain.docx", await makeDocx());
  await app.locator(".cm-content").getByText("Indented paragraph").first().click();
  await app.keyboard.press("Control+Alt+e");
  const pane = app.getByRole("region", { name: "Explain this paragraph" });
  await pane
    .getByRole("group", { name: "Space after" })
    .getByRole("button", { name: "Remove this paragraph's own spacing" })
    .click();
  await expect.poll(() => documentText(app)).not.toContain("<w:spacing");
  expect(await documentText(app)).toContain("<w:ind");
  await app.keyboard.press("Control+z");
  await expect.poll(() => documentText(app)).toContain("<w:spacing");
});

test("a picture inside a Word file can be previewed and saved as a copy", async ({ app }) => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    ),
    (c) => c.charCodeAt(0),
  );
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ImageRun({ type: "png", data: png, transformation: { width: 40, height: 40 } }),
            ],
          }),
        ],
      },
    ],
  });
  await openDocx(app, "explain.docx", new Uint8Array(await Packer.toBuffer(doc)));

  await app.getByRole("treeitem", { name: /^image1\.png/ }).click();
  const dialog = app.getByRole("dialog", { name: "image1.png" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("PNG picture");
  await expect(dialog.getByRole("img", { name: "Preview of image1.png" })).toBeVisible();

  await app.evaluate(() => window.__demoPlatform?.queueSaveDialog("/demo/out/copy.png"));
  await dialog.getByRole("button", { name: "Save a copy…" }).click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        Array.from(window.__demoPlatform?.binaryFiles.get("/demo/out/copy.png") ?? []),
      ),
    )
    .toEqual(Array.from(png));

  await app.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("an embedded, obfuscated font can be previewed", async ({ app }) => {
  const guid = "{00112233-4455-6677-8899-AABBCCDDEEFF}";
  const font = new Uint8Array(readFileSync("node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf"));
  // Word's obfuscation: XOR the first 32 bytes with the GUID's bytes, last pair first.
  const hex = guid.replace(/[{}-]/g, "");
  const key = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(30 - i * 2, 32 - i * 2), 16));
  const hidden = font.slice();
  for (let i = 0; i < 32; i++) hidden[i] = (hidden[i] ?? 0) ^ (key[i % 16] ?? 0);

  const parts = unzipSync(await makeDocx());
  parts[`word/fonts/${guid}.odttf`] = hidden;
  await openDocx(app, "explain.docx", zipSync(parts));

  await app.getByRole("treeitem", { name: /odttf/ }).click();
  const dialog = app.getByRole("dialog", { name: new RegExp(guid.slice(1, 9), "i") });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /Sample text in/ })).toBeVisible();
  const family = await dialog
    .getByRole("img", { name: /Sample text in/ })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain("part-preview-");
  await app.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
