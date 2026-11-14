import { deleteCharBackward, insertNewlineAndIndent } from "@codemirror/commands";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOCUMENT_XML, DOCX, setupContainers, VIEW_TEXT } from "../container-test-helpers";
import type { Platform } from "../../platform/platform";
import { editorView, pressKey } from "../test-helpers";
import { shouldAutosave } from "./autosave";

const NOTE = "C:\\docs\\note.md";
const SAVE_NOTICE = "This view is read-only. Use Save as… to keep a text copy.";

describe("a read-only document", () => {
  it("refuses edits but keeps the caret and selection, and says so to assistive technology", async () => {
    await setupContainers();
    const view = editorView();
    expect(view.state.doc.toString()).toBe(VIEW_TEXT);
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
    // `editable: false` would take the caret away; `readOnly` keeps it.
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");

    view.dispatch({ selection: { anchor: 3, head: 7 } });
    expect(view.state.selection.main.from).toBe(3);
    expect(insertNewlineAndIndent(view)).toBe(false);
    expect(deleteCharBackward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(VIEW_TEXT);
  });

  it("is never dirty, so closing it never asks", async () => {
    const { workbench } = await setupContainers();
    const id = workbench.activeDocument()?.id ?? "";
    // Even a programmatic change to the buffer (a regenerated view) is not an unsaved edit.
    act(() => workbench.replaceText(id, "something else\n"));
    expect(workbench.isDirty(id)).toBe(false);
    expect(workbench.ui.getState().dirty[id]).toBe(false);
    let closed = false;
    await act(async () => {
      closed = await workbench.closeDocument(id);
    });
    expect(closed).toBe(true);
    expect(workbench.ui.getState().dialogs).toHaveLength(0);
    expect(workbench.documents.getState().documents.some((d) => d.id === id)).toBe(false);
  });

  it("does not offer Save, and Ctrl+S explains instead of saving", async () => {
    const { workbench, platform } = await setupContainers();
    expect(workbench.commands.get("file.save")?.enabled?.()).toBe(false);
    expect(workbench.commands.get("file.saveAs")?.enabled?.()).toBe(true);

    fireEvent.click(screen.getByRole("menuitem", { name: "File" }));
    await screen.findByRole("menu", { name: "File" });
    const save = document.querySelector('[data-label="Save"]');
    expect(save?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });

    const before = platform.files.get(DOCX)?.modifiedMs;
    pressKey("s");
    await waitFor(() =>
      expect(workbench.ui.getState().notifications.map((n) => n.message)).toContain(SAVE_NOTICE),
    );
    expect(platform.files.get(DOCX)?.modifiedMs).toBe(before);
  });

  it("leaves Ctrl+S alone for an ordinary document", async () => {
    const { workbench, platform } = await setupContainers({ open: [NOTE] });
    expect(workbench.commands.get("file.save")?.enabled?.()).toBe(true);
    act(() => workbench.replaceText(workbench.activeDocument()?.id ?? "", "# Changed\n"));
    pressKey("s");
    await waitFor(() => expect(platform.files.get(NOTE)?.text).toBe("# Changed\n"));
    expect(workbench.ui.getState().notifications.map((n) => n.message)).not.toContain(SAVE_NOTICE);
  });

  it("shows a Read-only status item with a name and a tooltip, only for such documents", async () => {
    const { workbench } = await setupContainers({ open: [DOCX, NOTE] });
    // The note is active (opened last).
    expect(screen.queryByText("Read-only")).toBeNull();
    const docx = workbench.documents.getState().documents.find((d) => d.path === DOCX);
    act(() => workbench.documents.getState().setActive(docx?.id ?? ""));
    const item = await screen.findByText("Read-only");
    expect(item.getAttribute("aria-label")).toMatch(/^Read-only\. .*Save as/);
    expect(item.getAttribute("title")).toMatch(/generated view/);
  });

  it("marks the tab", async () => {
    await setupContainers({ open: [DOCX, NOTE] });
    const tabs = screen.getAllByRole("tab");
    const docxTab = tabs.find((t) => t.textContent?.includes("report.docx"));
    const noteTab = tabs.find((t) => t.textContent?.includes("note.md"));
    expect(docxTab?.getAttribute("title")).toBe(`${DOCX} (read-only)`);
    expect(docxTab?.textContent).toContain("(read-only)");
    expect(noteTab?.getAttribute("title")).toBe(NOTE);
  });

  it("is skipped by autosave and has no recovery snapshot", async () => {
    const { workbench, platform } = await setupContainers();
    const candidate = {
      mode: "afterDelay" as const,
      trigger: "delay" as const,
      path: DOCX,
      dirty: true,
      held: false,
      saving: false,
    };
    expect(shouldAutosave(candidate)).toBe(true);
    expect(shouldAutosave({ ...candidate, readOnly: true })).toBe(false);
    const result = await workbench.saveDocument(workbench.activeDocument()?.id ?? null, {
      auto: true,
    });
    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(platform.recovery.size).toBe(0);
  });

  it("keeps the rest of the workbench following its format", async () => {
    const { workbench } = await setupContainers();
    expect(workbench.registry.byId(workbench.activeDocument()?.providerId ?? "")?.readOnly).toBe(
      true,
    );
    // Find, word count and the format switcher still work against the view.
    expect(screen.getByRole("button", { name: /^Format: Word document/ })).toBeTruthy();
    pressKey("f");
    expect(await screen.findByRole("search")).toBeTruthy();
  });
});

describe("Save as from a read-only document", () => {
  it("writes the text as a copy, then the document is an ordinary editable one", async () => {
    const { workbench, platform } = await setupContainers();
    const id = workbench.activeDocument()?.id ?? "";
    const archiveMs = platform.files.get(DOCX)?.modifiedMs;
    platform.queueSaveDialog("C:\\docs\\copy.md");
    await act(async () => void (await workbench.saveAs()));

    expect(platform.files.get("C:\\docs\\copy.md")?.text).toBe(VIEW_TEXT);
    // The original archive is untouched.
    expect(platform.files.get(DOCX)?.modifiedMs).toBe(archiveMs);
    const doc = workbench.documents.getState().documents.find((d) => d.id === id);
    expect(doc?.path).toBe("C:\\docs\\copy.md");
    expect(doc?.title).toBe("copy.md");
    expect(doc?.providerId).toBe("markdown");
    expect(workbench.isReadOnly(doc)).toBe(false);

    const view = editorView();
    expect(view.state.readOnly).toBe(false);
    expect(view.contentDOM.getAttribute("aria-readonly")).toBeNull();
    expect(screen.queryByText("Read-only")).toBeNull();
    expect(workbench.commands.get("file.save")?.enabled?.()).toBe(true);

    // And it can now be edited and saved like any other document.
    act(() => workbench.replaceText(id, "edited\n"));
    expect(workbench.isDirty(id)).toBe(true);
    await act(async () => void (await workbench.save(id)));
    expect(platform.files.get("C:\\docs\\copy.md")?.text).toBe("edited\n");
  });

  it("offers a text name and the default format, not the original file's", async () => {
    const { workbench, platform } = await setupContainers();
    let offered: { defaultPath?: string; first?: string } = {};
    const original = platform.showSaveDialog.bind(platform);
    const spy: Platform["showSaveDialog"] = (options) => {
      offered = { defaultPath: options.defaultPath, first: options.filters[0]?.name };
      return original();
    };
    (platform as Platform).showSaveDialog = spy;
    platform.queueSaveDialog(null);
    await act(async () => void (await workbench.saveAs()));
    expect(offered).toEqual({ defaultPath: "report.md", first: "Markdown" });
  });

  it("falls back to plain text for a name nobody claims", async () => {
    const { workbench, platform } = await setupContainers();
    platform.queueSaveDialog("C:\\docs\\copy.xyz");
    await act(async () => void (await workbench.saveAs()));
    expect(platform.files.get("C:\\docs\\copy.xyz")?.text).toBe(VIEW_TEXT);
    expect(workbench.activeDocument()?.providerId).toBe("text");
    expect(editorView().state.readOnly).toBe(false);
  });

  it("refuses to write the text over a name that belongs to a view-only format", async () => {
    const { workbench, platform } = await setupContainers();
    const archiveMs = platform.files.get(DOCX)?.modifiedMs;
    platform.queueSaveDialog(DOCX);
    await act(async () => void (await workbench.saveAs()));
    expect(platform.files.get(DOCX)?.modifiedMs).toBe(archiveMs);
    expect(workbench.activeDocument()?.providerId).toBe("docx-view");
    expect(
      workbench.ui
        .getState()
        .notifications.some((n) => n.kind === "error" && /view-only/.test(n.message)),
    ).toBe(true);
  });

  it("can be switched to an editable format by hand too", async () => {
    const { workbench } = await setupContainers();
    const id = workbench.activeDocument()?.id ?? "";
    await act(async () => workbench.documents.getState().setProvider(id, "text"));
    expect(editorView().state.readOnly).toBe(false);
    expect(workbench.isDirty(id)).toBe(false);
  });
});

describe("titles of container parts", () => {
  it("uses the container title for a part, and for the window", async () => {
    const { workbench, platform } = await setupContainers({ open: [DOCUMENT_XML] });
    expect(workbench.activeDocument()?.title).toBe("report.docx \u203a document.xml");
    expect(within(screen.getByRole("tablist")).getByRole("tab").textContent).toContain(
      "report.docx \u203a document.xml",
    );
    await waitFor(() =>
      expect(platform.windowTitle).toBe("report.docx \u203a document.xml - DocumentEditor"),
    );
  });

  it("keeps ordinary titles, and re-derives the title on Save as", async () => {
    const { workbench, platform } = await setupContainers({ open: [DOCUMENT_XML] });
    expect(workbench.documents.getState().documents.map((d) => d.title)).toEqual([
      "report.docx \u203a document.xml",
    ]);
    platform.queueSaveDialog("C:\\docs\\part.xml");
    await act(async () => void (await workbench.saveAs()));
    expect(workbench.activeDocument()?.title).toBe("part.xml");
    platform.queueSaveDialog(`${DOCX}!/word/other.xml`);
    await act(async () => void (await workbench.saveAs()));
    expect(workbench.activeDocument()?.title).toBe("report.docx \u203a other.xml");
  });
});
