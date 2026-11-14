import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../../create-registry";
import { MemoryPlatform } from "../../platform/memory";
import { App } from "../App";
import { editorView } from "../test-helpers";
import { Workbench } from "../workbench";
import { defaultFeatures } from "./index";
import { hasLongLine } from "./long-lines";

async function open(path: string, text: string) {
  const platform = new MemoryPlatform();
  platform.seedFile(path, text);
  const wb = new Workbench({
    platform,
    registry: createRegistry(),
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

const long = `<a>${"<b/>".repeat(15_000)}</a>`;
const notices = (wb: Workbench) => wb.ui.getState().notifications;

describe("hasLongLine", () => {
  it("looks at each line, not the whole text", () => {
    expect(hasLongLine("x".repeat(50_001))).toBe(true);
    expect(hasLongLine("x".repeat(50_000))).toBe(false);
    expect(hasLongLine(`${"x\n".repeat(40_000)}`)).toBe(false);
    expect(hasLongLine(`a\n${"x".repeat(50_001)}\nb`)).toBe(true);
  });
});

describe("long-line offer", () => {
  it("offers Tidy for a long line in XML, and the action tidies", async () => {
    const wb = await open("C:\\d\\a.xml", long);
    const note = notices(wb).find((n) => /very long line/.test(n.message));
    expect(note?.actions?.map((a) => a.label)).toEqual(["Tidy"]);
    act(() => note?.actions?.[0]?.run());
    expect(editorView().state.doc.lines).toBeGreaterThan(10_000);
  });

  it("says nothing for a short XML file or a format with no such command", async () => {
    const short = await open("C:\\d\\a.xml", "<a/>");
    expect(notices(short)).toEqual([]);
    const text = await open("C:\\d\\a.txt", "x".repeat(60_000));
    expect(notices(text)).toEqual([]);
  });
});
