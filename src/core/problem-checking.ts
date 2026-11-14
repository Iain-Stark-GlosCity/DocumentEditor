/**
 * The lint half of problem checking. Only `problems.ts` imports this, and only dynamically.
 */
import { linter, lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  PROBLEM_CHECK_DELAY_MS,
  PROBLEM_CHECK_LIMIT,
  type ProblemCheckingOptions,
  recordCheck,
} from "./problems";

export function lintExtension(options: ProblemCheckingOptions): Extension {
  const limit = options.limit ?? PROBLEM_CHECK_LIMIT;
  return [
    lintGutter(),
    linter(
      async (view: EditorView) => {
        const doc = view.state.doc;
        if (doc.length > limit) return [];
        const found = await options.source(view.state);
        // The count is recorded just after the diagnostics land, so the status never shows the
        // new count beside the old squiggles.
        setTimeout(() => recordCheck(view, doc, found), 0);
        return found;
      },
      { delay: options.delay ?? PROBLEM_CHECK_DELAY_MS },
    ),
  ];
}
