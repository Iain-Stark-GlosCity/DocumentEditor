import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TextFormatProvider } from "../../core/format";
import { problemChecking } from "../../core/problems";
import { FormatRegistry } from "../../core/registry";
import { MemoryPlatform } from "../../platform/memory";
import { App } from "../App";
import { defaultFeatures } from ".";
import { editorView, stubProvider } from "../test-helpers";
import { Workbench } from "../workbench";

/** A format that flags every `BAD` in the text and checks documents up to 60 characters. */
const checkedProvider: TextFormatProvider = {
  kind: "text",
  id: "checked",
  name: "Checked",
  fileExtensions: ["chk"],
  viewModes: ["source"],
  editorExtensions: (context) =>
    context.setting("json.lint", true)
      ? [
          problemChecking({
            limit: 60,
            delay: 10,
            source: (state) =>
              [...state.doc.toString().matchAll(/BAD/g)].map((m) => ({
                from: m.index,
                to: m.index + 3,
                severity: "error" as const,
                message: "Found BAD",
              })),
          }),
        ]
      : [],
};

async function open(path: string, text: string) {
  const platform = new MemoryPlatform();
  platform.seedFile(path, text);
  const registry = new FormatRegistry();
  registry.register(stubProvider, { default: true });
  registry.register(checkedProvider);
  const workbench = new Workbench({
    platform,
    registry,
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await screen.findByRole("tab", { name: "Untitled-1" });
  act(() => platform.requestOpen([path]));
  await screen.findByRole("tab", { name: path.split("/").pop() ?? path });
  return workbench;
}

const status = (name: RegExp) => screen.findByRole("button", { name });

describe("problems feature", () => {
  it("shows nothing for a format with no checker, and its commands are disabled", async () => {
    const registry = new FormatRegistry();
    registry.register(stubProvider);
    const workbench = new Workbench({
      platform: new MemoryPlatform(),
      registry,
      features: defaultFeatures,
    });
    render(<App workbench={workbench} />);
    await screen.findByRole("tab", { name: "Untitled-1" });
    expect(screen.queryByRole("button", { name: /problem/i })).toBeNull();
    for (const id of ["edit.nextProblem", "edit.previousProblem", "view.problems"]) {
      expect(workbench.commands.get(id)?.enabled?.()).toBe(false);
    }
  });

  it("counts problems for the active document and updates after an edit", async () => {
    const wb = await open("/d/a.chk", "fine\nBAD here\nBAD again\n");
    const button = await status(/^2 problems: 2 errors/);
    expect(button.textContent).toBe("2 problems");
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "clean\n" } });
    });
    await status(/^No problems found/);
    expect(screen.getByRole("button", { name: /No problems/ }).textContent).toBe("No problems");
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: 0, insert: "BAD" } });
    });
    expect((await status(/^1 problem: 1 error/)).textContent).toBe("1 problem");
    void wb;
  });

  it("says when a document is too large to check", async () => {
    await open("/d/big.chk", `BAD ${"x".repeat(80)}\n`);
    expect((await status(/too large/i)).textContent).toBe("Too large to check");
  });

  it("opens and closes the problems panel from the status item and Ctrl+Shift+M", async () => {
    await open("/d/a.chk", "BAD\n");
    const button = await status(/^1 problem/);
    fireEvent.click(button);
    await waitFor(() => expect(document.querySelector(".cm-panel-lint")).not.toBeNull());
    expect(screen.getByRole("listbox", { name: "Diagnostics" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(document.querySelector(".cm-panel-lint")).toBeNull());
    fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(document.querySelector(".cm-panel-lint")).not.toBeNull());
  });

  it("F8 and Shift+F8 move to the next and previous problem, wrapping round", async () => {
    await open("/d/a.chk", "BAD one\nok\nBAD two\n");
    await status(/^2 problems/);
    const head = () => editorView().state.selection.main.from;
    const second = "BAD one\nok\n".length;
    act(() => editorView().dispatch({ selection: { anchor: 0 } }));
    const press = async (shiftKey: boolean, expected: number) => {
      fireEvent.keyDown(window, { key: "F8", shiftKey });
      await waitFor(() => expect(head()).toBe(expected));
    };
    await press(false, 0);
    await press(false, second);
    await press(false, 0);
    await press(true, second);
    await press(true, 0);
  });

  it("removes the checker when the format's lint setting is turned off", async () => {
    const wb = await open("/d/a.chk", "BAD\n");
    await status(/^1 problem/);
    act(() => wb.settings.set("json.lint", false));
    await waitFor(() => expect(screen.queryByRole("button", { name: /problem/i })).toBeNull());
    act(() => wb.settings.set("json.lint", true));
    await status(/^1 problem/);
  });
});
