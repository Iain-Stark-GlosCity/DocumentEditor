import { describe, expect, it } from "vitest";
import { debounceMs } from "./scheduling";

describe("debounceMs", () => {
  it("is short for a small document", () => {
    expect(debounceMs(null, 2_000)).toBe(50);
    expect(debounceMs(8, 2_000)).toBe(50);
  });

  it("grows with the measured render time", () => {
    expect(debounceMs(400, 0)).toBe(300);
    expect(debounceMs(800, 0)).toBeGreaterThan(debounceMs(400, 0));
  });

  it("estimates from length before anything is measured", () => {
    // About 5 s for 1 MB.
    expect(debounceMs(null, 1_000_000)).toBeGreaterThanOrEqual(1000);
  });

  it("never waits longer than two seconds", () => {
    expect(debounceMs(60_000, 0)).toBe(2000);
  });
});
