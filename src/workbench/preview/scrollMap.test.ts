import { describe, expect, it } from "vitest";
import { buildScrollMap, lineToOffset, offsetToLine } from "./scrollMap";

// Three blocks: lines 1-4 (100px), 5-7 (50px), 8-20 (400px, a tall code fence); 20 lines in all.
const typical = buildScrollMap(
  [
    { line: 1, offset: 0 },
    { line: 5, offset: 100 },
    { line: 8, offset: 150 },
  ],
  20,
  550,
);

describe("an empty document", () => {
  const map = buildScrollMap([], 1, 0);
  it("maps everything to the top", () => {
    expect(lineToOffset(map, 1)).toBe(0);
    expect(lineToOffset(map, 50)).toBe(0);
    expect(offsetToLine(map, 0)).toBe(1);
    expect(offsetToLine(map, 500)).toBe(1);
  });
});

describe("a position before the first block", () => {
  it("maps the lines above it (front matter) onto the space above it", () => {
    const map = buildScrollMap([{ line: 6, offset: 40 }], 10, 200);
    expect(lineToOffset(map, 1)).toBe(0);
    expect(lineToOffset(map, 3.5)).toBeCloseTo(20);
    expect(offsetToLine(map, 20)).toBeCloseTo(3.5);
    expect(offsetToLine(map, 0)).toBe(1);
  });

  it("clamps above the first line", () => {
    expect(lineToOffset(typical, 0)).toBe(0);
    expect(offsetToLine(typical, -30)).toBe(1);
  });
});

describe("a position after the last block", () => {
  it("runs from the last block's start to the end of the content", () => {
    // Line 8 is at 150px and the end (line 21) at 550px: line 14.5 is half way.
    expect(lineToOffset(typical, 14.5)).toBeCloseTo(350);
    expect(offsetToLine(typical, 350)).toBeCloseTo(14.5);
  });

  it("clamps beyond the end", () => {
    expect(lineToOffset(typical, 999)).toBe(550);
    expect(offsetToLine(typical, 9999)).toBe(21);
  });
});

describe("a position between blocks", () => {
  it("interpolates by fraction within a block", () => {
    expect(lineToOffset(typical, 3)).toBeCloseTo(50);
    expect(lineToOffset(typical, 5)).toBe(100);
    expect(lineToOffset(typical, 6.5)).toBeCloseTo(125);
    expect(offsetToLine(typical, 50)).toBeCloseTo(3);
    expect(offsetToLine(typical, 100)).toBe(5);
  });

  it("round-trips", () => {
    for (const line of [1, 2.25, 4.9, 5, 7.5, 8, 13.3, 20.9]) {
      expect(offsetToLine(typical, lineToOffset(typical, line))).toBeCloseTo(line);
    }
  });
});

describe("blocks of very different heights", () => {
  it("covers a tall block slowly and a short one quickly", () => {
    const map = buildScrollMap(
      [
        { line: 1, offset: 0 },
        { line: 2, offset: 10 },
        { line: 3, offset: 2010 },
        { line: 4, offset: 2030 },
      ],
      4,
      2030,
    );
    // Line 2 to 3 spans 2000px: a quarter of a line is 500px.
    expect(lineToOffset(map, 2.25)).toBeCloseTo(510);
    // Line 1 to 2 spans 10px.
    expect(lineToOffset(map, 1.5)).toBeCloseTo(5);
    expect(offsetToLine(map, 1010)).toBeCloseTo(2.5);
  });

  it("copes with a block of zero height", () => {
    const map = buildScrollMap(
      [
        { line: 1, offset: 0 },
        { line: 2, offset: 50 },
        { line: 3, offset: 50 },
        { line: 4, offset: 100 },
      ],
      5,
      150,
    );
    expect(Number.isFinite(offsetToLine(map, 50))).toBe(true);
    expect(offsetToLine(map, 50)).toBe(3);
    expect(offsetToLine(map, 75)).toBeCloseTo(3.5);
  });
});

describe("untidy input", () => {
  it("drops anchors that go backwards or repeat a line, and offsets that go up the page", () => {
    const map = buildScrollMap(
      [
        { line: 1, offset: 0 },
        { line: 4, offset: 100 },
        { line: 4, offset: 120 },
        { line: 2, offset: 130 },
        { line: 6, offset: 90 },
      ],
      6,
      200,
    );
    expect(map.anchors.map((a) => a.line)).toEqual([1, 4, 6, 7]);
    expect(map.anchors.map((a) => a.offset)).toEqual([0, 100, 100, 200]);
  });
});
