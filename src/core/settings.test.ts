import { describe, expect, it, vi } from "vitest";
import { SETTINGS_SCHEMA, SettingsStore, isSettingKey } from "./settings";

describe("SettingsStore", () => {
  it("starts with the documented defaults", () => {
    const s = new SettingsStore();
    expect(s.get("appearance.theme")).toBe("system");
    expect(s.get("editor.fontSize")).toBe(14);
    expect(s.get("editor.wordWrap")).toBe(true);
    expect(s.get("editor.lineNumbers")).toBe(false);
    expect(s.get("editor.viewMode")).toBe("source");
    expect(s.get("files.autoSave")).toBe("off");
    expect(s.get("files.autoSaveDelayMs")).toBe(1500);
  });

  it("sets values and rejects invalid ones", () => {
    const s = new SettingsStore();
    s.set("editor.fontSize", 20);
    expect(s.get("editor.fontSize")).toBe(20);
    expect(() => s.set("editor.fontSize", 7)).toThrow(RangeError);
    expect(() => s.set("editor.fontSize", 41)).toThrow(RangeError);
    expect(() => s.set("editor.fontSize", Number.NaN)).toThrow(RangeError);
    // @ts-expect-error not one of the allowed strings
    expect(() => s.set("appearance.theme", "purple")).toThrow(RangeError);
    expect(() => s.set("files.autoSaveDelayMs", 1.5)).toThrow(RangeError);
    expect(s.get("editor.fontSize")).toBe(20);
  });

  it("notifies per key, only on real changes", () => {
    const s = new SettingsStore();
    const font = vi.fn();
    const all = vi.fn();
    s.subscribe("editor.fontSize", font);
    s.subscribeAll(all);
    s.set("editor.wordWrap", false);
    expect(font).not.toHaveBeenCalled();
    expect(all).toHaveBeenCalledExactlyOnceWith("editor.wordWrap");
    s.set("editor.fontSize", 18);
    expect(font).toHaveBeenCalledExactlyOnceWith(18, 14);
    s.set("editor.fontSize", 18);
    expect(font).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes", () => {
    const s = new SettingsStore();
    const cb = vi.fn();
    const off = s.subscribe("editor.wordWrap", cb);
    off();
    s.set("editor.wordWrap", false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("loads JSON, ignoring unknown keys and invalid values", () => {
    const s = new SettingsStore();
    s.load(
      JSON.stringify({
        "appearance.theme": "dark",
        "editor.fontSize": 99,
        "editor.wordWrap": "yes",
        "editor.lineNumbers": true,
        "no.such.key": 1,
        __proto__: { hacked: true },
      }),
    );
    expect(s.get("appearance.theme")).toBe("dark");
    expect(s.get("editor.fontSize")).toBe(14);
    expect(s.get("editor.wordWrap")).toBe(true);
    expect(s.get("editor.lineNumbers")).toBe(true);
    expect(isSettingKey("no.such.key")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
  });

  it("treats bad JSON as no settings", () => {
    const s = new SettingsStore();
    s.set("editor.fontSize", 22);
    s.load("{not json");
    s.load("[1,2]");
    s.load("null");
    expect(s.get("editor.fontSize")).toBe(22);
  });

  it("load resets keys missing from the file to their defaults", () => {
    const s = new SettingsStore();
    s.set("editor.fontSize", 22);
    s.load("{}");
    expect(s.get("editor.fontSize")).toBe(14);
  });

  it("serialises only non-default values and round-trips", () => {
    const s = new SettingsStore();
    expect(JSON.parse(s.serialise())).toEqual({});
    s.set("appearance.theme", "light");
    s.set("editor.lineNumbers", true);
    const json = s.serialise();
    expect(JSON.parse(json)).toEqual({ "appearance.theme": "light", "editor.lineNumbers": true });
    const other = new SettingsStore();
    other.load(json);
    expect(other.get("appearance.theme")).toBe("light");
    expect(other.get("editor.lineNumbers")).toBe(true);
  });

  it("getOr reads known keys and falls back for unknown ones", () => {
    const s = new SettingsStore();
    s.set("editor.fontSize", 16);
    expect(s.getOr("editor.fontSize", 1)).toBe(16);
    expect(s.getOr("markdown.somethingNew", "fallback")).toBe("fallback");
  });

  it("every schema default is valid for its own validator", () => {
    for (const def of Object.values(SETTINGS_SCHEMA)) {
      expect(def.validate(def.default)).toBe(true);
    }
  });
});
