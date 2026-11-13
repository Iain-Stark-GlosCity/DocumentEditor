import { describe, expect, it } from "vitest";
import { SyncGate } from "./syncGate";

describe("SyncGate", () => {
  it("lets the first pane to scroll drive and blocks the echo from the other", () => {
    let now = 1000;
    const gate = new SyncGate(100, () => now);
    expect(gate.claim("editor")).toBe(true);
    // The preview scrolls because we moved it: that must not move the editor again.
    now += 5;
    expect(gate.claim("preview")).toBe(false);
    expect(gate.blocked("preview")).toBe(true);
    expect(gate.blocked("editor")).toBe(false);
  });

  it("keeps the master while it keeps scrolling", () => {
    let now = 0;
    const gate = new SyncGate(100, () => now);
    for (let i = 0; i < 10; i++) {
      expect(gate.claim("editor")).toBe(true);
      now += 60;
      expect(gate.claim("preview")).toBe(false);
    }
  });

  it("hands over once the master has been quiet", () => {
    let now = 0;
    const gate = new SyncGate(100, () => now);
    gate.claim("editor");
    now += 101;
    expect(gate.claim("preview")).toBe(true);
    expect(gate.claim("editor")).toBe(false);
  });
});
