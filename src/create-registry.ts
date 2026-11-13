/**
 * The one place that decides which format providers the app ships with. The main thread and the
 * preview's render worker both call it, so they always agree on what a provider id means. It lives
 * outside `src/workbench/` and `src/formats/`: the workbench asks for a registry rather than
 * importing a format (CLAUDE.md rule 4).
 */
import { FormatRegistry } from "./core/registry";
import { markdownProvider } from "./formats/markdown";

export function createRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(markdownProvider);
  return registry;
}
