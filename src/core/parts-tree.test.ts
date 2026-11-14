import { describe, expect, it } from "vitest";
import type { ContainerPart } from "../platform/platform";
import { ancestorKeys, buildPartsTree, formatSize, visibleParts } from "./parts-tree";

const part = (name: string, size = 10, text = true): ContainerPart => ({ name, size, text });

const PARTS = [
  part("[Content_Types].xml"),
  part("word/document.xml"),
  part("_rels/.rels"),
  part("word/media/image1.png", 5000, false),
  part("word/_rels/document.xml.rels"),
  part("docProps/core.xml"),
];

describe("buildPartsTree", () => {
  it("puts folders before files, each in archive order", () => {
    const keys = buildPartsTree(PARTS).map((n) => n.key);
    expect(keys).toEqual([
      "dir:word",
      "dir:word/media",
      "file:word/media/image1.png",
      "dir:word/_rels",
      "file:word/_rels/document.xml.rels",
      "file:word/document.xml",
      "dir:_rels",
      "file:_rels/.rels",
      "dir:docProps",
      "file:docProps/core.xml",
      "file:[Content_Types].xml",
    ]);
  });

  it("sets depth, parent and set positions", () => {
    const nodes = buildPartsTree(PARTS);
    const doc = nodes.find((n) => n.key === "file:word/document.xml");
    expect(doc).toMatchObject({ depth: 2, parent: "dir:word", label: "document.xml", setSize: 3 });
    expect(doc?.posInSet).toBe(3);
    const top = nodes.filter((n) => n.parent === null);
    expect(top.map((n) => n.posInSet)).toEqual([1, 2, 3, 4]);
    expect(top.every((n) => n.setSize === 4)).toBe(true);
    expect(nodes.find((n) => n.key === "dir:word")?.hasChildren).toBe(true);
  });

  it("ignores folder entries and handles an empty archive", () => {
    expect(buildPartsTree([part("word/", 0)])).toEqual([]);
    expect(buildPartsTree([])).toEqual([]);
  });
});

describe("visibleParts", () => {
  const nodes = buildPartsTree(PARTS);

  it("hides everything under a collapsed folder, including nested folders", () => {
    const keys = visibleParts(nodes, new Set(["dir:word"]), "").map((n) => n.key);
    expect(keys).toEqual([
      "dir:word",
      "dir:_rels",
      "file:_rels/.rels",
      "dir:docProps",
      "file:docProps/core.xml",
      "file:[Content_Types].xml",
    ]);
  });

  it("lists only matching files, whatever is collapsed, while filtering", () => {
    const keys = visibleParts(nodes, new Set(["dir:word"]), " RELS").map((n) => n.key);
    expect(keys).toEqual(["file:word/_rels/document.xml.rels", "file:_rels/.rels"]);
  });
});

describe("ancestorKeys", () => {
  it("lists folders outermost first", () => {
    expect(ancestorKeys("word/media/a.png")).toEqual(["dir:word", "dir:word/media"]);
    expect(ancestorKeys("a.xml")).toEqual([]);
  });
});

describe("formatSize", () => {
  it("is human readable", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(12 * 1024)).toBe("12 KB");
    expect(formatSize(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(formatSize(-1)).toBe("");
  });
});
