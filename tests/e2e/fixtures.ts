import { expect, test as base, type Locator, type Page } from "@playwright/test";

/** Console errors, uncaught exceptions and CSP violations seen by the page. */
export interface Problems {
  list: string[];
}

export const test = base.extend<{ problems: Problems; app: Page }>({
  problems: async ({ page }, provide) => {
    const list: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        list.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => list.push(`pageerror: ${error.message}`));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await provide({ list });
    expect(list, "no console errors, exceptions or CSP violations").toEqual([]);
  },
  // The app, loaded, with the editor ready.
  app: async ({ page, problems }, provide) => {
    void problems;
    await page.goto("/");
    await page.locator(".cm-content").waitFor();
    await provide(page);
  },
});

export { expect };

export const editor = (page: Page): Locator => page.locator(".cm-content");

/** Replaces the whole document. `insertText` takes newlines literally, unlike typing them. */
export async function setDocument(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}

/** The document text, read from the editor's lines. */
export async function documentText(page: Page): Promise<string> {
  return page
    .locator(".cm-line")
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? "").join("\n"));
}

/**
 * Opens a file in the browser-only build, as if it had been passed to the app ("Open with"). The
 * in-memory platform there is exposed as `window.__demoPlatform` for exactly this.
 */
export async function openFile(page: Page, path: string, text: string): Promise<void> {
  await page.evaluate(
    ({ path, text }) => {
      const platform = window.__demoPlatform;
      if (!platform) throw new Error("This is not the browser-only build");
      platform.seedFile(path, text);
      platform.requestOpen([path]);
    },
    { path, text },
  );
  const name = path.split(/[\\/]/).pop() ?? path;
  await page
    .getByRole("tab", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
    .waitFor();
}
