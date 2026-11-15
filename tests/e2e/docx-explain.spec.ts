import { strFromU8, unzipSync } from "fflate";
import { Document, Packer, Paragraph, TextRun } from "docx";
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
