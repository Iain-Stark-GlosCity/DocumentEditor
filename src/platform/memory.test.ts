import { describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "./memory";
import type { FileFormat } from "./platform";

const utf16: FileFormat = { encoding: "utf-16le", bom: true, eol: "lf", mixedEol: false };

describe("MemoryPlatform", () => {
  it("reads what was seeded and rejects missing files", async () => {
    const p = new MemoryPlatform();
    p.seedFile("/a.md", "hi", utf16);
    const data = await p.readFile("/a.md");
    expect(data.text).toBe("hi");
    expect(data.format).toEqual(utf16);
    await expect(p.readFile("/nope.md")).rejects.toThrow(/not found/);
  });

  it("writes text with its format and advances modifiedMs", async () => {
    const p = new MemoryPlatform();
    const first = await p.writeFile("/a.md", "one", utf16);
    const second = await p.writeFile("/a.md", "two", utf16);
    expect(second.modifiedMs).toBeGreaterThan(first.modifiedMs);
    expect(p.files.get("/a.md")).toMatchObject({ text: "two", format: utf16 });
    expect((await p.readFile("/a.md")).modifiedMs).toBe(second.modifiedMs);
  });

  it("returns queued dialog results, and cancel values when the queue is empty", async () => {
    const p = new MemoryPlatform();
    expect(await p.showOpenDialog({ filters: [], multiple: true })).toEqual([]);
    expect(await p.showSaveDialog()).toBeNull();
    p.queueOpenDialog(["/a.md", "/b.md"]);
    p.queueOpenDialog(["/a.md", "/b.md"]);
    expect(await p.showOpenDialog({ filters: [], multiple: true })).toEqual(["/a.md", "/b.md"]);
    expect(await p.showOpenDialog({ filters: [], multiple: false })).toEqual(["/a.md"]);
    p.queueSaveDialog("/c.md");
    expect(await p.showSaveDialog()).toBe("/c.md");
  });

  it("notifies file watchers until they are stopped", async () => {
    const p = new MemoryPlatform();
    const onChange = vi.fn();
    const stop = await p.watchFile("/a.md", onChange);
    p.triggerFileChange("/a.md");
    p.triggerFileChange("/other.md");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ path: "/a.md", kind: "modified" });
    stop();
    p.triggerFileChange("/a.md", "removed");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("stores, lists and clears recovery snapshots", async () => {
    const p = new MemoryPlatform();
    await p.writeRecovery({ id: "d1", path: null, text: "draft", savedMs: 1 });
    expect(await p.listRecovery()).toEqual([{ id: "d1", path: null, text: "draft", savedMs: 1 }]);
    await p.clearRecovery("d1");
    expect(await p.listRecovery()).toEqual([]);
  });

  it("queues open requests until a handler registers, then delivers live", async () => {
    const p = new MemoryPlatform();
    p.requestOpen(["/early.md"]);
    const handler = vi.fn();
    const stop = await p.onOpenRequest(handler);
    expect(handler).toHaveBeenCalledWith(["/early.md"]);
    p.requestOpen(["/late.md"]);
    expect(handler).toHaveBeenLastCalledWith(["/late.md"]);
    stop();
    p.requestOpen(["/queued-again.md"]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("asks the close handler, and records the window title", async () => {
    const p = new MemoryPlatform();
    expect(await p.requestClose()).toBe(true);
    await p.onCloseRequested(async () => false);
    expect(await p.requestClose()).toBe(false);
    await p.setWindowTitle("Hello");
    expect(p.windowTitle).toBe("Hello");
  });
});
