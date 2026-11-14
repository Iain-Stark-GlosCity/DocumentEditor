import { expect, openFile, test } from "./fixtures";

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=https://evil.example/">
  <title>A test page</title>
  <style>h1 { color: rgb(255, 0, 0); } body { background: rgb(0, 0, 255); }</style>
  <script>window.__pwned = "head script";</script>
</head>
<body onload="window.__pwned = 'onload'">
  <h1 style="font-size: 99px">Main heading</h1>
  <p>Some <b>bold</b> text and <a href="javascript:window.__pwned = 'link'">a bad link</a>.</p>
  <h2>Second <em>level</em> heading</h2>
  <table>
    <thead><tr><th>Name</th><th>Value</th></tr></thead>
    <tbody><tr><td>alpha</td><td>1</td></tr></tbody>
  </table>
  <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" alt="dot" onerror="window.__pwned = 'onerror'">
  <noscript><p title="</noscript><img src=x onerror=window.__pwned='mxss'>"></noscript>
  <svg onload="window.__pwned = 'svg'"><script>window.__pwned = 'svg script'</script></svg>
  <script>window.__pwned = "body script";</script>
  <h3>Third heading</h3>
</body>
</html>
`;

test("an HTML file opens with a safe preview and an outline", async ({ app }) => {
  await openFile(app, "/demo/page.html", PAGE);
  await expect(app.locator(".cm-content")).toContainText("Main heading");

  // Split view: the preview shows the headings and the table, with the note first.
  await app.keyboard.press("Alt+p");
  const preview = app.locator(".preview-scroll");
  await expect(preview.getByRole("heading", { name: "Main heading" })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Second level heading" })).toBeVisible();
  await expect(preview.locator("table td", { hasText: "alpha" })).toBeVisible();
  await expect(preview.locator(".html-preview-note")).toHaveText(
    "Simplified preview: styles and scripts are not shown",
  );
  await expect(app.getByText("Preview not updated")).toHaveCount(0);

  // Nothing the author wrote ran, applied or was kept.
  expect(await app.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBe(
    undefined,
  );
  const heading = preview.getByRole("heading", { name: "Main heading" });
  expect(await heading.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgb(255, 0, 0)");
  expect(await heading.evaluate((el) => el.getAttribute("style"))).toBeNull();
  await expect(preview.locator("script, style, link, meta, svg, noscript, iframe")).toHaveCount(0);
  await expect(preview.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(preview.locator("[onerror], [onload]")).toHaveCount(0);

  // Blocks carry their source line, for scroll sync.
  await expect(heading).toHaveAttribute("data-line", "11");

  // The outline lists the headings, with inline markup removed.
  await app.keyboard.press("Control+Shift+o");
  const tree = app.getByRole("tree", { name: "Document outline" });
  await expect(tree.getByRole("treeitem")).toHaveText([
    /Main heading/,
    /Second level heading/,
    /Third heading/,
  ]);
});

test("editing the source updates the preview and still runs nothing", async ({ app }) => {
  await openFile(app, "/demo/live.htm", "<h1>First</h1>\n");
  await app.keyboard.press("Alt+p");
  const preview = app.locator(".preview-scroll");
  await expect(preview.getByRole("heading", { name: "First" })).toBeVisible();

  await app.locator(".cm-content").click();
  await app.keyboard.press("Control+End");
  await app.keyboard.insertText("<script>window.__pwned = 'typed'</script><h2>Second</h2>\n");
  await expect(preview.getByRole("heading", { name: "Second" })).toBeVisible();
  expect(await app.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBe(
    undefined,
  );
});

test("Tab indents by two spaces; Escape then Tab leaves the editor", async ({ app }) => {
  await openFile(app, "/demo/indent.html", "<div>\n<p>x</p>\n</div>\n");
  await app.locator(".cm-content").click();
  await app.keyboard.press("Control+Home");
  await app.keyboard.press("ArrowDown");
  await app.keyboard.press("Tab");
  await expect(app.locator(".cm-line").nth(1)).toHaveText("  <p>x</p>");
  await app.keyboard.press("Shift+Tab");
  await expect(app.locator(".cm-line").nth(1)).toHaveText("<p>x</p>");

  await app.keyboard.press("Escape");
  await app.keyboard.press("Tab");
  await expect(app.locator(".cm-content")).not.toBeFocused();
});
