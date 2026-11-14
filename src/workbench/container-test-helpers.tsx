/**
 * Shared setup for the read-only and Parts pane tests: fake formats (a view-only `.docx` view,
 * Markdown, XML, plain text) and a fake `ContainerAccess` attached to a MemoryPlatform. Not part
 * of the app; the real DOCX format and archive layer live elsewhere.
 */
import { act, render } from "@testing-library/react";
import { splitContainerPath } from "../core/container-path";
import type { TextFormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { MemoryPlatform } from "../platform/memory";
import type { ContainerAccess, ContainerPart } from "../platform/platform";
import { App } from "./App";
import { defaultFeatures } from "./features";
import { Workbench } from "./workbench";

export const DOCX = "C:\\docs\\report.docx";
export const DOCUMENT_XML = `${DOCX}!/word/document.xml`;
export const VIEW_TEXT = "Heading\n=======\n\nA generated view.\n";

const base = {
  kind: "text",
  viewModes: ["source"],
  editorExtensions: () => [],
} as const;

export const markdownFake: TextFormatProvider = {
  ...base,
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md"],
};

export const textFake: TextFormatProvider = {
  ...base,
  id: "text",
  name: "Plain text",
  fileExtensions: ["txt"],
};

export const xmlFake: TextFormatProvider = {
  ...base,
  id: "xml",
  name: "XML",
  fileExtensions: ["xml", "rels"],
  spellcheck: false,
};

/** A generated, view-only format for a binary archive, like the real DOCX Formatting view. */
export const docxViewFake: TextFormatProvider = {
  ...base,
  id: "docx-view",
  name: "Word document (formatting view)",
  fileExtensions: ["docx"],
  readOnly: true,
  binary: { archive: "zip", decode: () => Promise.resolve(VIEW_TEXT) },
};

export function fakeRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(markdownFake, { default: true });
  registry.register(docxViewFake);
  registry.register(xmlFake);
  registry.register(textFake, { fallback: true });
  return registry;
}

export const PARTS: ContainerPart[] = [
  { name: "[Content_Types].xml", size: 1200, text: true },
  { name: "word/document.xml", size: 45_000, text: true },
  { name: "_rels/.rels", size: 300, text: true },
  { name: "word/media/image1.png", size: 2_500_000, text: false },
  { name: "word/_rels/document.xml.rels", size: 900, text: true },
];

export interface FakeContainers extends ContainerAccess {
  /** What `listParts` returns next; an Error makes it reject. */
  result: ContainerPart[] | Error;
  readonly listed: string[];
}

/** Every `.docx` is a container, and so is every path inside one. */
export function fakeContainers(parts: ContainerPart[] = PARTS): FakeContainers {
  const fake: FakeContainers = {
    result: parts,
    listed: [],
    containerOf(path) {
      const split = splitContainerPath(path);
      if (split) return split.container;
      return path.toLowerCase().endsWith(".docx") ? path : null;
    },
    listParts(container) {
      fake.listed.push(container);
      const result = fake.result;
      return result instanceof Error ? Promise.reject(result) : Promise.resolve([...result]);
    },
  };
  return fake;
}

export interface Setup {
  platform: MemoryPlatform;
  workbench: Workbench;
  containers: FakeContainers;
}

export async function setupContainers(
  options: { open?: string[]; containers?: boolean; parts?: ContainerPart[] } = {},
): Promise<Setup> {
  const platform = new MemoryPlatform();
  // What the platform would hand back for a binary view: the decoded text.
  platform.seedFile(DOCX, VIEW_TEXT);
  platform.seedFile(DOCUMENT_XML, "<w:document><w:body/></w:document>\n");
  platform.seedFile(`${DOCX}!/[Content_Types].xml`, "<Types/>\n");
  platform.seedFile("C:\\docs\\note.md", "# Note\n");
  const containers = fakeContainers(options.parts);
  if (options.containers !== false) {
    (platform as { containers?: ContainerAccess }).containers = containers;
  }
  const workbench = new Workbench({
    platform,
    registry: fakeRegistry(),
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await act(async () => {
    await workbench.ready;
    await workbench.openPaths(options.open ?? [DOCX]);
  });
  return { platform, workbench, containers };
}
