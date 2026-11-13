import { EditorSelection } from "@codemirror/state";
import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../../platform/memory";
import type { Workbench } from "../workbench";
import { editorView, renderApp } from "../test-helpers";

const TEXT = "one two three four";

afterEach(() => {
  vi.useRealTimers();
});

/** Opens a seeded file, or the empty untitled document, and waits for the tab. */
async function open(text?: string): Promise<{ workbench: Workbench; platform: MemoryPlatform }> {
  const platform = new MemoryPlatform();
  if (text !== undefined) platform.seedFile("/notes/a.md", text);
  const { workbench } = renderApp({ platform });
  if (text !== undefined) {
    act(() => platform.requestOpen(["/notes/a.md"]));
    await screen.findByRole("tab", { name: "a.md" });
  } else {
    await screen.findByRole("tab", { name: "Untitled-1" });
  }
  return { workbench, platform };
}

function setSelection(ranges: [number, number][]): void {
  act(() => {
    editorView().dispatch({
      selection: EditorSelection.create(
        ranges.map(([from, to]) => EditorSelection.range(from, to)),
      ),
    });
  });
}

describe("word count status item", () => {
  it("shows the count after opening a document, with the full detail on hover", async () => {
    await open("one two three\nfour");
    const item = await screen.findByText("4 words");
    expect(item.getAttribute("title")).toBe(
      "4 words, 17 characters, 15 characters without spaces, 2 lines, about 1 min read",
    );
    expect(item.getAttribute("aria-label")).toBe(item.getAttribute("title"));
  });

  it("updates after an edit once the 400 ms debounce has elapsed", async () => {
    await open();
    expect(await screen.findByText("0 words")).toBeTruthy();

    vi.useFakeTimers();
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "hello world" } });
    });
    // Nothing is recounted while the debounce runs.
    act(() => vi.advanceTimersByTime(399));
    expect(screen.getByText("0 words")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("2 words")).toBeTruthy();
  });

  it("restarts the debounce on every edit", async () => {
    await open();
    await screen.findByText("0 words");

    vi.useFakeTimers();
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "a" } });
    });
    act(() => vi.advanceTimersByTime(300));
    act(() => {
      editorView().dispatch({ changes: { from: 1, insert: " b" } });
    });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("0 words")).toBeTruthy();
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByText("2 words")).toBeTruthy();
  });

  it("shows 'X of Y words' for a non-empty selection, summing multiple selections", async () => {
    await open(TEXT);
    await screen.findByText("4 words");

    setSelection([[0, 7]]);
    expect(screen.getByText("2 of 4 words")).toBeTruthy();

    setSelection([
      [0, 3],
      [4, 13],
    ]);
    expect(screen.getByText("3 of 4 words")).toBeTruthy();

    setSelection([[5, 5]]);
    expect(screen.getByText("4 words")).toBeTruthy();
  });

  it("is hidden when statusBar.wordCount is false, and the command toggles it", async () => {
    const { workbench } = await open(TEXT);
    await screen.findByText("4 words");

    act(() => workbench.settings.set("statusBar.wordCount", false));
    expect(screen.queryByText(/\bwords?$/)).toBeNull();

    await act(() => workbench.runCommand("view.toggleWordCount"));
    expect(workbench.settings.get("statusBar.wordCount")).toBe(true);
    expect(await screen.findByText("4 words")).toBeTruthy();
  });

  it("shows nothing when no document is open", async () => {
    const { workbench } = await open(TEXT);
    await screen.findByText("4 words");

    await act(() => workbench.closeDocument());
    expect(workbench.activeDocument()).toBeNull();
    expect(within(screen.getByLabelText("Status")).getByText("No document open")).toBeTruthy();
    expect(screen.queryByText(/\bwords?$/)).toBeNull();
  });
});
