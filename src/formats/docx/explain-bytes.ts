/** Bytes of a .docx to the explanation of one element. Loaded with `import()`. */
import { readZip } from "../../core/archive";
import type { Explanation } from "../../core/explain";
import { decodePart } from "./decode";
import { explainWith, prepareExplain, type ExplainContext } from "./explain";

/**
 * The most recent file's parsed package, styles and numbering. The Explain pane asks about one
 * paragraph after another in the same file, and unzipping and parsing is the cost; the answer for
 * a paragraph is cheap once that is done.
 *
 * Safety: an entry is reused only if the incoming bytes are identical, byte for byte, to the copy
 * it was built from. That is a full comparison, not a fingerprint, so a changed file can never be
 * served from the cache, and the entry holds its own copy so a caller that reuses or edits its
 * array cannot make a stale entry look current. The comparison is a single linear pass, far
 * cheaper than unzipping and parsing.
 */
interface Cached {
  bytes: Uint8Array;
  context: ExplainContext;
}

let cached: Cached | null = null;
let builds = 0;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function build(bytes: Uint8Array): Cached {
  const own = bytes.slice();
  builds++;
  const zip = readZip(own);
  const names = zip.entries.filter((e) => !e.isDirectory).map((e) => e.name);
  const context = prepareExplain({
    names: () => names,
    text(name) {
      const info = zip.info(name);
      if (!info || info.isDirectory) return undefined;
      try {
        return decodePart(zip.bytes(name));
      } catch {
        return undefined;
      }
    },
  });
  return { bytes: own, context };
}

/** For tests: how many times a file has been unzipped and set up, and a way to start afresh. */
export function explainCacheBuilds(): number {
  return builds;
}
export function clearExplainCache(): void {
  builds = 0;
  cached = null;
}

export async function explainDocxBytes(
  bytes: Uint8Array,
  context: { path: string; part: string; locator: string },
): Promise<Explanation | null> {
  if (!cached || !sameBytes(cached.bytes, bytes)) {
    cached = null; // Never keep an entry that has been shown to differ.
    cached = build(bytes);
  }
  return explainWith(cached.context, context.part, context.locator);
}
