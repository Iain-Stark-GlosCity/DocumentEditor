import { Document, Packer, Paragraph, TextRun } from "docx";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

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
