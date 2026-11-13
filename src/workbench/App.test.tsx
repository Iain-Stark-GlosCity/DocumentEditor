import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TextFormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { MemoryPlatform } from "../platform/memory";
import type { FileFormat } from "../platform/platform";
import { App } from "./App";

// A stub provider: the workbench must work with whatever the registry holds (rule 4).
const stubProvider: TextFormatProvider = {
  kind: "text",
  id: "markdown",
  name: "Markdown",
  fileExtensions: ["md"],
  viewModes: ["source"],
  editorExtensions: () => [],
};

const pressKey = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ctrlKey: true, ...init });

describe("workbench", () => {
  it("opens a file, edits it and saves it with the original FileFormat", async () => {
    const format: FileFormat = { encoding: "utf-16le", bom: true, eol: "crlf", mixedEol: false };
    const platform = new MemoryPlatform();
    platform.seedFile("C:\\notes\\todo.md", "one\ntwo\n", format);
    const registry = new FormatRegistry();
    registry.register(stubProvider);

    render(<App platform={platform} registry={registry} />);

    platform.queueOpenDialog(["C:\\notes\\todo.md"]);
    pressKey("o");

    const tab = await screen.findByRole("tab", { name: "todo.md" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(screen.getByText("UTF-16 LE with BOM")).toBeTruthy());
    expect(screen.getByText("CRLF")).toBeTruthy();

    const content = document.querySelector<HTMLElement>(".cm-content");
    expect(content).not.toBeNull();
    const view = EditorView.findFromDOM(content!.closest<HTMLElement>(".cm-editor")!)!;
    expect(view.state.doc.toString()).toBe("one\ntwo\n");

    view.dispatch({ changes: { from: 0, insert: "zero\n" } });

    // Dirty indicator on the tab and in the window title.
    await screen.findByRole("tab", { name: /^todo\.md.*unsaved changes/ });
    await waitFor(() => expect(document.title).toBe("● todo.md - DocumentEditor"));
    await waitFor(() => expect(platform.windowTitle).toBe("● todo.md - DocumentEditor"));

    pressKey("s");

    await waitFor(() =>
      expect(platform.files.get("C:\\notes\\todo.md")?.text).toBe("zero\none\ntwo\n"),
    );
    expect(platform.files.get("C:\\notes\\todo.md")?.format).toEqual(format);
    await screen.findByRole("tab", { name: "todo.md" });
    await waitFor(() => expect(document.title).toBe("todo.md - DocumentEditor"));
  });

  it("asks before closing a dirty tab", async () => {
    const platform = new MemoryPlatform();
    const registry = new FormatRegistry();
    registry.register(stubProvider);
    render(<App platform={platform} registry={registry} />);

    const tab = await screen.findByRole("tab", { name: "Untitled-1" });
    expect(tab).toBeTruthy();
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ changes: { from: 0, insert: "draft" } });
    await screen.findByRole("tab", { name: /^Untitled-1.*unsaved changes/ });

    pressKey("w");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Save changes to Untitled-1?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("tab", { name: /Untitled-1/ })).toBeTruthy();

    pressKey("w");
    fireEvent.click(await screen.findByRole("button", { name: "Do not save" }));
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
  });
});
