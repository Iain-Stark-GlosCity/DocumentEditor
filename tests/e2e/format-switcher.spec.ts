import { editor, expect, test } from "./fixtures";

const ribbon = (page: import("@playwright/test").Page) =>
  page.getByRole("toolbar", { name: "Formatting" });

test("the format button changes the document's format and back", async ({ app }) => {
  await expect(ribbon(app)).toBeVisible();
  const button = app.getByRole("button", { name: /^Format:/ });
  await expect(button).toHaveText("Markdown");

  await button.click();
  const dialog = app.getByRole("dialog", { name: "Change format" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Markdown/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.getByRole("option", { name: /Plain text/ }).click();

  await expect(dialog).toBeHidden();
  await expect(button).toHaveText("Plain text");
  await expect(ribbon(app)).toBeHidden();
  // Focus is back in the editor, so typing goes straight into the document.
  await expect(editor(app)).toBeFocused();

  // Filter by typing, then Enter.
  await button.click();
  await app.getByRole("combobox", { name: "Choose a format" }).fill("mark");
  await app.keyboard.press("Enter");
  await expect(button).toHaveText("Markdown");
  await expect(ribbon(app)).toBeVisible();
});

test("Escape closes the picker without changing the format", async ({ app }) => {
  await app.getByRole("button", { name: /^Format:/ }).click();
  await app.keyboard.press("Escape");
  await expect(app.getByRole("dialog", { name: "Change format" })).toBeHidden();
  await expect(app.getByRole("button", { name: /^Format:/ })).toHaveText("Markdown");
  await expect(editor(app)).toBeFocused();
});
