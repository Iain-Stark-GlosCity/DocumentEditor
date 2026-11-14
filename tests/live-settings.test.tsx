/**
 * Settings that a format bakes into its editor extensions apply to open documents at once, with
 * no need to reopen the file (`TextFormatProvider.settings`). Each format that declares such a
 * setting is checked here against the real registry.
 */
import { indentUnit } from "@codemirror/language";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { problemStatusOf } from "../src/core/problems";
import { createRegistry } from "../src/create-registry";
import { MemoryPlatform } from "../src/platform/memory";
import { App } from "../src/workbench/App";
import { defaultFeatures } from "../src/workbench/features";
import { editorView } from "../src/workbench/test-helpers";
import { Workbench } from "../src/workbench/workbench";

let current: Workbench | null = null;
afterEach(() => {
  current?.dispose();
  current = null;
});

async function open(path: string, text: string): Promise<Workbench> {
  const platform = new MemoryPlatform();
  platform.seedFile(path, text);
  const wb = new Workbench({
    platform,
    registry: createRegistry(),
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  current = wb;
  render(<App workbench={wb} />);
  await act(async () => {
    await wb.ready;
    await wb.openPaths([path]);
  });
  return wb;
}

const unit = () => editorView().state.facet(indentUnit);

describe("settings apply to open documents without reopening", () => {
  it("json.indent changes the Tab indent unit", async () => {
    const wb = await open("/d/a.json", '{"a": 1}');
    expect(wb.activeDocument()?.providerId).toBe("json");
    await waitFor(() => expect(unit()).toBe("  "));
    const view = editorView();
    view.dispatch({ selection: { anchor: 3 } });
    act(() => wb.settings.set("json.indent", 4));
    await waitFor(() => expect(unit()).toBe("    "));
    // Text and cursor are kept.
    expect(editorView().state.doc.toString()).toBe('{"a": 1}');
    expect(editorView().state.selection.main.head).toBe(3);
  });

  it("xml.indent changes the Tab indent unit", async () => {
    const wb = await open("/d/a.xml", "<a><b/></a>");
    expect(wb.activeDocument()?.providerId).toBe("xml");
    await waitFor(() => expect(unit()).toBe("  "));
    act(() => wb.settings.set("xml.indent", 3));
    await waitFor(() => expect(unit()).toBe("   "));
  });

  it("json.lint adds and removes the checker", async () => {
    const wb = await open("/d/a.json", '{"a": }');
    expect(problemStatusOf(editorView().state)).not.toBeNull();
    act(() => wb.settings.set("json.lint", false));
    expect(problemStatusOf(editorView().state)).toBeNull();
    act(() => wb.settings.set("json.lint", true));
    expect(problemStatusOf(editorView().state)).not.toBeNull();
  });

  it("xml.lint adds and removes the checker", async () => {
    const wb = await open("/d/a.xml", "<a>");
    expect(problemStatusOf(editorView().state)).not.toBeNull();
    act(() => wb.settings.set("xml.lint", false));
    expect(problemStatusOf(editorView().state)).toBeNull();
  });

  it("yaml.lint adds and removes the checker", async () => {
    const wb = await open("/d/a.yaml", "a: [1\n");
    expect(problemStatusOf(editorView().state)).not.toBeNull();
    act(() => wb.settings.set("yaml.lint", false));
    expect(problemStatusOf(editorView().state)).toBeNull();
    act(() => wb.settings.set("yaml.lint", true));
    expect(problemStatusOf(editorView().state)).not.toBeNull();
  });

  it("csv.delimiter recolours the columns, and the cycle command is an ordinary format command", async () => {
    const wb = await open("/d/a.csv", "a;b;c\n1;2;3\n");
    expect(wb.activeDocument()?.providerId).toBe("csv");
    // Auto-detection finds the semicolons, so the columns are coloured.
    await waitFor(() => expect(document.querySelectorAll(".cm-csv-c1").length).toBeGreaterThan(0));
    expect(wb.commands.get("csv.cycleDelimiter")?.enabled?.()).toBe(true);
    await act(() => wb.runCommand("csv.cycleDelimiter"));
    expect(wb.settings.get("csv.delimiter")).toBe("comma");
    // The user is told what it changed to, since the effect is not always visible at once.
    expect(wb.ui.getState().notifications.map((n) => n.message)).toContain("Delimiter: comma");
    // Comma finds one column, so there is no second colour.
    await waitFor(() => expect(document.querySelectorAll(".cm-csv-c1").length).toBe(0));
    for (const expected of ["semicolon", "tab", "pipe", "auto"] as const) {
      await act(() => wb.runCommand("csv.cycleDelimiter"));
      expect(wb.settings.get("csv.delimiter")).toBe(expected);
    }
    await waitFor(() => expect(document.querySelectorAll(".cm-csv-c1").length).toBeGreaterThan(0));
  });

  it("the cycle command is unavailable outside a CSV document", async () => {
    const wb = await open("/d/a.json", "{}");
    expect(wb.commands.get("csv.cycleDelimiter")?.enabled?.()).toBe(false);
  });
});
