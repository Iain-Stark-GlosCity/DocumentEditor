import { describe, expect, it } from "vitest";
import { classifyLink } from "./links";
import { assetPlaceholder, readAssetPlaceholder, resolveRelativePath } from "./paths";

describe("resolveRelativePath", () => {
  it("resolves against a Windows document", () => {
    expect(resolveRelativePath("C:\\docs\\note.md", "img/a.png")).toBe("C:\\docs\\img\\a.png");
    expect(resolveRelativePath("C:\\docs\\note.md", "./a.png")).toBe("C:\\docs\\a.png");
    expect(resolveRelativePath("C:\\docs\\sub\\note.md", "../a.png")).toBe("C:\\docs\\a.png");
  });

  it("resolves against a POSIX document", () => {
    expect(resolveRelativePath("/home/me/note.md", "a/b.png")).toBe("/home/me/a/b.png");
    expect(resolveRelativePath("/note.md", "a.png")).toBe("/a.png");
  });

  it("resolves against a network path", () => {
    expect(resolveRelativePath("\\\\srv\\share\\d\\n.md", "a.png")).toBe(
      "\\\\srv\\share\\d\\a.png",
    );
    expect(resolveRelativePath("\\\\srv\\share\\n.md", "..\\..\\..\\a.png")).toBe(
      "\\\\srv\\share\\a.png",
    );
  });

  it("never climbs above the root", () => {
    expect(resolveRelativePath("C:\\n.md", "../../a.png")).toBe("C:\\a.png");
  });

  it("decodes percent escapes and drops query and fragment", () => {
    expect(resolveRelativePath("C:\\d\\n.md", "my%20file.png?raw=1#x")).toBe("C:\\d\\my file.png");
    expect(resolveRelativePath("C:\\d\\n.md", "100%.png")).toBe("C:\\d\\100%.png");
  });

  it("gives up without an absolute document path or a target", () => {
    expect(resolveRelativePath("Untitled-1", "a.png")).toBeNull();
    expect(resolveRelativePath("C:\\d\\n.md", "#top")).toBeNull();
  });
});

describe("asset placeholders", () => {
  it("round-trips an absolute path", () => {
    const url = assetPlaceholder("C:\\docs\\n.md", "my%20pic.png");
    expect(url.startsWith("asset://doc/")).toBe(true);
    expect(readAssetPlaceholder(url)).toEqual({ kind: "file", path: "C:\\docs\\my pic.png" });
  });

  it("marks images of an unsaved document as unresolved", () => {
    expect(readAssetPlaceholder(assetPlaceholder(null, "a.png"))).toEqual({ kind: "unresolved" });
  });

  it("ignores other URLs", () => {
    expect(readAssetPlaceholder("https://example.com/a.png")).toBeNull();
    expect(readAssetPlaceholder("asset://localhost/x")).toBeNull();
  });
});

describe("classifyLink", () => {
  const doc = "C:\\docs\\n.md";

  it("recognises anchors", () => {
    expect(classifyLink("#user-content-fn-1", doc)).toEqual({
      kind: "anchor",
      id: "user-content-fn-1",
    });
    expect(classifyLink("#caf%C3%A9", doc)).toEqual({ kind: "anchor", id: "café" });
  });

  it("sends only http, https and mailto outside", () => {
    expect(classifyLink("https://a.example/x", doc).kind).toBe("external");
    expect(classifyLink("HTTP://a.example", doc).kind).toBe("external");
    expect(classifyLink("mailto:a@example.com", doc).kind).toBe("external");
    for (const bad of [
      "javascript:alert(1)",
      "file:///C:/x",
      "data:text/html,x",
      "//evil.example",
    ]) {
      expect(classifyLink(bad, doc).kind).toBe("none");
    }
  });

  it("resolves relative links beside the document", () => {
    expect(classifyLink("other.md#part", doc)).toEqual({
      kind: "file",
      path: "C:\\docs\\other.md",
    });
    expect(classifyLink("other.md", null).kind).toBe("none");
    expect(classifyLink("/abs.md", doc).kind).toBe("none");
    expect(classifyLink("C:\\x\\y.md", doc).kind).toBe("none");
  });
});
