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

let cached: Platform | undefined;

function insideTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** TauriPlatform inside the desktop app, otherwise a MemoryPlatform seeded with a sample. */
export function getPlatform(): Platform {
  if (cached) return cached;
  if (insideTauri()) {
    cached = new TauriPlatform();
  } else {
    const memory = new MemoryPlatform();
    memory.seedFile(SAMPLE_PATH, SAMPLE_TEXT, {
      encoding: "utf-8",
      bom: false,
      eol: "lf",
      mixedEol: false,
    });
    memory.requestOpen([SAMPLE_PATH]);
    cached = memory;
  }
  return cached;
}
