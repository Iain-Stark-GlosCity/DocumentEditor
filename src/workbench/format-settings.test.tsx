import { Facet } from "@codemirror/state";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TextFormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { SettingsStore } from "../core/settings";
import { MemoryPlatform } from "../platform/memory";
import { App } from "./App";
import { Workbench } from "./workbench";

/** A format that bakes `json.indent` into its extensions when they are built. */
const baked = Facet.define<number, number>({ combine: (v) => v[0] ?? -1 });
let builds = 0;
const bakingProvider: TextFormatProvider = {
  kind: "text",
  id: "baking",
  name: "Baking",
  fileExtensions: ["bak"],
  viewModes: ["source"],
  settings: ["json.indent"],
  commands: [
    {
      id: "baking.widen",
      title: "Widen",
      run(_view, host) {
        host?.setSetting("json.indent", host.setting("json.indent", 2) + 1);
        return true;
      },
    },
  ],
  editorExtensions: (context) => {
    builds++;
    return [baked.of(context.setting("json.indent", 2))];
  },
};
/** Another format that declares nothing: it must be left alone. */
let otherBuilds = 0;
const otherProvider: TextFormatProvider = {
  kind: "text",
  id: "other",
  name: "Other",
  fileExtensions: ["oth"],
  viewModes: ["source"],
  editorExtensions: () => {
    otherBuilds++;
    return [];
  },
};

/** A settings store that counts how many subscriptions are live. */
class CountingSettings extends SettingsStore {
  /** Live subscriptions beyond the baseline the workbench itself holds (settings saving). */
  live = 0;
  base = 0;
  /** Subscriptions held for formats. */
  get formats() {
    return this.live - this.base;
  }
  override subscribeAll(callback: Parameters<SettingsStore["subscribeAll"]>[0]) {
    this.live++;
    const stop = super.subscribeAll(callback);
    let done = false;
    return () => {
      if (!done) this.live--;
      done = true;
      stop();
    };
  }
}

async function setup(files: Record<string, string>) {
  const platform = new MemoryPlatform();
  for (const [path, text] of Object.entries(files)) platform.seedFile(path, text);
  const registry = new FormatRegistry();
  registry.register(otherProvider, { default: true });
  registry.register(bakingProvider);
  const settings = new CountingSettings();
  const workbench = new Workbench({
    platform,
    registry,
    settings,
    features: [],
    settingsSaveDelayMs: 5,
  });
  workbench.start();
  await workbench.ready;
  settings.base = settings.live; // the workbench's own save subscription is not ours
  return { workbench, settings };
}

const idOf = (workbench: Workbench, title: string) => {
  const doc = workbench.documents.getState().documents.find((d) => d.title === title);
  if (!doc) throw new Error(`No document ${title}`);
  return doc.id;
};

describe("format settings that are baked into the editor extensions", () => {
  it("rebuilds every open document of the format, keeping text and cursor", async () => {
    const { workbench, settings } = await setup({ "/a.bak": "one two", "/b.bak": "three" });
    await workbench.openPaths(["/a.bak", "/b.bak"]);
    const a = idOf(workbench, "a.bak");
    const b = idOf(workbench, "b.bak");
    expect(workbench.getEditorState(a)?.facet(baked)).toBe(2);
    const before = otherBuilds;

    settings.set("json.indent", 6);
    expect(workbench.getEditorState(a)?.facet(baked)).toBe(6);
    expect(workbench.getEditorState(b)?.facet(baked)).toBe(6);
    expect(workbench.getText(a)).toBe("one two");
    // A format that declared nothing is not rebuilt.
    expect(otherBuilds).toBe(before);
    workbench.dispose();
  });

  it("applies to a document opened after the subscription was made", async () => {
    const { workbench, settings } = await setup({ "/a.bak": "x" });
    expect(settings.formats).toBe(0);
    settings.set("json.indent", 3);
    await workbench.openPaths(["/a.bak"]);
    expect(settings.formats).toBe(1);
    settings.set("json.indent", 5);
    expect(workbench.getEditorState(idOf(workbench, "a.bak"))?.facet(baked)).toBe(5);
    workbench.dispose();
  });

  it("subscribes once however many documents are open, and stops when the last closes", async () => {
    const { workbench, settings } = await setup({ "/a.bak": "x", "/b.bak": "y" });
    await workbench.openPaths(["/a.bak", "/b.bak"]);
    expect(settings.formats).toBe(1);
    await workbench.closeDocument(idOf(workbench, "a.bak"));
    expect(settings.formats).toBe(1);
    await workbench.closeDocument(idOf(workbench, "b.bak"));
    expect(settings.formats).toBe(0);
    const count = builds;
    settings.set("json.indent", 7);
    expect(builds).toBe(count);
    workbench.dispose();
  });

  it("stops on dispose", async () => {
    const { workbench, settings } = await setup({ "/a.bak": "x" });
    await workbench.openPaths(["/a.bak"]);
    expect(settings.formats).toBe(1);
    workbench.dispose();
    expect(settings.live).toBe(0); // nothing of the workbench's is left subscribed
  });

  it("ignores settings the format did not declare", async () => {
    const { workbench, settings } = await setup({ "/a.bak": "x" });
    await workbench.openPaths(["/a.bak"]);
    const count = builds;
    settings.set("xml.indent", 4);
    expect(builds).toBe(count);
    workbench.dispose();
  });
});

describe("format commands and settings", () => {
  it("a command gets a host that reads and writes settings, validated, applied live", async () => {
    const { workbench, settings } = await setup({ "/a.bak": "x" });
    render(<App workbench={workbench} />);
    await workbench.openPaths(["/a.bak"]);
    const id = idOf(workbench, "a.bak");
    await waitFor(() => expect(workbench.activeView()).not.toBeNull());
    await workbench.runCommand("baking.widen");
    expect(settings.get("json.indent")).toBe(3);
    expect(workbench.getEditorState(id)?.facet(baked)).toBe(3);
    // Writes are validated by the settings schema.
    expect(() => settings.setByKey("json.indent", "wide")).toThrow(RangeError);
    expect(() => settings.setByKey("no.such.key", 1)).toThrow(RangeError);
    expect(settings.get("json.indent")).toBe(3);
    workbench.dispose();
  });
});
