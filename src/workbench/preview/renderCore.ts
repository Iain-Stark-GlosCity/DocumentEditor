/**
 * What a render request is, and how one is run. Shared by the worker and by the in-thread
 * fallback, so both produce identical HTML. Everything here is serialisable and free of the DOM.
 */
import type { RenderContext } from "../../core/format";
import type { FormatRegistry } from "../../core/registry";
import { assetPlaceholder } from "./paths";

export interface RenderRequest {
  /** Increases with every request; a result for anything but the newest is stale. */
  seq: number;
  providerId: string;
  text: string;
  /** Absolute path of the document, or null if it has never been saved. */
  path: string | null;
  /** Settings of the provider (keys starting `<providerId>.`), as `RenderContext.settings`. */
  settings?: Readonly<Record<string, boolean | number | string>>;
}

export type RenderResponse =
  | { seq: number; ok: true; html: string }
  | { seq: number; ok: false; message: string; unknownProvider: boolean };

/**
 * The context a provider renders with. `resolveAsset` is a pure function of the document path,
 * so it works inside a worker; it yields placeholders the main thread swaps for real URLs.
 */
export function renderContext(
  path: string | null,
  signal?: AbortSignal,
  settings?: RenderRequest["settings"],
): RenderContext {
  return { path, resolveAsset: (relative) => assetPlaceholder(path, relative), signal, settings };
}

export async function runRender(
  registry: FormatRegistry,
  request: RenderRequest,
  signal?: AbortSignal,
): Promise<RenderResponse> {
  const provider = registry.byId(request.providerId);
  if (!provider?.render) {
    return {
      seq: request.seq,
      ok: false,
      message: `No preview for format "${request.providerId}"`,
      unknownProvider: true,
    };
  }
  try {
    const { html } = await provider.render(
      request.text,
      renderContext(request.path, signal, request.settings),
    );
    return { seq: request.seq, ok: true, html };
  } catch (error) {
    return {
      seq: request.seq,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      unknownProvider: false,
    };
  }
}
