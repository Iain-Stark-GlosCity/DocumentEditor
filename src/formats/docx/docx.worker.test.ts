import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./docx.worker";

afterEach(() => {
  vi.restoreAllMocks();
  window.onmessage = null;
});

/** Loads the worker entry in this thread, with `self.postMessage` captured. */
async function load(failFirstPost = false) {
  vi.resetModules();
  const sent: WorkerResponse[] = [];
  let first = true;
  vi.spyOn(window, "postMessage").mockImplementation(((message: WorkerResponse) => {
    if (failFirstPost && first && message.ok) {
      first = false;
      throw new Error("could not clone");
    }
    sent.push(message);
  }) as typeof window.postMessage);
  await import("./docx.worker");
  const request = (id: number, op: WorkerRequest["op"]) =>
    window.onmessage?.({
      data: { id, op, bytes: new Uint8Array([1, 2, 3]), args: { path: "x.docx" } },
    } as unknown as MessageEvent);
  return { sent, request };
}

describe("the DOCX worker entry", () => {
  it("answers with the result, or with the error message, under the request's id", async () => {
    const { sent, request } = await load();
    request(1, "inspect");
    request(2, "decode");
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    const byId = Object.fromEntries(sent.map((m) => [m.id, m]));
    expect(byId[1]).toMatchObject({ ok: true });
    expect(byId[2]).toMatchObject({ ok: false });
  });

  it("still answers when the result cannot be sent", async () => {
    const { sent, request } = await load(true);
    request(7, "inspect");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ id: 7, ok: false, message: "could not clone" });
  });
});
