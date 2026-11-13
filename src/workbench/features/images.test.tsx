import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextFormatProvider } from "../../core/format";
import { FormatRegistry } from "../../core/registry";
import { MemoryPlatform } from "../../platform/memory";
import { App } from "../App";
import { editorView } from "../test-helpers";
import { Workbench } from "../workbench";
import { images } from "./images";

// A stand-in for the Markdown provider's syntax (the workbench must not import format folders).
const syntaxProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md"],
  viewModes: ["source"],
  editorExtensions: () => [],
  imageSyntax: (path, alt) => `![${alt}](${path.replace(/ /g, "%20")})`,
  linkSyntax: (path, text) => `[${text}](${path.replace(/ /g, "%20")})`,
};

const plainProvider: TextFormatProvider = {
  kind: "text",
  id: "plain",
  name: "Plain text",
  fileExtensions: ["txt"],
  viewModes: ["source"],
  editorExtensions: () => [],
};

interface Setup {
  platform: MemoryPlatform;
  workbench: Workbench;
  view: () => EditorView;
}

async function setup(
  options: { open?: string; text?: string; provider?: TextFormatProvider } = {},
) {
  const platform = new MemoryPlatform();
  if (options.open) {
    platform.seedFile(options.open, options.text ?? "");
    platform.requestOpen([options.open]);
  }
  const registry = new FormatRegistry();
  registry.register(options.provider ?? syntaxProvider);
  const workbench = new Workbench({
    platform,
    registry,
    features: [images],
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await screen.findByRole("tab", { name: options.open ? /doc\.md|notes\.txt/ : "Untitled-1" });
  await workbench.ready;
  const result: Setup = { platform, workbench, view: editorView };
  return result;
}

const png = (...bytes: number[]) =>
  new File([new Uint8Array(bytes.length > 0 ? bytes : [1, 2, 3])], "image.png", {
    type: "image/png",
  });

function paste(view: EditorView, clipboard: { text?: string; files?: File[] }): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const items = (clipboard.files ?? []).map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? (clipboard.text ?? "") : ""),
      items,
    },
  });
  act(() => {
    view.contentDOM.dispatchEvent(event);
  });
  return event;
}

const docText = (view: EditorView) => view.state.doc.toString();
const messages = (wb: Workbench) => wb.ui.getState().notifications.map((n) => n.message);

async function answerDialog(wb: Workbench, value: string) {
  await waitFor(() => expect(wb.ui.getState().dialogs.length).toBeGreaterThan(0));
  const dialog = wb.ui.getState().dialogs[0]!;
  act(() => wb.resolveDialog(dialog.id, value));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 0, 5, 9, 7, 3));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("pasting an image", () => {
  it("saves it beside the document and inserts a link at the cursor", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md", text: "ab" });
    act(() => view().dispatch({ selection: { anchor: 1 } }));
    const event = paste(view(), { files: [png(9, 8, 7)] });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("a![](./assets/image-20260105-090703.png)b");
    expect([...(platform.binaryFiles.get("/d/assets/image-20260105-090703.png") ?? [])]).toEqual([
      9, 8, 7,
    ]);
  });

  it("is one undoable step", async () => {
    const { view } = await setup({ open: "/d/doc.md", text: "ab" });
    act(() => view().dispatch({ selection: { anchor: 2 } }));
    paste(view(), { files: [png()] });
    await waitFor(() => expect(docText(view())).toContain("!["));
    act(() => {
      undo(view());
    });
    expect(docText(view())).toBe("ab");
  });

  it("numbers the name when two images arrive in the same second", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    paste(view(), { files: [png(1)] });
    await waitFor(() => expect(platform.binaryFiles.size).toBe(1));
    paste(view(), { files: [png(2)] });
    await waitFor(() => expect(platform.binaryFiles.size).toBe(2));
    expect([...platform.binaryFiles.keys()]).toEqual([
      "/d/assets/image-20260105-090703.png",
      "/d/assets/image-20260105-090703-1.png",
    ]);
    expect(docText(view())).toContain("image-20260105-090703-1.png");
  });

  it("uses the folder setting", async () => {
    const { platform, workbench, view } = await setup({
      open: "/d/my doc.md".replace("my doc", "doc"),
    });
    workbench.settings.set("markdown.images.folder", "${documentName}.assets");
    paste(view(), { files: [png()] });
    await waitFor(() => expect(platform.binaryFiles.size).toBe(1));
    expect(docText(view())).toBe("![](./doc.assets/image-20260105-090703.png)");
  });

  it("prefers the text when the clipboard also holds an image, as from Word", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    // The editor's own paste handles it: the words go in, the picture is ignored.
    paste(view(), { text: "some words", files: [png()] });
    await act(async () => {});
    expect(platform.binaryFiles.size).toBe(0);
    expect(docText(view())).toBe("some words");
  });

  it("leaves other pastes alone", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    paste(view(), { text: "plain" });
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    paste(view(), { files: [file] });
    await act(async () => {});
    expect(platform.binaryFiles.size).toBe(0);
    expect(docText(view())).toBe("plain");
  });

  it("does nothing in a format that cannot show images", async () => {
    const { platform, view } = await setup({
      open: "/d/notes.txt",
      provider: plainProvider,
    });
    paste(view(), { files: [png()] });
    await act(async () => {});
    expect(platform.binaryFiles.size).toBe(0);
    expect(docText(view())).toBe("");
  });

  it("warns, without changing the image, when it is larger than the limit", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md" });
    workbench.settings.set("markdown.images.warnAboveMb", 1);
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.png", { type: "image/png" });
    paste(view(), { files: [big] });
    await waitFor(() => expect(messages(workbench).join()).toMatch(/2\.0 MB/));
    expect(platform.binaryFiles.get("/d/assets/image-20260105-090703.png")?.length).toBe(
      2 * 1024 * 1024,
    );
    expect(docText(view())).toContain("![](");
  });

  it("does not warn for a small image", async () => {
    const { workbench, view } = await setup({ open: "/d/doc.md" });
    paste(view(), { files: [png()] });
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(messages(workbench)).toEqual([]);
  });

  it("reports a failed write and inserts nothing", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md" });
    platform.failNextBinaryWrite = new Error("No space left on device");
    paste(view(), { files: [png()] });
    await waitFor(() => expect(messages(workbench).join()).toContain("No space left on device"));
    expect(docText(view())).toBe("");
    expect(platform.binaryFiles.size).toBe(0);
  });
});

describe("an untitled document", () => {
  it("asks to save first, and inserts nothing if the user cancels", async () => {
    const { platform, workbench, view } = await setup();
    paste(view(), { files: [png()] });
    await answerDialog(workbench, "cancel");
    await act(async () => {});
    expect(platform.binaryFiles.size).toBe(0);
    expect(docText(view())).toBe("");
  });

  it("saves through Save as, then inserts", async () => {
    const { platform, workbench, view } = await setup();
    platform.queueSaveDialog("/work/new.md");
    paste(view(), { files: [png(5)] });
    await answerDialog(workbench, "save");
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("![](./assets/image-20260105-090703.png)");
    expect(platform.binaryFiles.has("/work/assets/image-20260105-090703.png")).toBe(true);
    expect(workbench.activeDocument()?.path).toBe("/work/new.md");
  });

  it("inserts nothing if the Save as dialog is cancelled", async () => {
    const { platform, workbench, view } = await setup();
    platform.queueSaveDialog(null);
    paste(view(), { files: [png()] });
    await answerDialog(workbench, "save");
    await act(async () => {});
    expect(platform.binaryFiles.size).toBe(0);
    expect(docText(view())).toBe("");
  });
});

describe("dropping files from Explorer", () => {
  const at = (view: EditorView, pos: number) => vi.spyOn(view, "posAtCoords").mockReturnValue(pos);

  it("copies an outside image into assets and links it at the drop position", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md", text: "one\ntwo" });
    platform.seedBinary("/pics/Holiday photo.png", [4, 5]);
    at(view(), 3);
    act(() => platform.dropFiles(["/pics/Holiday photo.png"], 10, 10));
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("one![Holiday photo](./assets/Holiday%20photo.png)\ntwo");
    expect([...(platform.binaryFiles.get("/d/assets/Holiday photo.png") ?? [])]).toEqual([4, 5]);
    expect(platform.binaryFiles.has("/pics/Holiday photo.png")).toBe(true);
  });

  it("puts several files on several lines", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md", text: "" });
    platform.seedBinary("/pics/a.png");
    platform.seedBinary("/pics/b.jpg");
    at(view(), 0);
    act(() => platform.dropFiles(["/pics/a.png", "/pics/b.jpg"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("b.jpg"));
    expect(docText(view())).toBe("![a](./assets/a.png)\n![b](./assets/b.jpg)");
  });

  it("falls back to the cursor when the point maps to no position", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md", text: "xy" });
    platform.seedBinary("/pics/a.png");
    act(() => view().dispatch({ selection: { anchor: 1 } }));
    vi.spyOn(view(), "posAtCoords").mockReturnValue(null);
    act(() => platform.dropFiles(["/pics/a.png"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("x![a](./assets/a.png)y");
  });

  it("links an image inside the document's folder tree in place, without copying", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    platform.seedBinary("/d/img/sub/p.png");
    at(view(), 0);
    act(() => platform.dropFiles(["/d/img/sub/p.png"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("![p](./img/sub/p.png)");
    expect([...platform.binaryFiles.keys()]).toEqual(["/d/img/sub/p.png"]);
  });

  it("numbers the copy when a different file already has the name", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    platform.seedBinary("/d/assets/a.png", [1]);
    platform.seedBinary("/pics/a.png", [2]);
    at(view(), 0);
    act(() => platform.dropFiles(["/pics/a.png"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("![a](./assets/a-1.png)");
    expect([...(platform.binaryFiles.get("/d/assets/a.png") ?? [])]).toEqual([1]);
  });

  it("reuses an image that is already at the destination (same path)", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md" });
    workbench.settings.set("markdown.images.folder", "../shared");
    platform.seedBinary("/shared/a.png", [1]);
    at(view(), 0);
    act(() => platform.dropFiles(["/shared/a.png"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("!["));
    expect(docText(view())).toBe("![a](../shared/a.png)");
    expect([...platform.binaryFiles.keys()]).toEqual(["/shared/a.png"]);
  });

  it("opens a dropped Markdown file in a new tab", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md", text: "keep" });
    platform.seedFile("/other/more.md", "more");
    act(() => platform.dropFiles(["/other/more.md"], 1, 1));
    await waitFor(() => expect(workbench.activeDocument()?.path).toBe("/other/more.md"));
    expect(workbench.documents.getState().documents).toHaveLength(2);
    expect(workbench.getText(workbench.documents.getState().documents[0]!.id)).toBe("keep");
    void view;
  });

  it("links any other file, relatively when it is under the document's folder", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    at(view(), 0);
    act(() => platform.dropFiles(["/d/files/Report 1.pdf", "/elsewhere/x.zip"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("x.zip"));
    expect(docText(view())).toBe(
      "[Report 1.pdf](./files/Report%201.pdf)\n[x.zip](/elsewhere/x.zip)",
    );
  });

  it("links a Windows drive path as a relative path, or absolute across drives", async () => {
    const { platform, view } = await setup({ open: "C:\\Docs\\doc.md" });
    platform.seedBinary("C:\\Docs\\img\\a b.png");
    at(view(), 0);
    act(() => platform.dropFiles(["C:\\Docs\\img\\a b.png", "D:\\Data\\r.xlsx"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("r.xlsx"));
    expect(docText(view())).toBe("![a b](./img/a%20b.png)\n[r.xlsx](D:/Data/r.xlsx)");
  });

  it("reports a failure for one file and still inserts the others", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md" });
    platform.seedBinary("/pics/good.png");
    at(view(), 0);
    act(() => platform.dropFiles(["/pics/missing.png", "/pics/good.png"], 1, 1));
    await waitFor(() => expect(docText(view())).toContain("good"));
    expect(docText(view())).toBe("![good](./assets/good.png)");
    expect(messages(workbench).join()).toContain("missing.png");
  });

  it("inserts nothing and says so when the copy fails", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md" });
    platform.seedBinary("/pics/a.png");
    platform.failNextBinaryWrite = new Error("Access is denied");
    act(() => platform.dropFiles(["/pics/a.png"], 1, 1));
    await waitFor(() => expect(messages(workbench).join()).toContain("Access is denied"));
    expect(docText(view())).toBe("");
  });

  it("asks to save an untitled document before copying, and inserts nothing on cancel", async () => {
    const { platform, workbench, view } = await setup();
    platform.seedBinary("/pics/a.png");
    act(() => platform.dropFiles(["/pics/a.png"], 1, 1));
    await answerDialog(workbench, "cancel");
    await act(async () => {});
    expect(docText(view())).toBe("");
    expect([...platform.binaryFiles.keys()]).toEqual(["/pics/a.png"]);
  });

  it("shows a drop indicator while a drag is over the editor", async () => {
    const { platform, view } = await setup({ open: "/d/doc.md" });
    await act(async () => {});
    act(() => platform.dragFilesOver({ x: 5, y: 5 }));
    expect(view().dom.classList.contains("cm-file-drop-active")).toBe(true);
    act(() => platform.dragFilesOver(null));
    expect(view().dom.classList.contains("cm-file-drop-active")).toBe(false);
    act(() => platform.dragFilesOver({ x: 5, y: 5 }));
    act(() => platform.dropFiles([], 5, 5));
    expect(view().dom.classList.contains("cm-file-drop-active")).toBe(false);
  });
});

describe("the insert image command", () => {
  it("is registered and in the Edit menu", async () => {
    const { workbench } = await setup({ open: "/d/doc.md" });
    expect(workbench.commands.get("markdown.insertImage")?.title).toBe("Insert image…");
    expect(workbench.menuItems().some((m) => m.command === "markdown.insertImage")).toBe(true);
  });

  it("is disabled in a format without image syntax", async () => {
    const { workbench } = await setup({ open: "/d/notes.txt", provider: plainProvider });
    expect(workbench.commands.get("markdown.insertImage")?.enabled?.()).toBe(false);
  });

  it("applies the same copy-or-link rules to the picked files", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md", text: "x" });
    platform.seedBinary("/pics/a.png");
    platform.seedBinary("/d/in/b.png");
    act(() => view().dispatch({ selection: { anchor: 1 } }));
    platform.queueOpenDialog(["/pics/a.png", "/d/in/b.png"]);
    await act(async () => {
      await workbench.commands.get("markdown.insertImage")!.run();
    });
    expect(docText(view())).toBe("x![a](./assets/a.png)\n![b](./in/b.png)");
    expect(platform.binaryFiles.has("/d/assets/a.png")).toBe(true);
  });

  it("does nothing when the picker is cancelled", async () => {
    const { platform, workbench, view } = await setup({ open: "/d/doc.md" });
    platform.queueOpenDialog([]);
    await act(async () => {
      await workbench.commands.get("markdown.insertImage")!.run();
    });
    expect(docText(view())).toBe("");
    expect(platform.binaryFiles.size).toBe(0);
  });
});
