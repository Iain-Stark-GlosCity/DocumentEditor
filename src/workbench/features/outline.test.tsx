import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { outlineProvider, SAMPLE, setupOutline } from "../outline-test-helpers";
import { editorView, pressKey } from "../test-helpers";

const tree = () => screen.getByRole("tree", { name: "Document outline" });
const item = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });
const items = () => within(tree()).getAllByRole("treeitem");
const names = () => items().map((i) => i.textContent?.replace(/[▾▸]/g, "").trim());
const key = (target: Element, k: string) => fireEvent.keyDown(target, { key: k });
const alt = (k: string) => pressKey(k, { ctrlKey: false, altKey: true });
const at = (needle: string) => SAMPLE.indexOf(needle);

async function openOutline() {
  const setup = await setupOutline();
  act(() => setup.workbench.settings.set("outline.visible", true));
  await screen.findByRole("tree", { name: "Document outline" });
  return setup;
}

describe("the outline pane", () => {
  it("toggles with its key, and is in the View menu", async () => {
    const { workbench } = await setupOutline();
    expect(screen.queryByRole("region", { name: "Outline" })).toBeNull();

    pressKey("o", { shiftKey: true });
    expect(await screen.findByRole("region", { name: "Outline" })).toBeTruthy();
    expect(workbench.settings.get("outline.visible")).toBe(true);

    pressKey("o", { shiftKey: true });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Outline" })).toBeNull());

    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    expect(await screen.findByRole("menuitem", { name: /Toggle outline/ })).toBeTruthy();
  });

  it("shows the headings as a tree with levels, set positions and expanded state", async () => {
    await openOutline();
    expect(names()).toEqual(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]);
    expect(items().map((i) => i.getAttribute("aria-level"))).toEqual(["1", "2", "3", "2", "1"]);
    expect(item("Beta").getAttribute("aria-expanded")).toBe("true");
    expect(item("Gamma").hasAttribute("aria-expanded")).toBe(false);
    expect(item("Delta").getAttribute("aria-posinset")).toBe("2");
    expect(item("Delta").getAttribute("aria-setsize")).toBe("2");
  });

  it("has exactly one tab stop (roving tabindex)", async () => {
    await openOutline();
    expect(items().filter((i) => i.tabIndex === 0)).toHaveLength(1);
  });

  it("moves with Up, Down, Home and End", async () => {
    await openOutline();
    item("Alpha").focus();
    key(item("Alpha"), "ArrowDown");
    expect(document.activeElement).toBe(item("Beta"));
    expect(item("Beta").tabIndex).toBe(0);
    expect(item("Alpha").tabIndex).toBe(-1);
    key(item("Beta"), "End");
    expect(document.activeElement).toBe(item("Epsilon"));
    key(item("Epsilon"), "ArrowUp");
    expect(document.activeElement).toBe(item("Delta"));
    key(item("Delta"), "Home");
    expect(document.activeElement).toBe(item("Alpha"));
  });

  it("collapses with Left, expands with Right, and moves to the parent or first child", async () => {
    await openOutline();
    item("Beta").focus();
    key(item("Beta"), "ArrowLeft");
    expect(item("Beta").getAttribute("aria-expanded")).toBe("false");
    expect(names()).toEqual(["Alpha", "Beta", "Delta", "Epsilon"]);

    key(item("Beta"), "ArrowRight");
    expect(item("Beta").getAttribute("aria-expanded")).toBe("true");
    expect(names()).toContain("Gamma");

    key(item("Beta"), "ArrowRight");
    expect(document.activeElement).toBe(item("Gamma"));
    key(item("Gamma"), "ArrowLeft");
    expect(document.activeElement).toBe(item("Beta"));
  });

  it("collapses and expands every level with the buttons", async () => {
    await openOutline();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(names()).toEqual(["Alpha", "Epsilon"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(items()).toHaveLength(5);
  });

  it("jumps by typing the start of a heading", async () => {
    await openOutline();
    item("Alpha").focus();
    key(item("Alpha"), "d");
    expect(document.activeElement).toBe(item("Delta"));
    key(item("Delta"), "e");
    expect(document.activeElement).toBe(item("Delta"));
  });

  it("activates with Enter: cursor to the heading, editor focused", async () => {
    const { workbench } = await openOutline();
    item("Delta").focus();
    key(item("Delta"), "Enter");
    expect(workbench.activeView()?.state.selection.main.head).toBe(at("## Delta"));
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("activates with a click", async () => {
    const { workbench } = await openOutline();
    fireEvent.click(item("Epsilon"));
    expect(workbench.activeView()?.state.selection.main.head).toBe(at("# Epsilon"));
  });

  it("returns focus to the editor with Escape", async () => {
    await openOutline();
    item("Alpha").focus();
    key(item("Alpha"), "Escape");
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("highlights the heading that contains the cursor and follows it", async () => {
    await openOutline();
    const view = editorView();
    expect(item("Alpha").getAttribute("aria-current")).toBe("location");

    act(() => view.dispatch({ selection: { anchor: at("Beta text") } }));
    await waitFor(() => expect(item("Beta").getAttribute("aria-current")).toBe("location"));
    expect(item("Alpha").hasAttribute("aria-current")).toBe(false);

    act(() => view.dispatch({ selection: { anchor: at("Last.") } }));
    await waitFor(() => expect(item("Epsilon").getAttribute("aria-current")).toBe("location"));
    expect(items().filter((i) => i.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("highlights the nearest shown ancestor when the heading is collapsed", async () => {
    await openOutline();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    act(() => editorView().dispatch({ selection: { anchor: at("Gamma text") } }));
    await waitFor(() => expect(item("Alpha").getAttribute("aria-current")).toBe("location"));
  });

  it("filters the list", async () => {
    await openOutline();
    const box = screen.getByRole("searchbox", { name: "Filter headings" });
    fireEvent.change(box, { target: { value: "ta" } });
    expect(names()).toEqual(["Beta", "Delta"]);
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("No headings match the filter.")).toBeTruthy();
  });

  it("follows edits, but leaves the list alone when the headings are unchanged", async () => {
    await openOutline();
    const before = item("Beta");
    const view = editorView();

    act(() => view.dispatch({ changes: { from: at("Beta text"), insert: "More " } }));
    await new Promise((r) => setTimeout(r, 350));
    expect(item("Beta")).toBe(before);

    act(() => view.dispatch({ changes: { from: 0, insert: "# New\n\n" } }));
    await waitFor(() => expect(items()).toHaveLength(6));
    expect(item("New")).toBeTruthy();
  });

  it("says when there are no headings", async () => {
    const { workbench } = await setupOutline("Just text.\n");
    act(() => workbench.settings.set("outline.visible", true));
    expect(await screen.findByText("No headings yet.")).toBeTruthy();
  });

  it("says when the format has no outline", async () => {
    const { workbench } = await setupOutline("# A\n", { ...outlineProvider, outline: undefined });
    act(() => workbench.settings.set("outline.visible", true));
    expect(await screen.findByText("This document has no outline.")).toBeTruthy();
  });
});

describe("heading navigation", () => {
  it("moves to the next and previous heading with the keys", async () => {
    const { workbench } = await setupOutline();
    const head = () => workbench.activeView()?.state.selection.main.head;
    act(() => editorView().dispatch({ selection: { anchor: at("Intro") } }));

    alt("PageDown");
    expect(head()).toBe(at("## Beta"));
    alt("PageDown");
    expect(head()).toBe(at("### Gamma"));
    alt("PageUp");
    expect(head()).toBe(at("## Beta"));
    // From the middle of a section, previous goes to that section's own heading.
    act(() => editorView().dispatch({ selection: { anchor: at("Delta text") } }));
    alt("PageUp");
    expect(head()).toBe(at("## Delta"));
  });

  it("stays put after the last heading", async () => {
    const { workbench } = await setupOutline();
    act(() => editorView().dispatch({ selection: { anchor: at("Last.") } }));
    alt("PageDown");
    expect(workbench.activeView()?.state.selection.main.head).toBe(at("Last."));
  });

  it("opens a quick pick of headings and goes to the chosen one", async () => {
    const { workbench } = await setupOutline();
    await act(async () => {
      await workbench.runCommand("navigate.goToHeading");
    });
    const dialog = await screen.findByRole("dialog", { name: "Go to heading" });
    const box = within(dialog).getByRole("combobox");
    expect(within(dialog).getAllByRole("option")).toHaveLength(5);

    fireEvent.change(box, { target: { value: "gam" } });
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "Go to heading" })).toBeNull();
    expect(workbench.activeView()?.state.selection.main.head).toBe(at("### Gamma"));
  });

  it("closes the quick pick with Escape", async () => {
    const { workbench } = await setupOutline();
    await act(async () => {
      await workbench.runCommand("navigate.goToHeading");
    });
    const dialog = await screen.findByRole("dialog", { name: "Go to heading" });
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Go to heading" })).toBeNull();
  });
});
