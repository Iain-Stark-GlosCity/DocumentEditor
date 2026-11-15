/**
 * Web Worker entry: reading, checking and explaining a Word file off the main thread, so a large
 * document never freezes typing or scrolling.
 */
import { runDocxOp, type DocxOp } from "./docx-ops";

export interface WorkerRequest {
  id: number;
  op: DocxOp;
  bytes: Uint8Array;
  args: never;
}
export type WorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  const { id, op, bytes, args } = event.data;
  const fail = (error: unknown) =>
    scope.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  runDocxOp(op, bytes, args).then((result) => {
    try {
      scope.postMessage({ id, ok: true, result });
    } catch (error) {
      fail(error); // A result that cannot be cloned must still answer the call.
    }
  }, fail);
};
