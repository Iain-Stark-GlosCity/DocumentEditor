/**
 * The acceptance test for the feature design: a feature that lives entirely in this file (no
 * edit to App.tsx, workbench.ts or another feature) contributes a command, a status item, a
 * menu item and a side pane, and the workbench picks them all up.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Feature, FeatureComponentProps } from "./feature";
import { defaultFeatures } from "./features";
import { useActiveDocument, useSetting } from "./hooks";
import { editorView, pressKey, renderApp } from "./test-helpers";

const ran = vi.fn();

function ProbeStatus({ workbench }: FeatureComponentProps) {
  const doc = useActiveDocument(workbench);
  return <span>Probe: {doc?.title ?? "none"}</span>;
}

function ProbePane({ workbench }: FeatureComponentProps) {
  const doc = useActiveDocument(workbench);
  return <p>Pane for {doc?.title}</p>;
}

const probe: Feature = {
  id: "test-probe",
  commands: (wb) => [
    {
      id: "probe.hello",
      title: "Say hello",
      defaultKey: "Mod-Alt-h",
      run: () => {
        ran();
        wb.notify({ message: "Hello from the probe" });
      },
    },
  ],
  menuItems: [{ menu: "help", group: "2_probe", command: "probe.hello" }],
  statusItems: [{ id: "probe", align: "right", component: ProbeStatus }],
  sidePane: {
    id: "probe-pane",
    title: "Probe pane",
    useVisible: (wb) => useSetting(wb, "editor.viewMode") === "split",
    component: ProbePane,
  },
};

describe("a feature contributed from one file", () => {
  const features = [...defaultFeatures, probe];

  it("contributes a command with a key, run once per key press", async () => {
    ran.mockClear();
    renderApp({ features });
    await screen.findByRole("tab", { name: "Untitled-1" });

    // From the editor, from the window and from the body: one run each, key default prevented.
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    expect(fireEvent.keyDown(content, { key: "h", ctrlKey: true, altKey: true })).toBe(false);
    expect(ran).toHaveBeenCalledTimes(1);
    pressKey("h", { altKey: true });
    expect(ran).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.body, { key: "h", ctrlKey: true, altKey: true });
    expect(ran).toHaveBeenCalledTimes(3);
    expect((await screen.findAllByText("Hello from the probe")).length).toBe(3);
  });

  it("contributes a menu item and a status item", async () => {
    renderApp({ features });
    await screen.findByRole("tab", { name: "Untitled-1" });
    expect(await screen.findByText("Probe: Untitled-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Help" }));
    const menu = screen.getByRole("menu", { name: "Help" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Say hello/ }));
    expect(await screen.findByText("Hello from the probe")).toBeTruthy();
  });

  it("contributes a side pane with a keyboard-operable splitter", async () => {
    const { workbench } = renderApp({ features });
    await screen.findByRole("tab", { name: "Untitled-1" });
    expect(screen.queryByRole("region", { name: "Probe pane" })).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();

    act(() => workbench.settings.set("editor.viewMode", "split"));
    const pane = await screen.findByRole("region", { name: "Probe pane" });
    expect(within(pane).getByText("Pane for Untitled-1")).toBeTruthy();
    // The editor is still there beside it.
    expect(document.querySelector(".cm-editor")).not.toBeNull();

    const splitter = screen.getByRole("separator", { name: "Resize probe pane" });
    expect(splitter.getAttribute("aria-orientation")).toBe("vertical");
    expect(splitter.tabIndex).toBe(0);
    expect(splitter.getAttribute("aria-valuenow")).toBe("40");
    fireEvent.keyDown(splitter, { key: "ArrowLeft" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("42");
    fireEvent.keyDown(splitter, { key: "ArrowRight", shiftKey: true });
    expect(splitter.getAttribute("aria-valuenow")).toBe("32");
    fireEvent.keyDown(splitter, { key: "End" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("85");
    fireEvent.keyDown(splitter, { key: "Home" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("15");

    act(() => workbench.settings.set("editor.viewMode", "source"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Probe pane" })).toBeNull());
  });

  it("contributes editor extensions that follow a setting without losing the text", async () => {
    const lineNumbers = () => document.querySelector(".cm-lineNumbers");
    const { workbench } = renderApp();
    await screen.findByRole("tab", { name: "Untitled-1" });
    editorView().dispatch({ changes: { from: 0, insert: "keep me" } });
    expect(lineNumbers()).toBeNull();
    act(() => workbench.settings.set("editor.lineNumbers", true));
    expect(lineNumbers()).not.toBeNull();
    expect(editorView().state.doc.toString()).toBe("keep me");
  });
});
