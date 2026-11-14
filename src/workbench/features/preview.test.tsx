import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RenderResult, TextFormatProvider } from "../../core/format";
import { FormatRegistry } from "../../core/registry";
import { MemoryPlatform } from "../../platform/memory";
import { renderMarkdown } from "../../render";
import { App } from "../App";
import { editorView, pressKey } from "../test-helpers";
import { Workbench } from "../workbench";
import { defaultFeatures } from "./index";

const NOTE = "C:\\docs\\note.md";

/** The real pipeline behind a provider that supports split view. */
const markdownish: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md"],
  viewModes: ["source", "split"],
  editorExtensions: () => [],
  render: (text, context) => renderMarkdown(text, context),
};

/** A provider whose renders finish only when the test says so. */
function controlled() {
  const calls: { text: string; finish(html: string): void }[] = [];
  const provider: TextFormatProvider = {
    ...markdownish,
    render: (text: string) =>
      new Promise<RenderResult>((resolve) => {
        calls.push({ text, finish: (html) => resolve({ html }) });
      }),
  };
  return { provider, calls };
}

async function setup(
  provider: TextFormatProvider,
  text: string,
  mode: "split" | "source" = "split",
) {
  const platform = new MemoryPlatform();
  platform.seedFile(NOTE, text);
  platform.seedFile("C:\\docs\\other.md", "# Other\n");
  const registry = new FormatRegistry();
  registry.register(provider);
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
  act(() => workbench.settings.set("editor.viewMode", mode));
  return { platform, workbench };
}

const pane = () => screen.queryByRole("region", { name: "Preview" });
const inPreview = () => within(content());
const content = () => document.querySelector<HTMLElement>(".preview-content")!;
const scroller = () => document.querySelector<HTMLElement>(".preview-scroll")!;
const type = (text: string) => {
  const view = editorView();
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));
};

describe("showing and hiding the pane", () => {
  it("toggles with the command and its key, and never takes focus", async () => {
    await setup(markdownish, "# Title\n", "source");
    expect(pane()).toBeNull();

    pressKey("p", { ctrlKey: false, altKey: true });
    const region = await screen.findByRole("region", { name: "Preview" });
    expect(await within(region).findByRole("heading", { name: "Title" })).toBeTruthy();
    expect(region.contains(document.activeElement)).toBe(false);

    pressKey("p", { ctrlKey: false, altKey: true });
    await waitFor(() => expect(pane()).toBeNull());
  });

  it("is in the View menu", async () => {
    await setup(markdownish, "x\n", "source");
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: /Split preview/ })).toBeTruthy();
  });

  it("moves focus between the editor and the preview with F6", async () => {
    await setup(markdownish, "# Title\n");
    await screen.findByRole("heading", { name: "Title" });
    editorView().focus();

    pressKey("F6", { ctrlKey: false });
    expect(document.activeElement).toBe(scroller());
    expect(scroller().getAttribute("aria-label")).toBe("Rendered document");

    pressKey("F6", { ctrlKey: false });
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("stays hidden for a format with no preview, and says so", async () => {
    const { workbench } = await setup(
      { ...markdownish, render: undefined, viewModes: ["source"] },
      "x\n",
      "source",
    );
    pressKey("p", { ctrlKey: false, altKey: true });
    expect(await screen.findByText("This kind of document has no preview.")).toBeTruthy();
    expect(workbench.settings.get("editor.viewMode")).toBe("source");
    act(() => workbench.settings.set("editor.viewMode", "split"));
    expect(pane()).toBeNull();
  });
});

describe("keeping up with typing", () => {
  it("updates the preview after the pause, keeping untouched blocks", async () => {
    await setup(markdownish, "# Title\n\nfirst\n");
    await waitFor(() => expect(inPreview().getByText("first")).toBeTruthy());
    const heading = screen.getByRole("heading", { name: "Title" });

    type("\nsecond\n");
    // Not at once: the previous render stays on show until the pause is over.
    expect(inPreview().queryByText("second")).toBeNull();
    await waitFor(() => expect(inPreview().getByText("second")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Title" })).toBe(heading);
  });

  it("discards a render that a newer one has replaced", async () => {
    const { provider, calls } = controlled();
    await setup(provider, "a");
    await waitFor(() => expect(calls).toHaveLength(1));

    type("b");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.text).toBe("ab");

    // The newer render finishes first, then the older one limps in.
    await act(async () => calls[1]?.finish("<p>newer</p>"));
    await screen.findByText("newer");
    await act(async () => calls[0]?.finish("<p>older</p>"));
    await act(async () => {});
    expect(screen.queryByText("older")).toBeNull();
    expect(screen.getByText("newer")).toBeTruthy();
  });

  it("shows a polite indicator only when a render is slow, and keeps the old preview", async () => {
    const { provider, calls } = controlled();
    await setup(provider, "a");
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.finish("<p>old</p>"));
    await screen.findByText("old");

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");

    type("b");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(status.textContent).toBe("");
    await waitFor(() => expect(status.textContent).toBe("Rendering…"), { timeout: 1500 });
    expect(screen.getByText("old")).toBeTruthy();

    await act(async () => calls[1]?.finish("<p>new</p>"));
    await screen.findByText("new");
    expect(status.textContent).toBe("");
  });

  it("keeps the old preview and says so when a render fails", async () => {
    let fail = false;
    const provider: TextFormatProvider = {
      ...markdownish,
      render: (text, context) =>
        fail ? Promise.reject(new Error("bad input")) : renderMarkdown(text, context),
    };
    await setup(provider, "kept\n");
    await waitFor(() => expect(inPreview().getByText("kept")).toBeTruthy());
    fail = true;
    type("more");
    expect(await screen.findByText("Preview not updated: bad input")).toBeTruthy();
    expect(inPreview().getByText("kept")).toBeTruthy();
  });
});

describe("links", () => {
  async function click(name: string | RegExp) {
    const link = await screen.findByRole("link", { name });
    return { link, notPrevented: fireEvent.click(link) };
  }

  it("opens http(s) and mailto links outside the app, and never navigates", async () => {
    const { platform } = await setup(
      markdownish,
      "[web](https://example.com/a) [mail](mailto:me@example.com)\n",
    );
    expect((await click("web")).notPrevented).toBe(false);
    expect((await click("mail")).notPrevented).toBe(false);
    expect(platform.openedUrls).toEqual(["https://example.com/a", "mailto:me@example.com"]);
  });

  it("reports a failure to open", async () => {
    const { platform } = await setup(markdownish, "[web](https://example.com/a)\n");
    platform.openExternal = () => Promise.reject(new Error("no browser"));
    await click("web");
    expect(await screen.findByText(/no browser/)).toBeTruthy();
  });

  it("scrolls to an anchor inside the preview", async () => {
    await setup(markdownish, "Note[^1].\n\n[^1]: The note.\n");
    const { notPrevented } = await click("1");
    expect(notPrevented).toBe(false);
  });

  it("opens a relative link to a known format in the editor", async () => {
    const { workbench } = await setup(markdownish, "[next](other.md#top)\n");
    await click("next");
    await waitFor(() => expect(workbench.activeDocument()?.path).toBe("C:\\docs\\other.md"));
  });

  it("only names the target of a link to any other local file", async () => {
    const { platform, workbench } = await setup(markdownish, "[sheet](data.csv)\n");
    await click("sheet");
    expect(await screen.findByText("Link target: C:\\docs\\data.csv")).toBeTruthy();
    expect(platform.openedUrls).toEqual([]);
    expect(workbench.activeDocument()?.path).toBe(NOTE);
  });
});

describe("images", () => {
  it("gives a relative image a URL the webview can load", async () => {
    await setup(markdownish, "![a pic](img/a%20b.png)\n");
    const image = await screen.findByAltText("a pic");
    expect(image.getAttribute("src")).toBe(
      `memory-asset://files/${encodeURIComponent("C:\\docs\\img\\a b.png")}`,
    );
  });

  it("does not load an image of an unsaved document", async () => {
    const { workbench } = await setup(markdownish, "x\n");
    act(() => {
      workbench.newFile();
    });
    type("![p](a.png)");
    const image = await screen.findByAltText("p");
    expect(image.hasAttribute("src")).toBe(false);
  });

  it("loads remote images by default and suppresses them when the setting is off", async () => {
    const { workbench } = await setup(markdownish, "![far](https://example.com/x.png)\n");
    const image = await screen.findByAltText("far");
    expect(image.getAttribute("src")).toBe("https://example.com/x.png");

    act(() => workbench.settings.set("preview.loadRemoteImages", false));
    await waitFor(() => expect(screen.getByAltText("far").hasAttribute("src")).toBe(false));
    expect(screen.getByAltText("far").classList.contains("preview-image-blocked")).toBe(true);

    act(() => workbench.settings.set("preview.loadRemoteImages", true));
    await waitFor(() =>
      expect(screen.getByAltText("far").getAttribute("src")).toBe("https://example.com/x.png"),
    );
  });

  it("never loads an asset address the author wrote", async () => {
    await setup(markdownish, "![bad](asset://localhost/C%3A%5Csecret.png)\n");
    const image = await screen.findByAltText("bad");
    expect(image.hasAttribute("src")).toBe(false);
  });
});

describe("pointing back at the source", () => {
  it("moves the editor cursor to the block that was double-clicked", async () => {
    await setup(markdownish, "# Title\n\nfirst\n\nsecond\n");
    await waitFor(() => expect(inPreview().getByText("second")).toBeTruthy());
    fireEvent.doubleClick(inPreview().getByText("second"));
    const view = editorView();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5);
  });
});

describe("styling hooks", () => {
  it("scales with the editor font size", async () => {
    const { workbench } = await setup(markdownish, "x\n");
    await waitFor(() => expect(inPreview().getByText("x")).toBeTruthy());
    const root = document.querySelector<HTMLElement>(".preview")!;
    const before = parseFloat(root.style.getPropertyValue("--preview-font-size"));
    act(() => workbench.settings.set("editor.fontSize", 28));
    expect(parseFloat(root.style.getPropertyValue("--preview-font-size"))).toBeCloseTo(before * 2);
    expect(content().isConnected).toBe(true);
  });
});
