import { documentText, expect, openFile, test } from "./fixtures";

const CSV = [
  "name,qty,note",
  "Widget,12,plain",
  '"Gadget, large",7,"first line',
  'second line"',
  "<script>x</script>,3,=cmd|' /C calc'!A0",
  "",
].join("\n");

test("a .csv file shows a table in the split preview", async ({ app }) => {
  await openFile(app, "/demo/stock.csv", CSV);
  await app.keyboard.press("Alt+p");

  const table = app.locator(".preview-content table.csv-table");
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveText(["#", "name", "qty", "note"]);

  const rows = table.locator("tbody tr");
  // The quoted line break keeps "Gadget" in one row: three data rows, not four.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("td")).toHaveText(["Widget", "12", "plain"]);
  await expect(rows.nth(1).locator("td").nth(0)).toHaveText("Gadget, large");
  await expect(rows.nth(1).locator("td").nth(2)).toHaveText("first line\nsecond line");
  await expect(rows.nth(1)).toHaveAttribute("data-line", "3");
  await expect(rows.nth(2)).toHaveAttribute("data-line", "5");

  // Cell text stays text: nothing was injected, and the formula is just characters.
  await expect(app.locator(".preview-content script")).toHaveCount(0);
  await expect(rows.nth(2).locator("td").nth(0)).toHaveText("<script>x</script>");
  await expect(rows.nth(2).locator("td").nth(2)).toHaveText("=cmd|' /C calc'!A0");

  // The numeric column is right-aligned.
  await expect(rows.nth(0).locator("td").nth(1)).toHaveCSS("text-align", "right");
  // The file itself is untouched.
  expect(await documentText(app)).toBe(CSV);
});

test("source mode colours the columns and Tab still moves focus on", async ({ app }) => {
  await openFile(app, "/demo/colours.csv", "a,b,c\n1,2,3\n");
  await expect(app.locator(".cm-csv-c0").first()).toHaveText("a");
  await expect(app.locator(".cm-csv-c1").first()).toHaveText("b");
  await expect(app.locator(".cm-csv-delim").first()).toHaveText(",");

  await app.locator(".cm-content").click();
  await app.keyboard.press("Tab");
  // Tab inserted nothing and did not trap focus: it moved on out of the editor.
  expect(await documentText(app)).toBe("a,b,c\n1,2,3\n");
  await expect(app.locator(".cm-content")).not.toBeFocused();
});

test("cycling the delimiter re-reads the file", async ({ app }) => {
  await openFile(app, "/demo/semi.csv", "a;b\n1;2\n");
  await app.keyboard.press("Alt+p");
  const heads = app.locator(".preview-content table.csv-table thead th");
  // Detected automatically as semicolons.
  await expect(heads).toHaveText(["#", "a", "b"]);

  // Palette: run "Cycle CSV delimiter" (auto becomes comma, so the file is one column).
  await app.keyboard.press("Control+Shift+p");
  await app.keyboard.type("Cycle CSV delimiter");
  await app.keyboard.press("Enter");
  await expect(heads).toHaveText(["#", "a;b"]);
});
