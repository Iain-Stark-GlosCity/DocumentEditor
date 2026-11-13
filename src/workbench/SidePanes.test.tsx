import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupOutline } from "./outline-test-helpers";
import { editorView, pressKey } from "./test-helpers";

const outlinePane = () => screen.getByRole("region", { name: "Outline" });
const previewPane = () => screen.getByRole("region", { name: "Preview" });

async function both() {
  const setup = await setupOutline();
  act(() => {
    setup.workbench.settings.set("outline.visible", true);
    setup.workbench.settings.set("editor.viewMode", "split");
  });
  await screen.findByRole("region", { name: "Outline" });
  await screen.findByRole("region", { name: "Preview" });
  return setup;
}

describe("left and right side panes together", () => {
  it("dock either side of the editor, each with its own splitter", async () => {
    await both();
    const area = document.querySelector(".editor-area")!;
    const order = Array.from(area.children).map(
      (c) => c.getAttribute("aria-label") ?? c.getAttribute("class"),
    );
    expect(order).toEqual([
      "Outline",
      "Resize outline",
      "editor-main",
      "Resize preview",
      "Preview",
    ]);
    expect(outlinePane().getAttribute("data-side")).toBe("left");
    expect(previewPane().getAttribute("data-side")).toBe("right");
  });

  it("resize independently from the keyboard, widening away from the editor", async () => {
    const { workbench } = await both();
    const left = screen.getByRole("separator", { name: "Resize outline" });
    const right = screen.getByRole("separator", { name: "Resize preview" });
    const leftBefore = Number(left.getAttribute("aria-valuenow"));
    const rightBefore = Number(right.getAttribute("aria-valuenow"));

    // The outline is on the left: its splitter moves right to widen it.
    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(Number(left.getAttribute("aria-valuenow"))).toBe(leftBefore + 2);
    expect(Number(right.getAttribute("aria-valuenow"))).toBe(rightBefore);

    fireEvent.keyDown(left, { key: "ArrowRight", shiftKey: true });
    expect(Number(left.getAttribute("aria-valuenow"))).toBe(leftBefore + 12);
    fireEvent.keyDown(left, { key: "ArrowLeft" });
    expect(Number(left.getAttribute("aria-valuenow"))).toBe(leftBefore + 10);

    // The preview is on the right: its splitter moves left to widen it.
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    expect(Number(right.getAttribute("aria-valuenow"))).toBe(rightBefore + 2);
    expect(Number(left.getAttribute("aria-valuenow"))).toBe(leftBefore + 10);

    fireEvent.keyDown(left, { key: "Home" });
    expect(left.getAttribute("aria-valuenow")).toBe(left.getAttribute("aria-valuemin"));
    fireEvent.keyDown(right, { key: "End" });
    expect(right.getAttribute("aria-valuenow")).toBe(right.getAttribute("aria-valuemax"));

    expect(workbench.settings.get("ui.paneSizes")).toEqual({ outline: 15, preview: 85 });
  });

  it("remember their sizes when hidden and shown again", async () => {
    const { workbench } = await both();
    const left = screen.getByRole("separator", { name: "Resize outline" });
    fireEvent.keyDown(left, { key: "ArrowRight", shiftKey: true });
    const size = left.getAttribute("aria-valuenow");

    act(() => workbench.settings.set("outline.visible", false));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Outline" })).toBeNull());
    act(() => workbench.settings.set("outline.visible", true));
    const again = await screen.findByRole("separator", { name: "Resize outline" });
    expect(again.getAttribute("aria-valuenow")).toBe(size);
  });

  it("are all reached by F6 in screen order, and back with Shift+F6", async () => {
    await both();
    editorView().focus();

    pressKey("F6", { ctrlKey: false });
    expect(document.activeElement?.closest(".side-pane")?.getAttribute("aria-label")).toBe(
      "Preview",
    );
    pressKey("F6", { ctrlKey: false });
    expect(outlinePane().contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
    pressKey("F6", { ctrlKey: false });
    expect(editorView().dom.contains(document.activeElement)).toBe(true);

    pressKey("F6", { ctrlKey: false, shiftKey: true });
    expect(outlinePane().contains(document.activeElement)).toBe(true);
    pressKey("F6", { ctrlKey: false, shiftKey: true });
    expect(previewPane().contains(document.activeElement)).toBe(true);
    pressKey("F6", { ctrlKey: false, shiftKey: true });
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("let F6 reach the outline when it is the only pane", async () => {
    const { workbench } = await setupOutline();
    act(() => workbench.settings.set("outline.visible", true));
    await screen.findByRole("region", { name: "Outline" });
    editorView().focus();
    pressKey("F6", { ctrlKey: false });
    expect(outlinePane().contains(document.activeElement)).toBe(true);
    pressKey("F6", { ctrlKey: false });
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });
});
