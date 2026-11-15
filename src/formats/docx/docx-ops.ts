/**
 * The three heavy DOCX operations, in one place so the worker and the in-thread fallback run the
 * same code. Each is loaded with `import()` so none of it is in the startup bundle.
 */
import type { DecodedView } from "../../core/format";
import type { Explanation } from "../../core/explain";
import type { Finding } from "../../core/findings";

export interface DocxOps {
  decode: { args: { path: string }; result: DecodedView };
  inspect: { args: { path: string }; result: Finding[] };
  explain: { args: { path: string; part: string; locator: string }; result: Explanation | null };
}

export type DocxOp = keyof DocxOps;

export async function runDocxOp<K extends DocxOp>(
  op: K,
  bytes: Uint8Array,
  args: DocxOps[K]["args"],
): Promise<DocxOps[K]["result"]> {
  switch (op) {
    case "decode": {
      const { decodeDocx } = await import("./decode");
      return (await decodeDocx(bytes, args)) as DocxOps[K]["result"];
    }
    case "inspect": {
      const { inspectDocxBytes } = await import("./inspect");
      return (await inspectDocxBytes(bytes, args)) as DocxOps[K]["result"];
    }
    case "explain": {
      const { explainDocxBytes } = await import("./explain-bytes");
      return (await explainDocxBytes(
        bytes,
        args as DocxOps["explain"]["args"],
      )) as DocxOps[K]["result"];
    }
  }
  throw new Error(`Unknown operation ${String(op)}`);
}
