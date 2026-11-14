import type { Page } from "@playwright/test";
import { documentText, editor, expect, openFile, test } from "./fixtures";

const problems = (page: Page) => page.getByRole("button", { name: /problem|Checking/i });
const selection = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test("a .json file with a syntax error shows a marker, F8 finds it and Format document works once it is fixed", async ({
  app,
}) => {
  await openFile(app, "/demo/data.json", '{"name":"demo","tags":["a","b"],,"n":1}');
  await expect(editor(app)).toContainText('"name"');

  // The marker and the squiggle appear after the check, and the status item counts one problem.
  await expect(app.locator(".cm-lint-marker-error")).toBeVisible();
  await expect(app.locator(".cm-lintRange-error")).toBeVisible();
  await expect(problems(app)).toHaveText("1 problem");

  // Format document declines text it cannot read: nothing changes.
  await app.getByRole("button", { name: /Format document/ }).click();
  expect(await documentText(app)).toBe('{"name":"demo","tags":["a","b"],,"n":1}');

  // F8 selects the problem.
  await editor(app).click();
  await app.keyboard.press("Control+Home");
  await app.keyboard.press("F8");
  await expect.poll(() => selection(app)).toBe(",");

  // Fixing it removes the marker and the count says so. The selected comma is the extra one.
  await app.keyboard.press("Delete");
  await expect(app.locator(".cm-lint-marker-error")).toHaveCount(0);
  await expect(problems(app)).toHaveText("No problems");

  // Format document, from the key, indents the text in one step.
  await app.keyboard.press("Shift+Alt+F");
  await expect
    .poll(() => documentText(app))
    .toBe('{\n  "name": "demo",\n  "tags": [\n    "a",\n    "b"\n  ],\n  "n": 1\n}');
  await expect(problems(app)).toHaveText("No problems");

  // And Undo takes it back in one step.
  await app.keyboard.press("Control+z");
  await expect.poll(() => documentText(app)).toBe('{"name":"demo","tags":["a","b"],"n":1}');
});

test("Minify is on the toolbar and keeps numbers and escapes exactly", async ({ app }) => {
  const text = '{\n  "big": 12345678901234567890,\n  "e": 1e400,\n  "s": "\\u00e9"\n}\n';
  await openFile(app, "/demo/numbers.json", text);
  await expect(editor(app)).toContainText("12345678901234567890");
  await app.getByRole("button", { name: /^Minify/ }).click();
  await expect
    .poll(() => documentText(app))
    .toBe('{"big":12345678901234567890,"e":1e400,"s":"\\u00e9"}\n');
  await expect(problems(app)).toHaveText("No problems");
});

test("a .jsonc file with comments shows no problems and formatting keeps the comments", async ({
  app,
}) => {
  const text = '// settings\n{"a":1, /* one */ "b":[1,2]} // end\n';
  await openFile(app, "/demo/tsconfig.jsonc", text);
  await expect(editor(app)).toContainText("settings");
  await expect(problems(app)).toHaveText("No problems");
  await expect(app.locator(".cm-lint-marker")).toHaveCount(0);
  await app.keyboard.press("Shift+Alt+F");
  await expect.poll(() => documentText(app)).toContain('"a": 1, /* one */');
  const out = await documentText(app);
  expect(out.startsWith("// settings\n{")).toBe(true);
  expect(out).toContain("} // end");
});

test("a valid .yaml file shows no problems; a duplicate key does", async ({ app }) => {
  await openFile(app, "/demo/config.yaml", "name: demo\nitems:\n  - one\n  - two\n");
  await expect(editor(app)).toContainText("items");
  await expect(problems(app)).toHaveText("No problems");
  await expect(app.locator(".cm-lint-marker")).toHaveCount(0);

  await openFile(app, "/demo/bad.yml", "name: a\nsize: 1\nname: b\n");
  await expect(app.locator(".cm-lint-marker-error")).toBeVisible();
  await expect(problems(app)).toHaveText("1 problem");
});

test("Tab indents with spaces in YAML, and Escape then Tab leaves the editor", async ({ app }) => {
  await openFile(app, "/demo/tab.yaml", "a:\n  b: 1\n");
  await expect(editor(app)).toContainText("b: 1");
  await editor(app).click();
  await app.keyboard.press("Control+End");
  await app.keyboard.press("ArrowUp");
  await app.keyboard.press("Tab");
  expect(await documentText(app)).toBe("a:\n    b: 1\n");

  await app.keyboard.press("Escape");
  await app.keyboard.press("Tab");
  const inEditor = await app.evaluate(() => !!document.activeElement?.closest(".cm-editor"));
  expect(inEditor).toBe(false);
});

test("the problems panel opens from the status bar and from Ctrl+Shift+M", async ({ app }) => {
  await openFile(app, "/demo/panel.json", '{\n  "a": 1 "b"\n}\n');
  await expect(problems(app)).toHaveText("1 problem");
  await problems(app).click();
  await expect(app.getByRole("listbox", { name: "Diagnostics" })).toBeVisible();
  await expect(app.locator(".cm-diagnostic-error")).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(app.locator(".cm-panel-lint")).toHaveCount(0);
  await editor(app).click();
  await app.keyboard.press("Control+Shift+M");
  await expect(app.locator(".cm-panel-lint")).toBeVisible();
});

test("a Markdown document has no problem count", async ({ app }) => {
  await expect(editor(app)).toContainText("Welcome");
  await expect(problems(app)).toHaveCount(0);
});

test("a .json file with a comment shows a warning and no error, and Format document keeps the comment", async ({
  app,
}) => {
  const text = '// compiler options\n{"a":1,"b":[1,2,]}\n';
  await openFile(app, "/demo/tsconfig.json", text);
  await expect(editor(app)).toContainText("compiler options");
  await expect(app.locator(".cm-lint-marker-warning").first()).toBeVisible();
  await expect(app.locator(".cm-lintRange-warning").first()).toBeVisible();
  await expect(app.locator(".cm-lint-marker-error")).toHaveCount(0);
  await expect(app.locator(".cm-lintRange-error")).toHaveCount(0);
  await expect(problems(app)).toHaveText("2 warnings");

  await app.getByRole("button", { name: /Format document/ }).click();
  await expect
    .poll(() => documentText(app))
    .toBe('// compiler options\n{\n  "a": 1,\n  "b": [\n    1,\n    2,\n  ]\n}\n');
  await expect(problems(app)).toHaveText("2 warnings");
});
