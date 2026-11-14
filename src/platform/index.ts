import type { FormatRegistry } from "../core/registry";
import { ContainerPlatform } from "./containers";
import { MemoryPlatform } from "./memory";
import type { Platform } from "./platform";
import { TauriPlatform } from "./tauri";

const SAMPLE_PATH = "/demo/welcome.md";

const SAMPLE_TEXT = `# Welcome

This is a sample Markdown file, shown because the app is running in a plain browser.

- Edit this text.
- Save with Ctrl+S. Nothing leaves the page: files live in memory.

## Tasks

- [x] Open a document
- [ ] Write something
`;

declare global {
  interface Window {
    /** The in-memory platform of the browser-only build, so browser tests can open other files. */
    __demoPlatform?: MemoryPlatform;
    /** The format registry of the browser-only build, so browser tests can register a test format. */
    __demoRegistry?: FormatRegistry;
  }
}

let cached: Platform | undefined;

function insideTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * TauriPlatform inside the desktop app, otherwise a MemoryPlatform seeded with a sample, either
 * wrapped in the ContainerPlatform so paths into container files (`report.docx!/word/document.xml`)
 * work. `window.__demoPlatform` stays the inner MemoryPlatform.
 */
export function getPlatform(registry: FormatRegistry): Platform {
  if (cached) return cached;
  if (insideTauri()) {
    cached = new ContainerPlatform(new TauriPlatform(), registry);
  } else {
    const memory = new MemoryPlatform();
    memory.seedFile(SAMPLE_PATH, SAMPLE_TEXT, {
      encoding: "utf-8",
      bom: false,
      eol: "lf",
      mixedEol: false,
    });
    memory.requestOpen([SAMPLE_PATH]);
    // Only the browser-only build has this; the desktop app never sets it.
    if (typeof window !== "undefined") {
      window.__demoPlatform = memory;
      window.__demoRegistry = registry;
    }
    cached = new ContainerPlatform(memory, registry);
  }
  return cached;
}
