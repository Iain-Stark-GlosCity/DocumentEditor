/**
 * Runs renders off the main thread when it can, and in-thread when it cannot (tests, or a
 * webview that refuses the worker), behind one interface. Only the newest request ever resolves.
 */
import type { FormatRegistry } from "../../core/registry";
import { runRender, type RenderRequest, type RenderResponse } from "./renderCore";

/** The newest request replaced this one before it finished. Not a failure. */
export class SupersededError extends Error {
  constructor() {
    super("The render was superseded");
    this.name = "SupersededError";
  }
}

export interface PreviewRenderer {
  /** Resolves with HTML, or rejects with `SupersededError` if a newer call (or `dispose`) came first. */
  render(request: Omit<RenderRequest, "seq">): Promise<string>;
  dispose(): void;
}

/** The part of `Worker` this module uses, so tests can supply a stand-in. */
export interface WorkerLike {
  postMessage(message: RenderRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<RenderResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface RendererOptions {
  /**
   * Makes a worker, or returns null for in-thread rendering. Default: the module worker bundled
   * by Vite where `Worker` exists.
   */
  createWorker?: () => WorkerLike | null;
  /**
   * A render running longer than this is cancelled by restarting the worker when a newer request
   * arrives. Shorter ones are left to finish (restarting costs a pipeline load) and discarded.
   */
  restartAfterMs?: number;
}

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  // The `new URL(..., import.meta.url)` form inside `new Worker(...)` is what Vite bundles.
  return new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
}

interface Pending {
  seq: number;
  resolve(html: string): void;
  reject(error: Error): void;
  request: Omit<RenderRequest, "seq">;
  startedAt: number;
  abort: AbortController;
}

export function createRenderer(
  registry: FormatRegistry,
  options: RendererOptions = {},
): PreviewRenderer {
  const makeWorker = options.createWorker ?? defaultWorker;
  const restartAfterMs = options.restartAfterMs ?? 100;
  let worker: WorkerLike | null = null;
  let workerUsable = true;
  let pending: Pending | null = null;
  let seq = 0;
  let disposed = false;

  function settle(response: RenderResponse): void {
    const current = pending;
    if (!current || current.seq !== response.seq) return; // Stale: a newer request replaced it.
    pending = null;
    if (response.ok) current.resolve(response.html);
    else current.reject(new Error(response.message));
  }

  function stopWorker(): void {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }

  function startWorker(): WorkerLike | null {
    if (!workerUsable) return null;
    if (worker) return worker;
    try {
      worker = makeWorker();
    } catch {
      worker = null;
    }
    if (!worker) {
      workerUsable = false;
      return null;
    }
    const mine = worker;
    mine.onmessage = (event) => {
      const response = event.data;
      // The worker's registry may not know a provider the app registered later: do it here.
      if (!response.ok && response.unknownProvider && pending?.seq === response.seq) {
        retryInThread(pending);
        return;
      }
      settle(response);
    };
    mine.onerror = () => {
      // A worker that cannot start (blocked by policy, say) is abandoned for good.
      workerUsable = false;
      stopWorker();
      if (pending) retryInThread(pending);
    };
    return mine;
  }

  async function inThread(entry: Pending): Promise<void> {
    settle(await runRender(registry, { seq: entry.seq, ...entry.request }, entry.abort.signal));
  }

  /** Runs a render here, for when the worker cannot (it failed, or does not know the provider). */
  function retryInThread(entry: Pending): void {
    void inThread(entry);
  }

  return {
    render(request) {
      if (disposed) return Promise.reject(new SupersededError());
      const previous = pending;
      if (previous) {
        pending = null;
        previous.abort.abort();
        previous.reject(new SupersededError());
        // Cancelling in a worker means restarting it; only worth it if the render is long.
        if (Date.now() - previous.startedAt > restartAfterMs) stopWorker();
      }
      const id = ++seq;
      return new Promise<string>((resolve, reject) => {
        const entry: Pending = {
          seq: id,
          resolve,
          reject,
          request,
          startedAt: Date.now(),
          abort: new AbortController(),
        };
        pending = entry;
        const target = startWorker();
        if (target) target.postMessage({ seq: id, ...request });
        else void inThread(entry);
      });
    },
    dispose() {
      disposed = true;
      const current = pending;
      pending = null;
      current?.abort.abort();
      current?.reject(new SupersededError());
      stopWorker();
    },
  };
}
