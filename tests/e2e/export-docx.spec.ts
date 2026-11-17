import { strFromU8, unzipSync } from "fflate";
import { expect, openFile, test } from "./fixtures";

test("File > Export… saves the Markdown document as a Word file", async ({ app }) => {
  await openFile(app, "/demo/notes.md", "# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n");
  await app.evaluate(() => window.__demoPlatform?.queueSaveDialog("/demo/out/notes.docx"));
  await app.getByRole("menuitem", { name: "File", exact: true }).click();
  await app.getByRole("menuitem", { name: /^Export…/ }).click();

  await expect
    .poll(() =>
      app.evaluate(
        () => window.__demoPlatform?.binaryFiles.get("/demo/out/notes.docx")?.length ?? 0,
      ),
    )
    .toBeGreaterThan(1000);
  const bytes = await app.evaluate(() =>
    Array.from(window.__demoPlatform?.binaryFiles.get("/demo/out/notes.docx") ?? []),
  );
  const parts = unzipSync(Uint8Array.from(bytes));
  expect(Object.keys(parts)).toContain("word/document.xml");
  const document = strFromU8(parts["word/document.xml"] ?? new Uint8Array());
  expect(document).toContain("First paragraph.");
  expect(document).toContain("Second paragraph.");
  await expect(app.getByText(/Exported notes\.md as notes\.docx/)).toBeVisible();
});
