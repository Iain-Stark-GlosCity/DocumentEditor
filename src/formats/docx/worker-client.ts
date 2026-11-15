/**
 * Runs a DOCX operation in a Web Worker, falling back to the calling thread where there is no
 * worker (tests, or a worker that failed to start). The worker is created on first use and ended
 * after a quiet spell. A newer call never cancels an older one: each has its own id.
 */
import { runDocxOp, type DocxOp, type DocxOps } from "./docx-ops";
import type { WorkerRequest, WorkerResponse } from "./docx.worker";

export const IDLE_MS = 30_000;

interface Waiting {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
let usable = typeof Worker !== "undefined";
let nextId = 1;
const waiting = new Map<number, Waiting>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function stopWorker(failure?: Error): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  worker?.terminate();
  worker = null;
  const all = [...waiting.values()];
  waiting.clear();
  for (const w of all) w.reject(failure ?? new Error("The Word file worker stopped"));
}

function touch(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (waiting.size === 0) stopWorker();
    else touch();
  }, IDLE_MS);
}

function start(): Worker | null {
  if (!usable) return null;
  if (worker) return worker;
  try {
    // The `new URL(..., import.meta.url)` form inside `new Worker(...)` is what Vite bundles.
    const created = new Worker(new URL("./docx.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const entry = waiting.get(response.id);
      if (!entry) return;
      waiting.delete(response.id);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new Error(response.message));
    };
    const fail = (message: string) => {
      if (worker !== created) return; // An earlier worker, already replaced.
      usable = false; // Do not keep retrying a worker that cannot run.
      stopWorker(new Error(message));
    };
    created.onerror = () => fail("The Word file worker failed");
    // A reply that cannot be read would otherwise leave its call waiting for ever.
    created.onmessageerror = () => fail("The Word file worker sent a reply that could not be read");
    worker = created;
    return created;
  } catch {
    usable = false;
    return null;
  }
}

export async function callDocx<K extends DocxOp>(
  op: K,
  bytes: Uint8Array,
  args: DocxOps[K]["args"],
): Promise<DocxOps[K]["result"]> {
  const w = start();
  if (w) {
    const id = nextId++;
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        touch();
        try {
          w.postMessage({ id, op, bytes, args } as unknown as WorkerRequest);
        } catch (error) {
          // The request could not be sent (for example, arguments that cannot be cloned).
          waiting.delete(id);
          throw error;
        }
      });
      return result as DocxOps[K]["result"];
    } catch (error) {
      // A real error from the operation (a damaged file) is the answer; a dead worker is not.
      if (usable) throw error;
    }
  }
  return runDocxOp(op, bytes, args);
}
