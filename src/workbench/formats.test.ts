import { describe, expect, it } from "vitest";
import { createRegistry } from "../create-registry";
import { MemoryPlatform } from "../platform/memory";
import { defaultFeatures } from "./features";
import { Workbench } from "./workbench";

async function start(files: Record<string, string> = {}) {
  const platform = new MemoryPlatform();
  for (const [path, text] of Object.entries(files)) platform.seedFile(path, text);
  const workbench = new Workbench({
    platform,
    registry: createRegistry(),
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  workbench.start();
  await workbench.ready;
  return { workbench, platform };
}

const providerOf = (workbench: Workbench) => workbench.activeDocument()?.providerId;

describe("choosing a format", () => {
  it("starts a new, unsaved document as Markdown", async () => {
    const { workbench } = await start();
    expect(providerOf(workbench)).toBe("markdown");
    workbench.newFile();
    expect(providerOf(workbench)).toBe("markdown");
    workbench.dispose();
  });

  it("opens a Markdown file as Markdown and a .txt file as plain text", async () => {
    const { workbench } = await start({ "C:\\a\\note.md": "# hi\n", "C:\\a\\todo.txt": "milk\n" });
    await workbench.openPaths(["C:\\a\\note.md"]);
    expect(providerOf(workbench)).toBe("markdown");
    await workbench.openPaths(["C:\\a\\todo.txt"]);
    expect(providerOf(workbench)).toBe("text");
    workbench.dispose();
  });

  it("opens a file nobody claims as plain text, never as Markdown", async () => {
    const { workbench } = await start({
      "C:\\a\\settings.cfg": "a=1\n",
      "C:\\a\\Makefile": "all:\n",
    });
    await workbench.openPaths(["C:\\a\\settings.cfg"]);
    expect(providerOf(workbench)).toBe("text");
    await workbench.openPaths(["C:\\a\\Makefile"]);
    expect(providerOf(workbench)).toBe("text");
    workbench.dispose();
  });
});

describe("file dialog filters", () => {
  it("offers every supported file at once for Open, then each format, then everything", async () => {
    const { workbench } = await start();
    const filters = workbench.fileFilters();
    expect(filters[0]?.name).toBe("All supported files");
    expect(filters[0]?.extensions).toEqual(expect.arrayContaining(["md", "txt"]));
    expect(filters.map((f) => f.name)).toEqual(expect.arrayContaining(["Markdown", "Plain text"]));
    expect(filters.at(-1)).toEqual({ name: "All files", extensions: ["*"] });
    workbench.dispose();
  });

  it("lists the document's own format first for Save, so its extension is the default", async () => {
    const { workbench } = await start();
    const filters = workbench.fileFilters("text");
    expect(filters[0]?.name).toBe("Plain text");
    expect(filters.some((f) => f.name === "All supported files")).toBe(false);
    workbench.dispose();
  });
});
