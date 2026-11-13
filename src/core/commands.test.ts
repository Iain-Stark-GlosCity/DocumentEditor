import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./commands";

describe("CommandRegistry", () => {
  it("registers, gets and lists commands", () => {
    const registry = new CommandRegistry();
    const cmd = { id: "file.new", title: "New file", defaultKey: "Mod-n", run: () => {} };
    registry.register(cmd);
    expect(registry.get("file.new")).toBe(cmd);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.all()).toEqual([cmd]);
  });

  it("executes a command, awaiting async work", async () => {
    const registry = new CommandRegistry();
    const done = vi.fn();
    registry.register({
      id: "x",
      title: "X",
      run: async () => {
        await Promise.resolve();
        done();
      },
    });
    await registry.execute("x");
    expect(done).toHaveBeenCalledOnce();
  });

  it("rejects unknown ids and duplicate registration", async () => {
    const registry = new CommandRegistry();
    registry.register({ id: "x", title: "X", run: () => {} });
    expect(() => registry.register({ id: "x", title: "Again", run: () => {} })).toThrow(/already/);
    await expect(registry.execute("nope")).rejects.toThrow(/Unknown command/);
  });

  it("unregisters via the returned disposer", () => {
    const registry = new CommandRegistry();
    const off = registry.register({ id: "x", title: "X", run: () => {} });
    off();
    expect(registry.get("x")).toBeUndefined();
    registry.register({ id: "x", title: "X", run: () => {} });
  });
});
