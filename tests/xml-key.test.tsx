/**
 * XML's Tidy and JSON's Format document share Shift-Alt-F. The workbench claims a key only for an
 * enabled command, and a format's commands are enabled only in its own documents.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormatRegistry } from "../src/core/registry";
import { createRegistry } from "../src/create-registry";
import { MemoryPlatform } from "../src/platform/memory";
import { App } from "../src/workbench/App";
import { defaultFeatures } from "../src/workbench/features";
import { editorView } from "../src/workbench/test-helpers";
import { Workbench } from "../src/workbench/workbench";

async function open(path: string, text: string) {
  const all = createRegistry();
  const registry = new FormatRegistry();
  for (const id of ["markdown", "text", "json", "xml"]) {
    const p = all.byId(id);
    if (!p) throw new Error(id);
    registry.register(
      p,
      id === "markdown" ? { default: true } : id === "text" ? { fallback: true } : {},
    );
  }
  const platform = new MemoryPlatform();
  platform.seedFile(path, text);
  const wb = new Workbench({
    platform,
    registry,
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={wb} />);
  await act(async () => {
    await wb.ready;
    await wb.openPaths([path]);
  });
  return wb;
}

const press = () => fireEvent.keyDown(window, { key: "F", altKey: true, shiftKey: true });

describe("a key shared by two formats", () => {
  it("runs Tidy in an XML document", async () => {
    const wb = await open("C:\\d\\a.xml", "<a><b/></a>");
    expect(wb.activeDocument()?.providerId).toBe("xml");
    act(() => press());
    expect(editorView().state.doc.toString()).toBe("<a>\n  <b/>\n</a>");
  });

  it("runs Format document in a JSON document", async () => {
    const wb = await open("C:\\d\\a.json", '{"a":1}');
    expect(wb.activeDocument()?.providerId).toBe("json");
    act(() => press());
    expect(editorView().state.doc.toString()).toBe('{\n  "a": 1\n}');
  });

  it("leaves the key alone in a format with neither", async () => {
    await open("C:\\d\\a.md", "x");
    act(() => press());
    expect(editorView().state.doc.toString()).toBe("x");
  });
});
