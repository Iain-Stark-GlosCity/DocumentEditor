/**
 * Problems: the count in the status bar, the problems panel and keys to step through them.
 *
 * It knows nothing about any format. A document has problems to show when its format put
 * `problemChecking` (src/core/problems.ts) in the editor, and the diagnostics themselves come
 * from CodeMirror's lint state. A document of a format with no checker shows nothing and its
 * problem commands are disabled, so their keys fall through.
 */
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { problemStatusOf } from "../../core/problems";
import type { Command } from "../../core/commands";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveEditorState } from "../hooks";
import type { Workbench } from "../workbench";

// The lint library is loaded when a command first needs it, not at start-up (CLAUDE.md rule 6).
const loadLint = () => import("@codemirror/lint");

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export interface ProblemSummary {
  /** What the status bar says. */
  label: string;
  /** Longer wording for the tooltip and the accessible name. */
  detail: string;
}

/** The status wording for a state, or null when its format has no checker. */
export function summariseProblems(state: EditorState): ProblemSummary | null {
  const status = problemStatusOf(state);
  if (status === null) return null;
  if (status.phase === "skipped") {
    return {
      label: "Too large to check",
      detail: "This document is too large to check for problems",
    };
  }
  const total = status.errors + status.others;
  if (total === 0) {
    return status.phase === "checking"
      ? { label: "Checking…", detail: "Checking for problems" }
      : { label: "No problems", detail: "No problems found" };
  }
  const parts = [
    status.errors > 0 && count(status.errors, "error", "errors"),
    status.others > 0 && count(status.others, "warning or hint", "warnings or hints"),
  ].filter(Boolean);
  const label = count(total, "problem", "problems");
  return { label, detail: `${label}: ${parts.join(", ")}` };
}

const panelOpen = (view: EditorView) => view.dom.querySelector(".cm-panel-lint") !== null;

function ProblemsStatus({ workbench }: FeatureComponentProps) {
  const state = useActiveEditorState(workbench);
  const summary = state ? summariseProblems(state) : null;
  if (summary === null) return null;
  return (
    <button
      type="button"
      className="problems-button"
      aria-label={`${summary.detail}. Show the problems panel`}
      title={`${summary.detail} (Ctrl+Shift+M)`}
      onClick={() => void workbench.runCommand("view.problems")}
    >
      {summary.label}
    </button>
  );
}

function commands(wb: Workbench): readonly Command[] {
  const checked = () => {
    const state = wb.activeEditorState();
    return !!wb.activeView() && state !== null && problemStatusOf(state) !== null;
  };
  const step = (which: "nextDiagnostic" | "previousDiagnostic") => async (): Promise<void> => {
    const lint = await loadLint();
    const view = wb.activeView();
    if (view) {
      lint[which](view);
      view.focus();
    }
  };
  return [
    {
      id: "edit.nextProblem",
      title: "Go to next problem",
      defaultKey: "F8",
      enabled: checked,
      run: step("nextDiagnostic"),
    },
    {
      id: "edit.previousProblem",
      title: "Go to previous problem",
      defaultKey: "Shift-F8",
      enabled: checked,
      run: step("previousDiagnostic"),
    },
    {
      id: "view.problems",
      title: "Problems",
      defaultKey: "Mod-Shift-m",
      enabled: checked,
      async run() {
        const lint = await loadLint();
        const view = wb.activeView();
        if (!view) return;
        if (panelOpen(view)) {
          lint.closeLintPanel(view);
          view.focus();
        } else {
          lint.openLintPanel(view);
        }
      },
    },
  ];
}

export const problems: Feature = {
  id: "problems",
  statusItems: [{ id: "problems", align: "right", order: 6, component: ProblemsStatus }],
  commands,
  activate(wb) {
    // A format's `<name>.lint` setting adds or removes its checker, so rebuild the format's
    // editor extensions when one changes.
    return wb.settings.subscribeAll((key) => {
      if (key.endsWith(".lint")) wb.reconfigureEditors("provider");
    });
  },
  menuItems: [
    {
      menu: "view",
      group: "6_problems",
      command: "view.problems",
      order: 1,
      checked: (wb) => {
        const view = wb.activeView();
        return view !== null && panelOpen(view);
      },
    },
    { menu: "view", group: "6_problems", command: "edit.nextProblem", order: 2 },
    { menu: "view", group: "6_problems", command: "edit.previousProblem", order: 3 },
  ],
};
