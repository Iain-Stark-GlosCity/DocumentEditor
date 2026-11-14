/**
 * The one place that decides which format providers the app ships with. The main thread and the
 * preview's render worker both call it, so they always agree on what a provider id means. It lives
 * outside `src/workbench/` and `src/formats/`: the workbench asks for a registry rather than
 * importing a format (CLAUDE.md rule 4).
 */
import { FormatRegistry } from "./core/registry";
import { markdownProvider } from "./formats/markdown";
import { plainTextProvider } from "./formats/plain-text";
import { htmlProvider } from "./formats/html";

export function createRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  // A new document starts as Markdown; a file nobody claims opens as plain text.
  registry.register(markdownProvider, { default: true });
  registry.register(plainTextProvider, { fallback: true });
  registry.register(htmlProvider);
  return registry;
}
