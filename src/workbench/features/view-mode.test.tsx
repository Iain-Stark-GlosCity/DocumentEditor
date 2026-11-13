import { redo, undo } from "@codemirror/commands";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FormatRegistry } from "../../core/registry";
import { createRegistry } from "../../create-registry";
import { MemoryPlatform } from "../../platform/memory";
import { App } from "../App";
import { editorView, pressKey, stubRegistry } from "../test-helpers";
import { Workbench } from "../workbench";
import { defaultFeatures } from "./index";

const NOTE = "C:\\docs\\note.md";
const TEXT = "# Title\n\nSome **bold** and a [link](https://example.com).\n\n- [ ] task\n";

async function setup(text = TEXT, registry?: FormatRegistry) {
  const platform = new MemoryPlatform();
  platform.seedFile(NOTE, text);
  platform.seedFile("C:\\docs\\other.md", "# Other\n");
  registry ??= createRegistry();
  const workbench = new Workbench({
    platform,
    registry,
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await act(async () => {
    await workbench.ready;
    await workbench.openPaths([NOTE]);
  });
  return { platform, workbench };
}

const modeButton = () => screen.getByRole("button", { name: /^View mode:/ });
const isLive = () => editorView().dom.classList.contains("cm-live");

describe("switching view mode", () => {
  it("cycles source, live and split with the key and the status bar button", async () => {
    const { workbench } = await setup();
    expect(modeButton().textContent).toBe("Source");
    expect(isLive()).toBe(false);

    act(() => void pressKey("m", { ctrlKey: false, altKey: true }));
    await waitFor(() => expect(workbench.settings.get("editor.viewMode")).toBe("live"));
    expect(modeButton().textContent).toBe("Live preview");
    expect(isLive()).toBe(true);

    fireEvent.click(modeButton());
    await waitFor(() => expect(workbench.settings.get("editor.viewMode")).toBe("split"));
    expect(modeButton().getAttribute("aria-label")).toBe("View mode: Split. Switch to source");
    // Split view is the source editor beside the preview.
    expect(isLive()).toBe(false);

    fireEvent.click(modeButton());
    await waitFor(() => expect(workbench.settings.get("editor.viewMode")).toBe("source"));
  });

  it("shows the current mode in the View menu", async () => {
    const { workbench } = await setup();
    act(() => workbench.settings.set("editor.viewMode", "live"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    const menu = screen.getByRole("menu", { name: "View" });
    expect(
      within(menu).getByRole("menuitem", { name: "Live preview mode (current)" }),
    ).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Source mode" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Source mode" }));
    await waitFor(() => expect(workbench.settings.get("editor.viewMode")).toBe("source"));
  });

  it("falls back to source for formats without live preview", async () => {
    const { workbench } = await setup("text\n", stubRegistry());
    await act(() => workbench.runCommand("view.liveMode"));
    expect(workbench.settings.get("editor.viewMode")).toBe("source");
    act(() => workbench.settings.set("editor.viewMode", "live"));
    expect(modeButton().textContent).toBe("Source");
    await act(() => workbench.runCommand("view.cycleViewMode"));
    expect(workbench.settings.get("editor.viewMode")).toBe("source");
  });

  it("keeps text, caret and undo history across mode switches", async () => {
    const { workbench } = await setup();
    const view = editorView();
    act(() => view.dispatch({ changes: { from: 2, insert: "My " }, userEvent: "input" }));
    const edited = view.state.doc.toString();
    const caret = edited.indexOf("bold") + 2;
    act(() => view.dispatch({ selection: { anchor: caret } }));

    for (const mode of ["live", "split", "live", "source", "live"] as const) {
      act(() => workbench.settings.set("editor.viewMode", mode));
      expect(editorView()).toBe(view);
      expect(view.state.doc.toString()).toBe(edited);
      expect(view.state.selection.main.head).toBe(caret);
      // Moving around in live mode never changes the text either.
      for (const pos of [0, 5, caret, edited.length, 12]) {
        act(() => view.dispatch({ selection: { anchor: pos } }));
      }
      act(() => view.dispatch({ selection: { anchor: caret } }));
    }
    expect(isLive()).toBe(true);
    expect(view.state.doc.toString()).toBe(edited);

    act(() => void undo(view));
    expect(view.state.doc.toString()).toBe(TEXT);
    act(() => void redo(view));
    expect(view.state.doc.toString()).toBe(edited);

    await act(() => workbench.save());
    expect(workbench.getText(workbench.activeDocument()!.id)).toBe(edited);
  });
});

describe("links and images from live preview", () => {
  it("opens external links through the platform", async () => {
    const { platform, workbench } = await setup();
    act(() => workbench.settings.set("editor.viewMode", "live"));
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: TEXT.indexOf("[link]") + 2 } }));
    await act(() => workbench.runCommand("markdown.openLink"));
    expect(platform.openedUrls).toEqual(["https://example.com"]);
  });

  it("opens relative Markdown links as documents", async () => {
    const { workbench } = await setup("See [other](other.md).\n");
    act(() => workbench.settings.set("editor.viewMode", "live"));
    act(() => editorView().dispatch({ selection: { anchor: 6 } }));
    await act(async () => {
      await workbench.runCommand("markdown.openLink");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(workbench.activeDocument()?.path).toBe("C:\\docs\\other.md"));
  });

  it("loads relative images through the platform's asset URLs", async () => {
    const { workbench } = await setup("Text\n\n![A cat](img/cat.png)\n\nEnd\n");
    act(() => workbench.settings.set("editor.viewMode", "live"));
    const img = editorView().dom.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      `memory-asset://files/${encodeURIComponent("C:\\docs\\img\\cat.png")}`,
    );
    expect(img?.getAttribute("alt")).toBe("A cat");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("honours the remote images setting", async () => {
    const { workbench } = await setup("Text\n\n![Logo](https://x.org/a.png)\n\nEnd\n");
    act(() => workbench.settings.set("editor.viewMode", "live"));
    expect(editorView().dom.querySelector("img")?.getAttribute("src")).toBe("https://x.org/a.png");
    act(() => workbench.settings.set("preview.loadRemoteImages", false));
    expect(editorView().dom.querySelector("img")).toBeNull();
    expect(editorView().dom.querySelector(".cm-live-image-blocked")?.textContent).toContain(
      "Remote images are turned off",
    );
  });
});
