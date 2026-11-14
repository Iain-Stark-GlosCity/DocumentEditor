import { documentText, editor, expect, setDocument, test } from "./fixtures";

const SAMPLE = [
  "# Heading one",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "Inline maths $e^{i\\pi}$ and a block:",
  "",
  "$$",
  "x^2 + y^2",
  "$$",
  "",
  "```mermaid",
  "graph TD; A-->B;",
  "```",
  "",
].join("\n");

test("loads with no console errors or CSP violations", async ({ app }) => {
  await expect(editor(app)).toContainText("Welcome");
  await expect(app.getByRole("menubar")).toBeVisible();
});

test("split preview renders headings, tables, code, maths and diagrams in the worker", async ({
  app,
}) => {
  const worker = app.waitForEvent("worker");
  await setDocument(app, SAMPLE);
  await app.keyboard.press("Alt+p");
  await worker;

  const preview = app.locator(".preview-scroll");
  await expect(preview.getByRole("heading", { name: "Heading one" })).toBeVisible();
  await expect(preview.locator("table td", { hasText: "2" })).toBeVisible();
  await expect(preview.locator("pre code span[class^='hljs-']").first()).toBeVisible();
  await expect(preview.locator(".katex")).toHaveCount(2);
  await expect(preview.locator("svg").first()).toBeVisible();
  await expect(app.getByText("Preview not updated")).toHaveCount(0);

  // The copy button on a code block puts its text on the clipboard.
  await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await preview.locator("pre").first().hover();
  await preview.locator("button.code-copy").first().click();
  await expect.poll(() => app.evaluate(() => navigator.clipboard.readText())).toContain("answer");
});

test("find widget floats over the editor without moving the text, and Escape closes it", async ({
  app,
}) => {
  await setDocument(app, "alpha beta\n".repeat(40));
  await app.keyboard.press("Control+Home");
  const firstLine = app.locator(".cm-line").first();
  await expect(firstLine).toBeVisible();
  const before = await firstLine.boundingBox();

  await app.keyboard.press("Control+f");
  const widget = app.locator(".cm-find");
  await expect(widget).toBeVisible();
  await expect(widget.locator("input[name=search]")).toBeFocused();
  const after = await firstLine.boundingBox();
  expect(after?.y).toBe(before?.y);

  // In the top-right corner of the editor, clear of the scrollbar.
  const box = (await widget.boundingBox())!;
  const scroller = (await app.locator(".cm-scroller").boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(420);
  expect(box.y).toBeLessThan(scroller.y + 16);
  expect(box.x + box.width).toBeLessThanOrEqual(scroller.x + scroller.width - 8);
  expect(box.x + box.width).toBeGreaterThan(scroller.x + scroller.width - 60);

  await app.keyboard.type("beta");
  await expect(widget.locator(".cm-find-count")).toHaveText("1 of 40");
  await app.keyboard.press("Enter");
  await expect(widget.locator(".cm-find-count")).toHaveText("2 of 40");
  await app.keyboard.press("Shift+Enter");
  await app.keyboard.press("F3");
  await expect(widget.locator(".cm-find-count")).toHaveText("2 of 40");
  await app.keyboard.type("zzz");
  await expect(widget.locator(".cm-find-count")).toHaveText("No results");

  await app.keyboard.press("Escape");
  await expect(widget).toHaveCount(0);
  await expect(editor(app)).toBeFocused();

  // Escape from the editor with the widget open closes it too.
  await app.keyboard.press("Control+f");
  await expect(widget).toBeVisible();
  await editor(app).click();
  await app.keyboard.press("Escape");
  await expect(widget).toHaveCount(0);
});

test("Ctrl+H shows the replace row and replace all edits the document", async ({ app }) => {
  await setDocument(app, "one two one two one");
  await app.keyboard.press("Control+h");
  const widget = app.locator(".cm-find");
  await expect(widget.locator("input[name=replace]")).toBeVisible();
  await app.keyboard.type("one");
  await widget.locator("input[name=replace]").fill("1");
  await widget.locator("input[name=replace]").press("Control+Alt+Enter");
  await expect.poll(() => documentText(app)).toBe("1 two 1 two 1");
});

test("live mode hides markers away from the cursor and shows them at the cursor", async ({
  app,
}) => {
  await setDocument(app, "plain line\n\nsome **bold** text\n");
  await app.keyboard.press("Alt+m"); // Source to live.
  await expect(app.locator(".status-bar, footer")).toContainText("Live");
  const bold = app.locator(".cm-line", { hasText: "some" });

  await app.keyboard.press("Control+Home");
  await expect(bold).toHaveText("some bold text");

  await app.keyboard.press("Control+End");
  await app.keyboard.press("ArrowUp");
  await app.keyboard.press("End");
  for (let i = 0; i < 8; i++) await app.keyboard.press("ArrowLeft"); // Into the bold word.
  await expect(bold).toHaveText("some **bold** text");
});

test("Tab moves to the next table cell, and Ctrl+Enter leaves the table", async ({ app }) => {
  await setDocument(app, "| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  await app.keyboard.press("Control+Home");
  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("Tab");
  await app.keyboard.type("X");
  expect(await documentText(app)).toContain("| a   | X   |");

  await app.keyboard.press("Control+Enter");
  await app.keyboard.type("after");
  const lines = (await documentText(app)).split("\n");
  expect(lines.at(-1)).toBe("after");
  expect(lines.filter((line) => line.startsWith("|"))).toHaveLength(3);
});

test("Ctrl+Enter still toggles a task, and falls through elsewhere", async ({ app }) => {
  await setDocument(app, "- [ ] job");
  await app.keyboard.press("Control+Enter");
  expect(await documentText(app)).toBe("- [x] job");
  await setDocument(app, "plain");
  await app.keyboard.press("Control+Enter");
  expect((await documentText(app)).split("\n")).toEqual(["plain", ""]);
});

test("the menu bar opens by click and by keyboard", async ({ app }) => {
  await app.getByRole("menuitem", { name: "File", exact: true }).click();
  const file = app.getByRole("menu", { name: "File" });
  await expect(file).toBeVisible();
  await expect(file.getByRole("menuitem", { name: /^New file/ })).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(file).toBeHidden();

  await editor(app).click();
  await app.keyboard.press("F10");
  await expect(app.getByRole("menuitem", { name: "File", exact: true })).toBeFocused();
  await app.keyboard.press("ArrowDown");
  await expect(file).toBeVisible();
  await expect(file.getByRole("menuitem", { name: /^New file/ })).toBeFocused();
  await app.keyboard.press("Escape"); // Closes the menu, keeping focus on the bar.
  await expect(app.getByRole("menuitem", { name: "File", exact: true })).toBeFocused();
  await app.keyboard.press("Escape"); // Leaves the bar for the editor.
  await expect(editor(app)).toBeFocused();
});

test("closing a dirty tab asks first", async ({ app }) => {
  await editor(app).click();
  await app.keyboard.type("change");
  await app.getByRole("button", { name: "Close welcome.md" }).click();
  const dialog = app.getByRole("alertdialog");
  await expect(dialog).toContainText("Save changes to welcome.md?");
  await app.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(app.getByRole("tab", { name: /welcome\.md/ })).toBeVisible();
});

test("the ribbon's Bold button wraps the selection and keeps focus in the editor", async ({
  app,
}) => {
  await setDocument(app, "make this bold");
  await app.keyboard.press("Home");
  await app.keyboard.press("Shift+End");
  const ribbon = app.getByRole("toolbar", { name: "Formatting" });
  await ribbon.getByRole("button", { name: "Bold" }).click();
  expect(await documentText(app)).toBe("**make this bold**");
  await expect(editor(app)).toBeFocused();
  await expect(ribbon.getByRole("button", { name: "Bold" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the ribbon's table group appears only when the cursor is in a table", async ({ app }) => {
  await setDocument(app, "Plain line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
  const tableGroup = app
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("group", { name: "Table" });
  await app.locator(".cm-line", { hasText: "Plain line" }).click();
  await expect(tableGroup).toHaveCount(0);
  await app.locator(".cm-line", { hasText: "| 1" }).click();
  await expect(tableGroup).toBeVisible();
  await expect(tableGroup.getByRole("button", { name: "Format table" })).toBeVisible();
  await app.locator(".cm-line", { hasText: "Plain line" }).click();
  await expect(tableGroup).toHaveCount(0);
});
