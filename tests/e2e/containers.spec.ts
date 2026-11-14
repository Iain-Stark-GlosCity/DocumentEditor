import { unzipSync, zipSync } from "fflate";
import type { Page } from "@playwright/test";
import { editor, expect, setDocument, test } from "./fixtures";

const CONTAINER = "/demo/report.docx";
const DOC =
  '<?xml version="1.0"?>\n<w:document xmlns:w="urn:w"><w:body>Hello</w:body></w:document>\n';
const NOTES = "just some notes\n";
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function archive(): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": enc("<Types/>"),
      "word/document.xml": enc(DOC),
      "word/notes.txt": enc(NOTES),
      "word/media/image1.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]),
    },
    { mtime: new Date(2020, 0, 1) },
  );
}

/** Makes `.docx` a zip container (the real DOCX format arrives separately), seeds the file, opens a part. */
async function openPart(page: Page, bytes: Uint8Array, part: string): Promise<void> {
  await page.evaluate(
    ({ path, bytes, part }) => {
      const platform = window.__demoPlatform;
      const registry = window.__demoRegistry;
      if (!platform || !registry) throw new Error("This is not the browser-only build");
      if (!registry.forPath(path)?.binary) {
        registry.register({
          kind: "text",
          id: "test-zip",
          name: "Test zip container",
          fileExtensions: ["docx"],
          viewModes: ["source"],
          readOnly: true,
          binary: { archive: "zip", decode: async () => "formatting view" },
          editorExtensions: () => [],
        });
      }
      platform.seedBinary(path, bytes);
      platform.requestOpen([`${path}!/${part}`]);
    },
    { path: CONTAINER, bytes: Array.from(bytes), part },
  );
  await page.getByRole("tab", { name: new RegExp(part.split("/").pop() ?? part) }).waitFor();
}

async function containerOnDisk(page: Page): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    (path) => Array.from(window.__demoPlatform?.binaryFiles.get(path) ?? []),
    CONTAINER,
  );
  return Uint8Array.from(bytes);
}

test("saving a part rewrites that part only and leaves a one-off backup", async ({ app }) => {
  const original = archive();
  await openPart(app, original, "word/document.xml");
  await expect(editor(app)).toContainText("Hello");

  const edited = '<w:document xmlns:w="urn:w"><w:body>Edited</w:body></w:document>\n';
  await setDocument(app, edited);
  await app.keyboard.press("Control+s");

  await expect
    .poll(async () =>
      dec(unzipSync(await containerOnDisk(app))["word/document.xml"] ?? new Uint8Array()),
    )
    .toBe(edited);

  const before = unzipSync(original);
  const after = unzipSync(await containerOnDisk(app));
  expect(Object.keys(after)).toEqual(Object.keys(before));
  for (const name of Object.keys(before)) {
    if (name === "word/document.xml") continue;
    expect(Array.from(after[name] ?? []), name).toEqual(Array.from(before[name] ?? []));
  }

  const backup = await app.evaluate(
    (path) => Array.from(window.__demoPlatform?.binaryFiles.get(`${path}.bak`) ?? []),
    CONTAINER,
  );
  expect(Uint8Array.from(backup)).toEqual(original);
});

test("ill-formed XML is refused with a visible error and the archive is unchanged", async ({
  app,
  problems,
}) => {
  const original = archive();
  await openPart(app, original, "word/document.xml");
  await setDocument(app, "<a>\n  <b></a>");
  await app.keyboard.press("Control+s");

  await expect(app.getByText(/word\/document\.xml is not well-formed XML/)).toBeVisible();
  expect(await containerOnDisk(app)).toEqual(original);
  const hasBackup = await app.evaluate(
    (path) => window.__demoPlatform?.binaryFiles.has(`${path}.bak`) ?? false,
    CONTAINER,
  );
  expect(hasBackup).toBe(false);
  // The refusal is reported to the user, not as a console error; nothing else went wrong.
  expect(problems.list).toEqual([]);
});

test("a non-XML text part saves whatever it contains", async ({ app }) => {
  await openPart(app, archive(), "word/notes.txt");
  await setDocument(app, "<not xml\n");
  await app.keyboard.press("Control+s");
  await expect
    .poll(async () =>
      dec(unzipSync(await containerOnDisk(app))["word/notes.txt"] ?? new Uint8Array()),
    )
    .toBe("<not xml\n");
});
