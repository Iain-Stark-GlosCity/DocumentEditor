import type { Page } from "@playwright/test";
import { documentText, editor, expect, openFile, test } from "./fixtures";

const problems = (page: Page) => page.getByRole("button", { name: /problem|Checking/i });

test("an .xml file with an error shows a marker and a count; Tidy reformats once it is fixed", async ({
  app,
}) => {
  await openFile(app, "/demo/a.xml", "<root><item>one</item><item>two</oops></root>");
  await expect(editor(app)).toContainText("<root>");
  await expect(app.locator(".cm-lint-marker-error")).toBeVisible();
  await expect(app.locator(".cm-lintRange-error")).toBeVisible();
  await expect(problems(app)).toHaveText("1 problem");

  // Tidy declines text that is not well-formed.
  await app.getByRole("button", { name: /^Tidy/ }).click();
  expect(await documentText(app)).toBe("<root><item>one</item><item>two</oops></root>");

  // Fix it: change "oops" to "item".
  await editor(app).click();
  await app.keyboard.press("Control+End");
  for (let i = 0; i < "</root>".length + ">".length; i++) await app.keyboard.press("ArrowLeft");
  for (let i = 0; i < 4; i++) await app.keyboard.press("Backspace");
  await app.keyboard.type("item");
  await expect(app.locator(".cm-lint-marker-error")).toHaveCount(0);
  await expect(problems(app)).toHaveText("No problems");

  // Tidy, from the key, then Undo takes it back in one step.
  await app.keyboard.press("Shift+Alt+F");
  await expect
    .poll(() => documentText(app))
    .toBe("<root>\n  <item>one</item>\n  <item>two</item>\n</root>");
  await app.keyboard.press("Control+z");
  await expect.poll(() => documentText(app)).toBe("<root><item>one</item><item>two</item></root>");
});

test("Tidy on the toolbar reformats a one-line document and leaves text alone", async ({ app }) => {
  await openFile(
    app,
    "/demo/doc.xml",
    '<?xml version="1.0"?><w:p xmlns:w="u"><w:r><w:t xml:space="preserve"> a  b </w:t></w:r><w:r><w:t>x <b/> y</w:t></w:r></w:p>',
  );
  await expect(problems(app)).toHaveText("No problems");
  await app.getByRole("button", { name: /^Tidy/ }).click();
  await expect
    .poll(() => documentText(app))
    .toBe(
      '<?xml version="1.0"?>\n<w:p xmlns:w="u">\n  <w:r>\n    <w:t xml:space="preserve"> a  b </w:t>\n  </w:r>\n  <w:r>\n    <w:t>x <b/> y</w:t>\n  </w:r>\n</w:p>',
    );
});

test("a billion laughs document is refused quickly and the app stays responsive", async ({
  app,
}) => {
  const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((n) => `<!ENTITY lol${n} "${`&lol${n === 1 ? "" : n - 1};`.repeat(10)}">`)
    .join("");
  const text = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${levels}]><lolz>&lol9;</lolz>`;
  await openFile(app, "/demo/laughs.xml", text);
  await expect(app.locator(".cm-lint-marker-error")).toBeVisible();
  await expect(problems(app)).toHaveText("1 problem");
  await editor(app).click();
  await app.keyboard.type(" ");
});

test("a large entity used many times is not expanded", async ({ app }) => {
  const text = `<!DOCTYPE l [<!ENTITY x "${"a".repeat(10_000)}">]><l>${"&x;".repeat(10_000)}</l>`;
  await openFile(app, "/demo/big.xml", text);
  await expect(app.locator(".cm-lint-marker-warning")).toBeVisible();
  await expect(problems(app)).toHaveText("1 problem");
});

test("a very long line offers Tidy, which splits it quickly", async ({ app }) => {
  const text = `<?xml version="1.0"?><r>${"<i><j>x</j></i>".repeat(70_000)}</r>`;
  await openFile(app, "/demo/long.xml", text);
  await expect(app.getByText(/has a very long line/)).toBeVisible();
  await app.getByRole("button", { name: "Tidy", exact: true }).first().click();
  await expect.poll(async () => (await documentText(app)).split("\n").length).toBeGreaterThan(5);
});

test("a document over 5 MB is too large to check", async ({ app }) => {
  const text = `<r>${"<i>x</i>\n".repeat(700_000)}</r>`;
  expect(text.length).toBeGreaterThan(5_000_000);
  await openFile(app, "/demo/huge.xml", text);
  await expect(problems(app)).toHaveText("Too large to check", { timeout: 20_000 });
});
