import { describe, expect, it } from "vitest";
import { minimalEdit } from "./text-diff";

function apply(before: string, edit: ReturnType<typeof minimalEdit>): string {
  return edit ? before.slice(0, edit.from) + edit.insert + before.slice(edit.to) : before;
}

describe("minimalEdit", () => {
  it("returns null for equal text", () => {
    expect(minimalEdit("same", "same")).toBeNull();
  });

  it("keeps the common prefix and suffix", () => {
    expect(minimalEdit("hello brave world", "hello new world")).toEqual({
      from: 6,
      to: 11,
      insert: "new",
    });
  });

  it("handles insertion, deletion and total replacement", () => {
    for (const [a, b] of [
      ["", "abc"],
      ["abc", ""],
      ["abc", "xyz"],
      ["aaa", "aaaa"],
      ["abab", "ab"],
    ] as const) {
      expect(apply(a, minimalEdit(a, b))).toBe(b);
    }
  });

  it("never splits a surrogate pair", () => {
    const a = "x\u{1F600}y";
    const b = "x\u{1F601}y";
    const edit = minimalEdit(a, b)!;
    expect(apply(a, edit)).toBe(b);
    expect(edit.from).toBe(1);
    expect(edit.to).toBe(3);
  });
});
