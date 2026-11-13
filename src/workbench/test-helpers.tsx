/** Shared setup for workbench tests. Not part of the app. */
import { EditorView } from "@codemirror/view";
import { fireEvent, render } from "@testing-library/react";
import type { TextFormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { MemoryPlatform } from "../platform/memory";
import { App } from "./App";
import type { Feature } from "./feature";
import { defaultFeatures } from "./features";
import { Workbench } from "./workbench";

// A stub provider: the workbench must work with whatever the registry holds (rule 4).
export const stubProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md"],
  viewModes: ["source"],
  editorExtensions: () => [],
};

export function stubRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(stubProvider);
  return registry;
}

export function makeWorkbench(
  options: { platform?: MemoryPlatform; features?: readonly Feature[] } = {},
) {
  const platform = options.platform ?? new MemoryPlatform();
  const workbench = new Workbench({
    platform,
    registry: stubRegistry(),
    features: options.features ?? defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  return { platform, workbench };
}

export function renderApp(
  options: { platform?: MemoryPlatform; features?: readonly Feature[] } = {},
) {
  const { platform, workbench } = makeWorkbench(options);
  const result = render(<App workbench={workbench} />);
  return { platform, workbench, ...result };
}

/** Key press on the window, as a shortcut would arrive. */
export const pressKey = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ctrlKey: true, ...init });

export function editorView(): EditorView {
  const dom = document.querySelector<HTMLElement>(".cm-editor");
  if (!dom) throw new Error("No editor in the page");
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error("No EditorView for the editor element");
  return view;
}
