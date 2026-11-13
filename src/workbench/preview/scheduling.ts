/** Timing rules for the preview. Pure, so they are easy to test and to tune. */

/** A render slower than this shows the "Rendering" indicator. */
export const SLOW_RENDER_MS = 300;

const MIN_DEBOUNCE_MS = 50;
const MAX_DEBOUNCE_MS = 2000;
/** Rough cost of rendering before any has been measured: the pipeline does ~1 MB in ~5 s. */
const GUESS_MS_PER_CHARACTER = 0.005;

/**
 * How long to wait after the last keystroke before rendering. Short for small documents so the
 * preview feels live; longer as renders get slower, so typing never queues up work that is
 * thrown away. `lastRenderMs` is the measured duration of the last render, or null if none yet.
 */
export function debounceMs(lastRenderMs: number | null, textLength: number): number {
  const estimate = lastRenderMs ?? textLength * GUESS_MS_PER_CHARACTER;
  return Math.round(Math.min(MAX_DEBOUNCE_MS, Math.max(MIN_DEBOUNCE_MS, estimate * 0.75)));
}
