import { describe, expect, it } from "vitest";
import { formatKey, matchesKey } from "./keys";

const press = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, ...init });

describe("matchesKey", () => {
  it("matches modifiers exactly", () => {
    expect(matchesKey(press("s", { ctrlKey: true }), "Mod-s")).toBe(true);
    expect(matchesKey(press("s", { metaKey: true }), "Mod-s")).toBe(true);
    expect(matchesKey(press("s", { ctrlKey: true, shiftKey: true }), "Mod-s")).toBe(false);
    expect(matchesKey(press("S", { ctrlKey: true, shiftKey: true }), "Mod-Shift-s")).toBe(true);
    expect(matchesKey(press("s"), "Mod-s")).toBe(false);
  });

  it("handles named keys, function keys and symbols", () => {
    expect(matchesKey(press("F1"), "F1")).toBe(true);
    expect(matchesKey(press("Tab", { ctrlKey: true }), "Mod-Tab")).toBe(true);
    expect(matchesKey(press("Tab", { ctrlKey: true, shiftKey: true }), "Mod-Shift-Tab")).toBe(true);
    expect(matchesKey(press("-", { ctrlKey: true }), "Mod--")).toBe(true);
    expect(matchesKey(press("=", { ctrlKey: true }), "Mod-=")).toBe(true);
    expect(matchesKey(press("z", { altKey: true }), "Alt-z")).toBe(true);
  });
});

describe("formatKey", () => {
  it("formats for display", () => {
    expect(formatKey("Mod-Shift-p")).toBe("Ctrl+Shift+P");
    expect(formatKey("F1")).toBe("F1");
    expect(formatKey("Mod-Tab")).toBe("Ctrl+Tab");
    expect(formatKey("Mod--")).toBe("Ctrl+-");
    expect(formatKey("Alt-z")).toBe("Alt+Z");
  });
});
