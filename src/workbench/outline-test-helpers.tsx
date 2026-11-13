/** Shared setup for the outline, side pane and focus mode tests. Not part of the app. */
import type { EditorState } from "@codemirror/state";
import { act, render } from "@testing-library/react";
import type { OutlineItem, TextFormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { MemoryPlatform } from "../platform/memory";
import { App } from "./App";
import { defaultFeatures } from "./features";
import { Workbench } from "./workbench";

/** A line-based outline: every line that starts with one to six `#` and a space. */
export function lineOutline(state: EditorState): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const match = /^(#{1,6}) (.*)$/.exec(line.text);
    if (match) {
      items.push({ level: match[1]?.length ?? 1, text: match[2] ?? "", line: n, from: line.from });
    }
  }
  return items;
}

export const outlineProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md"],
  viewModes: ["source", "split"],
  editorExtensions: () => [],
  render: (text) => Promise.resolve({ html: `<p data-line="1">${text.length}</p>` }),
  outline: lineOutline,
};

export const NOTE = "C:\\docs\\note.md";

export const SAMPLE = [
  "# Alpha",
  "",
  "Intro text.",
  "",
  "## Beta",
  "",
  "Beta text.",
  "",
  "### Gamma",
  "",
  "Gamma text.",
  "",
  "## Delta",
  "",
  "Delta text.",
  "",
  "# Epsilon",
  "",
  "Last.",
  "",
].join("\n");

export async function setupOutline(text = SAMPLE, provider: TextFormatProvider = outlineProvider) {
  const platform = new MemoryPlatform();
  platform.seedFile(NOTE, text);
  const registry = new FormatRegistry();
  registry.register(provider);
  const workbench = new Workbench({
    platform,
    registry,
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  const result = render(<App workbench={workbench} />);
  await act(async () => {
    await workbench.ready;
    await workbench.openPaths([NOTE]);
  });
  return { platform, workbench, ...result };
}
