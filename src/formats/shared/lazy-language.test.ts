import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { lazyLanguage } from "./lazy-language";

/** A marker extension: its presence is observable in the editor state. */
const marker = StateField.define<boolean>({ create: () => true, update: (v) => v });

function view(extensions: ReturnType<ReturnType<typeof lazyLanguage>>): EditorView {
  return new EditorView({ state: EditorState.create({ doc: "x", extensions }) });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lazyLanguage", () => {
  it("starts without the language and adds it once loaded", async () => {
    let loads = 0;
    const language = lazyLanguage(async () => {
      loads += 1;
      return marker;
    });
    const v = view(language());
    expect(v.state.field(marker, false)).toBeUndefined();
    await tick();
    expect(v.state.field(marker, false)).toBe(true);
    expect(loads).toBe(1);
    v.destroy();
  });

  it("loads once however many editors use it, and later editors start ready", async () => {
    let loads = 0;
    const language = lazyLanguage(async () => {
      loads += 1;
      return marker;
    });
    const a = view(language());
    const b = view(language());
    await tick();
    expect(loads).toBe(1);
    expect(a.state.field(marker, false)).toBe(true);
    expect(b.state.field(marker, false)).toBe(true);
    const c = view(language());
    expect(c.state.field(marker, false)).toBe(true);
    [a, b, c].forEach((v) => v.destroy());
  });

  it("leaves the editor working as plain text if loading fails", async () => {
    const language = lazyLanguage(() => Promise.reject(new Error("offline")));
    const v = view(language());
    await tick();
    expect(v.state.field(marker, false)).toBeUndefined();
    expect(v.state.doc.toString()).toBe("x");
    v.destroy();
  });

  it("does not touch an editor destroyed before the load finishes", async () => {
    const language = lazyLanguage(async () => marker);
    const v = view(language());
    v.destroy();
    await tick();
    expect(v.state.field(marker, false)).toBeUndefined();
  });
});
