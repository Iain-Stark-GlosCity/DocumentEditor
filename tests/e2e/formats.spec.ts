import { documentText, editor, expect, openFile, test } from "./fixtures";

const ribbon = (page: import("@playwright/test").Page) =>
  page.getByRole("toolbar", { name: "Formatting" });

test("a file type nobody claims opens as plain text, not Markdown", async ({ app }) => {
  // The sample Markdown document is open, so the Markdown ribbon is showing.
  await expect(ribbon(app)).toBeVisible();

  await openFile(app, "/demo/settings.cfg", "# this is not a heading\nname=value\n");
  await expect(editor(app)).toContainText("name=value");
  expect(await documentText(app)).toBe("# this is not a heading\nname=value\n");
  // Plain text has no formatting ribbon.
  await expect(ribbon(app)).toBeHidden();
});

test("a .txt file opens as plain text and a .md file as Markdown", async ({ app }) => {
  await openFile(app, "/demo/todo.txt", "buy milk\n");
  await expect(ribbon(app)).toBeHidden();
  await openFile(app, "/demo/other.md", "# Other\n");
  await expect(ribbon(app)).toBeVisible();
});
