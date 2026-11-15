import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerResponse } from "./docx.worker";

type Client = typeof import("./worker-client");

const GARBAGE = new Uint8Array([1, 2, 3]);
const UNREADABLE = expect.arrayContaining([
  expect.objectContaining({ rule: "package.unreadable" }),
]);

describe("callDocx without a Worker (as in these tests)", () => {
  it("runs on the calling thread and passes a damaged-file error through", async () => {
    const { callDocx } = await import("./worker-client");
    await expect(callDocx("inspect", GARBAGE, { path: "x.docx" })).resolves.toEqual(UNREADABLE);
    await expect(callDocx("decode", GARBAGE, { path: "x.docx" })).rejects.toThrow();
  });
});

/** A stand-in for `Worker` that the test drives by hand. */
class FakeWorker {
  static all: FakeWorker[] = [];
  static throwOnConstruct = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  posted: { id: number; op: string }[] = [];
  terminated = false;
  throwOnPost: Error | null = null;
  constructor() {
    if (FakeWorker.throwOnConstruct) throw new Error("no workers here");
    FakeWorker.all.push(this);
  }
  postMessage(message: { id: number; op: string }) {
    if (this.throwOnPost) throw this.throwOnPost;
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(response: WorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}

async function load(): Promise<Client> {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  return import("./worker-client");
}

beforeEach(() => {
  FakeWorker.all = [];
  FakeWorker.throwOnConstruct = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("callDocx with a worker", () => {
  it("sends the request and resolves with the worker's result", async () => {
    const { callDocx } = await load();
    const call = callDocx("inspect", GARBAGE, { path: "x.docx" });
    const worker = FakeWorker.all[0]!;
    expect(worker.posted).toHaveLength(1);
    worker.reply({ id: worker.posted[0]!.id, ok: true, result: [] });
    await expect(call).resolves.toEqual([]);
  });

  it("answers overlapping calls by id, whichever finishes first", async () => {
    const { callDocx } = await load();
    const first = callDocx("inspect", GARBAGE, { path: "a.docx" });
    const second = callDocx("inspect", GARBAGE, { path: "b.docx" });
    const worker = FakeWorker.all[0]!;
    expect(FakeWorker.all).toHaveLength(1);
    const [a, b] = worker.posted;
    worker.reply({ id: b!.id, ok: true, result: ["b"] });
    worker.reply({ id: a!.id, ok: true, result: ["a"] });
    await expect(first).resolves.toEqual(["a"]);
    await expect(second).resolves.toEqual(["b"]);
  });

  it("passes an error from the operation through, and keeps using the worker", async () => {
    const { callDocx } = await load();
    const call = callDocx("decode", GARBAGE, { path: "x.docx" });
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: worker.posted[0]!.id, ok: false, message: "damaged" });
    await expect(call).rejects.toThrow("damaged");
    const next = callDocx("inspect", GARBAGE, { path: "x.docx" });
    expect(FakeWorker.all).toHaveLength(1);
    worker.reply({ id: worker.posted[1]!.id, ok: true, result: [] });
    await expect(next).resolves.toEqual([]);
  });

  it("ignores a reply nobody is waiting for", async () => {
    const { callDocx } = await load();
    const call = callDocx("inspect", GARBAGE, { path: "x.docx" });
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: 999, ok: true, result: "stray" });
    worker.reply({ id: worker.posted[0]!.id, ok: true, result: [] });
    await expect(call).resolves.toEqual([]);
  });

  it("ends the worker after a quiet spell and starts a new one on the next call", async () => {
    vi.useFakeTimers();
    const { callDocx, IDLE_MS } = await load();
    const call = callDocx("inspect", GARBAGE, { path: "x.docx" });
    const first = FakeWorker.all[0]!;
    first.reply({ id: first.posted[0]!.id, ok: true, result: [] });
    await call;
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(first.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(first.terminated).toBe(true);

    const again = callDocx("inspect", GARBAGE, { path: "x.docx" });
    expect(FakeWorker.all).toHaveLength(2);
    const second = FakeWorker.all[1]!;
    second.reply({ id: second.posted[0]!.id, ok: true, result: [] });
    await expect(again).resolves.toEqual([]);
  });

  it("does not end the worker while a call is still running", async () => {
    vi.useFakeTimers();
    const { callDocx, IDLE_MS } = await load();
    const call = callDocx("inspect", GARBAGE, { path: "x.docx" });
    const worker = FakeWorker.all[0]!;
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(worker.terminated).toBe(false);
    worker.reply({ id: worker.posted[0]!.id, ok: true, result: [] });
    await expect(call).resolves.toEqual([]);
  });

  it("re-runs every call in flight on the calling thread when the worker fails, and keeps working", async () => {
    const { callDocx } = await load();
    const first = callDocx("inspect", GARBAGE, { path: "a.docx" });
    const second = callDocx("inspect", GARBAGE, { path: "b.docx" });
    const worker = FakeWorker.all[0]!;
    worker.onerror?.(new Event("error"));
    expect(worker.terminated).toBe(true);
    await expect(first).resolves.toEqual(UNREADABLE);
    await expect(second).resolves.toEqual(UNREADABLE);
    // Later calls run in-thread and never start another worker.
    await expect(callDocx("inspect", GARBAGE, { path: "c.docx" })).resolves.toEqual(UNREADABLE);
    expect(FakeWorker.all).toHaveLength(1);
  });

  it("treats a reply that cannot be read like a failed worker", async () => {
    const { callDocx } = await load();
    const call = callDocx("inspect", GARBAGE, { path: "a.docx" });
    FakeWorker.all[0]!.onmessageerror?.(new Event("messageerror"));
    await expect(call).resolves.toEqual(UNREADABLE);
  });

  it("does not leave a call waiting when its request cannot be sent", async () => {
    vi.useFakeTimers();
    const { callDocx, IDLE_MS } = await load();
    const ok = callDocx("inspect", GARBAGE, { path: "a.docx" });
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: worker.posted[0]!.id, ok: true, result: [] });
    await ok;
    worker.throwOnPost = new Error("cannot clone");
    await expect(callDocx("inspect", GARBAGE, { path: "b.docx" })).rejects.toThrow("cannot clone");
    // Nothing is left waiting, so the quiet-spell timer can still end the worker.
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(worker.terminated).toBe(true);
  });

  it("falls back to the calling thread when a worker cannot be created", async () => {
    FakeWorker.throwOnConstruct = true;
    const { callDocx } = await load();
    await expect(callDocx("inspect", GARBAGE, { path: "x.docx" })).resolves.toEqual(UNREADABLE);
  });
});
