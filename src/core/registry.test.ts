import { describe, expect, it } from "vitest";
import type { TextFormatProvider } from "./format";
import { FormatRegistry, extensionOf } from "./registry";

function provider(id: string, fileExtensions: string[]): TextFormatProvider {
  return {
    kind: "text",
    id,
    name: id,
    fileExtensions,
    viewModes: ["source"],
    editorExtensions: () => [],
  };
}

describe("FormatRegistry", () => {
  it("registers and looks up by id", () => {
    const registry = new FormatRegistry();
    const md = provider("markdown", ["md"]);
    registry.register(md);
    expect(registry.byId("markdown")).toBe(md);
    expect(registry.byId("nope")).toBeUndefined();
    expect(registry.all()).toEqual([md]);
  });

  it("rejects duplicate ids", () => {
    const registry = new FormatRegistry();
    registry.register(provider("markdown", ["md"]));
    expect(() => registry.register(provider("markdown", ["txt"]))).toThrow(/already registered/);
  });

  it("matches the extension case-insensitively, on Windows and POSIX paths", () => {
    const registry = new FormatRegistry();
    const md = provider("markdown", ["md", "markdown"]);
    registry.register(md);
    expect(registry.forPath("C:\\Users\\me\\Notes.MD")).toBe(md);
    expect(registry.forPath("/home/me/readme.Markdown")).toBe(md);
  });

  it("returns undefined when nothing matches", () => {
    const registry = new FormatRegistry();
    registry.register(provider("markdown", ["md"]));
    expect(registry.forPath("notes.txt")).toBeUndefined();
    expect(registry.forPath("README")).toBeUndefined();
    expect(registry.forPath("C:\\dir.md\\file")).toBeUndefined();
  });

  it("picks the first registered provider that claims an extension", () => {
    const registry = new FormatRegistry();
    const a = provider("a", ["txt"]);
    registry.register(a);
    registry.register(provider("b", ["txt"]));
    expect(registry.forPath("x.txt")).toBe(a);
  });
});

describe("extensionOf", () => {
  it("handles edge cases", () => {
    expect(extensionOf("a.tar.GZ")).toBe("gz");
    expect(extensionOf("a.")).toBe("");
    expect(extensionOf("")).toBe("");
  });
});
