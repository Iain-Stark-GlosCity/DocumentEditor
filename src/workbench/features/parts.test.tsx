import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOCUMENT_XML, DOCX, setupContainers, type Setup } from "../container-test-helpers";
import { pressKey } from "../test-helpers";

const NOTE = "C:\\docs\\note.md";
const region = () => screen.getByRole("region", { name: "Parts" });
const tree = () => screen.getByRole("tree", { name: "Parts of the open file" });
const items = () => within(tree()).getAllByRole("treeitem");
const item = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });
const labels = () => items().map((i) => i.querySelector(".parts-name")?.textContent);
const key = (target: Element, k: string) => fireEvent.keyDown(target, { key: k });
const messages = (s: Setup) => s.workbench.ui.getState().notifications.map((n) => n.message);

async function ready(options: Parameters<typeof setupContainers>[0] = {}) {
  const setup = await setupContainers(options);
  await screen.findByRole("tree", { name: "Parts of the open file" });
  return setup;
}

describe("the Parts pane", () => {
  it("shows for a container, with the container row first, and not for anything else", async () => {
    const { workbench } = await ready();
    expect(region()).toBeTruthy();
    expect(labels()[0]).toBe("report.docx");
    await act(async () => void (await workbench.openPaths([NOTE])));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Parts" })).toBeNull());
  });

  it("does not exist on a platform without containers", async () => {
    await setupContainers({ containers: false });
    expect(screen.queryByRole("region", { name: "Parts" })).toBeNull();
  });

  it("lists folders first, then files in archive order, with size and a text or binary mark", async () => {
    await ready();
    expect(labels()).toEqual([
      "report.docx",
      "word",
      "media",
      "image1.png",
      "_rels",
      "document.xml.rels",
      "document.xml",
      "_rels",
      ".rels",
      "[Content_Types].xml",
    ]);
    const image = item(/image1\.png/);
    expect(image.textContent).toContain("2.4 MB");
    expect(image.textContent).toContain("binary");
    expect(image.getAttribute("aria-label")).toBe("image1.png, 2.4 MB, binary part");
    expect(item(/^document\.xml,/).textContent).toContain("text");
    expect(item(/^document\.xml,/).getAttribute("aria-label")).toBe(
      "document.xml, 44 KB, text part",
    );
    expect(image.className).toContain("parts-item--binary");
  });

  it("has tree semantics and exactly one tab stop", async () => {
    await ready();
    const folder = item("word");
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(folder.getAttribute("aria-level")).toBe("1");
    expect(
      within(tree())
        .getAllByRole("treeitem", { name: /^document\.xml,/ })[0]
        ?.getAttribute("aria-level"),
    ).toBe("2");
    expect(items().filter((i) => i.tabIndex === 0)).toHaveLength(1);
  });

  it("opens a text part as its own tab on click and on Enter", async () => {
    const { workbench } = await ready();
    fireEvent.click(item(/^document\.xml,/));
    await waitFor(() => expect(workbench.activeDocument()?.path).toBe(DOCUMENT_XML));
    expect(workbench.activeDocument()?.title).toBe("report.docx \u203a document.xml");

    const types = item(/^\[Content_Types\]\.xml,/);
    types.focus();
    key(types, "Enter");
    await waitFor(() =>
      expect(workbench.activeDocument()?.path).toBe(`${DOCX}!/[Content_Types].xml`),
    );
  });

  it("opens the Formatting view from the container row", async () => {
    const { workbench } = await ready({ open: [DOCUMENT_XML] });
    expect(workbench.activeDocument()?.path).toBe(DOCUMENT_XML);
    fireEvent.click(item("report.docx, formatting view"));
    await waitFor(() => expect(workbench.activeDocument()?.path).toBe(DOCX));
    expect(workbench.documents.getState().documents).toHaveLength(2);
  });

  it("explains that a binary part cannot be shown as text, and opens nothing", async () => {
    const s = await ready();
    fireEvent.click(item(/image1\.png/));
    expect(messages(s)).toContain("image1.png is a binary part and cannot be shown as text.");
    expect(s.workbench.documents.getState().documents).toHaveLength(1);
  });

  it("highlights the active part, keeps it in view, and follows the active tab", async () => {
    const { workbench } = await ready({ open: [DOCX, DOCUMENT_XML] });
    await waitFor(() =>
      expect(item(/^document\.xml,/).getAttribute("aria-current")).toBe("location"),
    );
    expect(items().filter((i) => i.getAttribute("aria-current") === "location")).toHaveLength(1);
    const view = workbench.documents.getState().documents.find((d) => d.path === DOCX);
    act(() => workbench.documents.getState().setActive(view?.id ?? ""));
    await waitFor(() =>
      expect(item("report.docx, formatting view").getAttribute("aria-current")).toBe("location"),
    );
  });

  it("opens the folders above the active part when it becomes active", async () => {
    const { workbench } = await ready({ open: [DOCX] });
    fireEvent.click(within(region()).getByRole("button", { name: "Collapse all" }));
    expect(labels()).toEqual(["report.docx", "word", "_rels", "[Content_Types].xml"]);
    await act(async () => void (await workbench.openPaths([DOCUMENT_XML])));
    await waitFor(() => expect(item("word").getAttribute("aria-expanded")).toBe("true"));
    expect(item(/^document\.xml,/).getAttribute("aria-current")).toBe("location");
  });

  it("moves with the arrow keys, Home and End, collapses and expands, and types ahead", async () => {
    await ready();
    const first = item("report.docx, formatting view");
    first.focus();
    key(first, "ArrowDown");
    expect(document.activeElement).toBe(item("word"));
    expect(item("word").tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    key(item("word"), "End");
    expect(document.activeElement).toBe(item(/^\[Content_Types\]/));
    key(document.activeElement as Element, "ArrowUp");
    expect(document.activeElement).toBe(item(/^\.rels,/));
    key(document.activeElement as Element, "Home");
    expect(document.activeElement).toBe(first);

    key(item("word"), "ArrowLeft");
    expect(item("word").getAttribute("aria-expanded")).toBe("false");
    expect(labels()).toEqual(["report.docx", "word", "_rels", ".rels", "[Content_Types].xml"]);
    key(item("word"), "ArrowRight");
    expect(item("word").getAttribute("aria-expanded")).toBe("true");
    key(item("word"), "ArrowRight");
    expect(document.activeElement).toBe(item("media"));
    key(item("media"), "ArrowLeft");
    expect(item("media").getAttribute("aria-expanded")).toBe("false");
    key(item("media"), "ArrowLeft");
    expect(document.activeElement).toBe(item("word"));

    key(item("word"), "d");
    expect(document.activeElement).toBe(item(/^document\.xml\.rels,/));
  });

  it("collapses and expands a folder with Enter, and everything with the buttons", async () => {
    await ready();
    key(item("word"), "Enter");
    expect(item("word").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(within(region()).getByRole("button", { name: "Expand all" }));
    expect(item("word").getAttribute("aria-expanded")).toBe("true");
  });

  it("filters by name across folders, and says when nothing matches", async () => {
    await ready();
    const filter = within(region()).getByRole("searchbox", { name: "Filter parts" });
    fireEvent.change(filter, { target: { value: "RELS" } });
    expect(labels()).toEqual(["word/_rels/document.xml.rels", "_rels/.rels"]);
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(within(region()).getByRole("status").textContent).toBe("No parts match the filter.");
    key(filter, "Escape");
    expect((filter as HTMLInputElement).value).toBe("");
    expect(labels()).toHaveLength(10);
  });

  it("shows an empty state", async () => {
    await setupContainers({ parts: [] });
    expect(await screen.findByText("This file has no parts.")).toBeTruthy();
  });

  it("shows the message when the parts cannot be listed, and can try again", async () => {
    const s = await setupContainers();
    s.containers.result = new Error("Not a zip archive");
    const other = "C:\\docs\\broken.docx";
    s.platform.seedFile(other, "x");
    await act(async () => void (await s.workbench.openPaths([other])));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Not a zip archive");
    s.containers.result = [{ name: "a.xml", size: 1, text: true }];
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("tree", { name: "Parts of the open file" });
    expect(labels()).toEqual(["broken.docx", "a.xml"]);
  });

  it("lists again when the container changes, and after a part of it is saved", async () => {
    const s = await ready({ open: [DOCUMENT_XML] });
    expect(s.containers.listed).toEqual([DOCX]);

    const other = "C:\\docs\\other.docx";
    s.platform.seedFile(other, "x");
    await act(async () => void (await s.workbench.openPaths([other])));
    await waitFor(() => expect(s.containers.listed).toEqual([DOCX, other]));

    // Back to the first container's part, then save it: the archive's sizes may have changed.
    await act(async () => void (await s.workbench.openPaths([DOCUMENT_XML])));
    await waitFor(() => expect(s.containers.listed).toEqual([DOCX, other, DOCX]));
    s.containers.result = [{ name: "word/document.xml", size: 99, text: true }];
    const id = s.workbench.activeDocument()?.id ?? "";
    act(() => s.workbench.replaceText(id, "<w:document/>\n"));
    await act(async () => void (await s.workbench.save(id)));
    await waitFor(() => expect(s.containers.listed).toHaveLength(4));
    await waitFor(() => expect(labels()).toEqual(["report.docx", "word", "document.xml"]));
    expect(item(/^document\.xml,/).textContent).toContain("99 B");
  });

  it("ignores the answer for a container that is no longer the active one", async () => {
    const s = await ready();
    expect(labels()[0]).toBe("report.docx");
    const other = "C:\\docs\\second.docx";
    s.platform.seedFile(other, "x");
    s.containers.result = [{ name: "only.xml", size: 1, text: true }];
    await act(async () => void (await s.workbench.openPaths([other])));
    await waitFor(() => expect(labels()).toEqual(["second.docx", "only.xml"]));
  });
});

describe("toggling the Parts pane", () => {
  it("is on by default, toggles with its command, key and the ticked View menu item", async () => {
    const { workbench } = await ready();
    expect(workbench.settings.get("parts.visible")).toBe(true);
    expect(workbench.commands.get("view.toggleParts")?.title).toBe("Parts of the open file");

    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    const entry = await screen.findByRole("menuitemcheckbox", { name: /Parts of the open file/ });
    expect(entry.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(entry);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Parts" })).toBeNull());
    expect(workbench.settings.get("parts.visible")).toBe(false);

    pressKey("p", { altKey: true });
    expect(await screen.findByRole("region", { name: "Parts" })).toBeTruthy();
  });

  it("works beside the outline pane, each with its own splitter and size", async () => {
    const { workbench } = await ready();
    act(() => workbench.settings.set("outline.visible", true));
    expect(await screen.findByRole("region", { name: "Outline" })).toBeTruthy();
    expect(region()).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize parts" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize outline" })).toBeTruthy();
    const splitter = screen.getByRole("separator", { name: "Resize parts" });
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(workbench.settings.get("ui.paneSizes").parts).toBe(26);
    expect(workbench.settings.get("ui.paneSizes").outline).toBeUndefined();
  });
});
