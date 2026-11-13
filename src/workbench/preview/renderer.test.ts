import { describe, expect, it, vi } from "vitest";
import type { TextFormatProvider } from "../../core/format";
import { FormatRegistry } from "../../core/registry";
import type { RenderRequest, RenderResponse } from "./renderCore";
import { createRenderer, SupersededError, type WorkerLike } from "./renderer";

function registryWith(render: TextFormatProvider["render"]): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    kind: "text",
    id: "md",
    name: "Markdown",
    fileExtensions: ["md"],
    viewModes: ["source", "split"],
    editorExtensions: () => [],
    render,
  });
  return registry;
}

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<RenderResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: RenderRequest[] = [];
  terminated = false;
  postMessage(message: RenderRequest) {
    this.received.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(response: RenderResponse) {
    this.onmessage?.({ data: response } as MessageEvent<RenderResponse>);
  }
}

const request = (text: string) => ({ providerId: "md", text, path: null });

describe("in-thread rendering (no worker available)", () => {
  it("renders through the provider, with a context that resolves assets", async () => {
    const render = vi.fn(async (text: string, context: { resolveAsset(p: string): string }) => ({
      html: `${text}|${context.resolveAsset("a.png")}`,
    }));
    const renderer = createRenderer(registryWith(render), { createWorker: () => null });
    const html = await renderer.render({ providerId: "md", text: "x", path: "C:\\d\\n.md" });
    expect(html).toBe(`x|asset://doc/${encodeURIComponent("C:\\d\\a.png")}`);
  });

  it("supersedes an earlier render and aborts it", async () => {
    const signals: AbortSignal[] = [];
    const renderer = createRenderer(
      registryWith(async (text, context) => {
        if (context.signal) signals.push(context.signal);
        await new Promise((resolve) => setTimeout(resolve, text === "slow" ? 30 : 0));
        return { html: text };
      }),
      { createWorker: () => null },
    );
    const first = renderer.render(request("slow"));
    const firstOutcome = first.then(
      () => "resolved",
      (e: unknown) => (e instanceof SupersededError ? "superseded" : "failed"),
    );
    const second = renderer.render(request("fast"));
    expect(await second).toBe("fast");
    expect(await firstOutcome).toBe("superseded");
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("reports a provider failure", async () => {
    const renderer = createRenderer(
      registryWith(async () => {
        throw new Error("boom");
      }),
      { createWorker: () => null },
    );
    await expect(renderer.render(request("x"))).rejects.toThrow("boom");
  });

  it("refuses work after dispose", async () => {
    const renderer = createRenderer(
      registryWith(async () => ({ html: "" })),
      {
        createWorker: () => null,
      },
    );
    renderer.dispose();
    await expect(renderer.render(request("x"))).rejects.toBeInstanceOf(SupersededError);
  });
});

describe("rendering in a worker", () => {
  const unused = registryWith(async () => ({ html: "in-thread" }));

  it("posts the request and resolves with the reply to the newest one only", async () => {
    const worker = new FakeWorker();
    const renderer = createRenderer(unused, { createWorker: () => worker, restartAfterMs: 10_000 });
    const first = renderer.render(request("one"));
    const firstOutcome = first.catch((e: unknown) => e);
    const second = renderer.render(request("two"));
    expect(worker.received.map((r) => r.text)).toEqual(["one", "two"]);

    // The stale reply arrives first and is discarded; the newest one resolves.
    worker.reply({ seq: worker.received[0]!.seq, ok: true, html: "<p>one</p>" });
    worker.reply({ seq: worker.received[1]!.seq, ok: true, html: "<p>two</p>" });
    expect(await second).toBe("<p>two</p>");
    expect(await firstOutcome).toBeInstanceOf(SupersededError);
    expect(worker.terminated).toBe(false);
  });

  it("restarts the worker to cancel a render that has been running a while", async () => {
    const workers: FakeWorker[] = [];
    const renderer = createRenderer(unused, {
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      restartAfterMs: 0,
    });
    void renderer.render(request("one")).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = renderer.render(request("two"));
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    workers[1]!.reply({ seq: workers[1]!.received[0]!.seq, ok: true, html: "2" });
    expect(await second).toBe("2");
  });

  it("falls back to rendering here if the worker does not know the provider", async () => {
    const worker = new FakeWorker();
    const renderer = createRenderer(unused, { createWorker: () => worker });
    const result = renderer.render(request("x"));
    worker.reply({ seq: worker.received[0]!.seq, ok: false, message: "?", unknownProvider: true });
    expect(await result).toBe("in-thread");
  });

  it("falls back to rendering here, for good, if the worker fails to run", async () => {
    const worker = new FakeWorker();
    const create = vi.fn(() => worker);
    const renderer = createRenderer(unused, { createWorker: create });
    const result = renderer.render(request("x"));
    worker.onerror?.({} as ErrorEvent);
    expect(await result).toBe("in-thread");
    expect(await renderer.render(request("y"))).toBe("in-thread");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
