import { describe, expect, it } from "vitest";
import { eolStyleName, isStaleOnDisk, judgeDiskChange } from "./disk-change";

describe("eolStyleName", () => {
  it("names the styles", () => {
    expect(eolStyleName("crlf")).toBe("Windows (CRLF)");
    expect(eolStyleName("lf")).toBe("Unix (LF)");
  });
});

const base = {
  knownModifiedMs: 10,
  diskModifiedMs: 20,
  diskText: "disk",
  bufferText: "buffer",
  dirty: false,
  missing: false,
};

describe("judgeDiskChange", () => {
  it("ignores an unchanged modified time", () => {
    expect(judgeDiskChange({ ...base, diskModifiedMs: 10 })).toBe("unchanged");
  });
  it("adopts identical content", () => {
    expect(judgeDiskChange({ ...base, bufferText: "disk", dirty: true })).toBe("identical");
  });
  it("reloads a clean buffer", () => {
    expect(judgeDiskChange(base)).toBe("reload");
  });
  it("flags a conflict for a dirty buffer or a missing file that came back", () => {
    expect(judgeDiskChange({ ...base, dirty: true })).toBe("conflict");
    expect(judgeDiskChange({ ...base, diskModifiedMs: 10, missing: true })).toBe("conflict");
  });
});

describe("isStaleOnDisk", () => {
  it("is stale only when time differs and content differs from what we write", () => {
    expect(isStaleOnDisk(1, 1, "a", "b")).toBe(false);
    expect(isStaleOnDisk(1, 2, "a", "b")).toBe(true);
    expect(isStaleOnDisk(1, 2, "b", "b")).toBe(false);
  });
});
