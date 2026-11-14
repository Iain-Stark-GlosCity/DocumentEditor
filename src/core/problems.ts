/**
 * Problem checking, as a format sees it: a source that turns the document into diagnostics
 * (syntax errors and so on), shown by CodeMirror's lint machinery.
 *
 * A format calls `problemChecking` once. Besides the checker itself, the result carries a marker
 * that the workbench reads (`problemStatusOf`) to know that a document can be checked and what
 * the latest check found. That is how the status bar knows whether to show a problem count
 * without importing any format (CLAUDE.md rule 4).
 *
 * The lint machinery (`@codemirror/lint`) is loaded when the editor first needs it, so it stays
 * out of the startup bundle and the render worker (rule 6). This file imports none of it.
 *
 * Plain TypeScript over CodeMirror: no React and no Tauri (rule 3).
 */
import type { Diagnostic } from "@codemirror/lint";
import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { lazyExtension } from "./lazy-extension";

/** Documents above this many characters are not checked. */
export const PROBLEM_CHECK_LIMIT = 2_000_000;
/** Quiet time after the last edit before a check starts. */
export const PROBLEM_CHECK_DELAY_MS = 500;

export interface ProblemCheckingOptions {
  /** Sync or async. The document is never longer than `limit`. Offsets are into the document. */
  source(state: EditorState): readonly Diagnostic[] | Promise<readonly Diagnostic[]>;
  /** Default `PROBLEM_CHECK_LIMIT`. */
  limit?: number;
  /** Default `PROBLEM_CHECK_DELAY_MS`. */
  delay?: number;
}

/** What the latest check found, and whether it is still current. */
export interface ProblemStatus {
  /** `checking`: the text changed since the counts were taken. `skipped`: too large to check. */
  phase: "checking" | "done" | "skipped";
  errors: number;
  /** Warnings, notes and hints. */
  others: number;
}

/** The largest document checked. Present only in editors whose format checks for problems. */
const limitFacet = Facet.define<number, number | null>({
  combine: (values) => values[0] ?? null,
});

const checkFinished = StateEffect.define<{ errors: number; others: number }>();

const tooLarge = (state: EditorState, length: number) =>
  length > (state.facet(limitFacet) ?? PROBLEM_CHECK_LIMIT);

const statusField = StateField.define<ProblemStatus>({
  create: (state) => ({
    phase: tooLarge(state, state.doc.length) ? "skipped" : "checking",
    errors: 0,
    others: 0,
  }),
  update(value, tr) {
    if (tr.docChanged) {
      return tooLarge(tr.state, tr.newDoc.length)
        ? { phase: "skipped", errors: 0, others: 0 }
        : { ...value, phase: "checking" };
    }
    for (const effect of tr.effects) {
      if (effect.is(checkFinished)) return { phase: "done", ...effect.value };
    }
    return value;
  },
});

/** The problem status of an editor state, or `null` when its format has no checker. */
export function problemStatusOf(state: EditorState): ProblemStatus | null {
  return state.facet(limitFacet) === null ? null : (state.field(statusField, false) ?? null);
}

/** Records the outcome of a check, if the document is still the one that was checked. */
export function recordCheck(
  view: EditorView,
  checked: EditorState["doc"],
  found: readonly Diagnostic[],
): void {
  try {
    if (view.state.doc !== checked) return;
    const errors = found.filter((d) => d.severity === "error").length;
    view.dispatch({ effects: checkFinished.of({ errors, others: found.length - errors }) });
  } catch {
    // The editor was closed in the meantime.
  }
}

/**
 * The editor extensions for a format with problem checking: squiggles, a gutter marker, the
 * lint panel and the marker the status bar reads. Documents above the limit are not checked.
 */
export function problemChecking(options: ProblemCheckingOptions): Extension {
  return [
    limitFacet.of(options.limit ?? PROBLEM_CHECK_LIMIT),
    statusField,
    lazyExtension(() => import("./problem-checking").then((m) => m.lintExtension(options))),
  ];
}

/**
 * Gives a diagnostic at least one character to underline, kept inside a document of `length`
 * characters. A zero-width range at the end of the text falls back on the last character.
 */
export function widen(from: number, to: number, length: number): { from: number; to: number } {
  const start = Math.min(Math.max(from, 0), length);
  const end = Math.min(Math.max(to, start), length);
  if (end > start) return { from: start, to: end };
  if (start < length) return { from: start, to: start + 1 };
  return { from: Math.max(0, length - 1), to: length };
}
