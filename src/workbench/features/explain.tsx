/**
 * The Explain pane: for the paragraph at the cursor in a generated view of a container file (the
 * DOCX Formatting view), shows each property's effective value, the layer that decided it and what
 * it overrode, with a jump to the XML of each layer. It follows the cursor and reads the file's
 * bytes afresh, so what it says matches what is on disk. Format knowledge stays in the format
 * (`BinaryView.explain`); this file only draws the result.
 */
import { useEffect, useState } from "react";
import { joinContainerPath } from "../../core/container-path";
import type { Explanation, ExplanationRow, ExplanationSource } from "../../core/explain";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument, useActiveEditorState, useSetting } from "../hooks";
import type { Workbench } from "../workbench";
import { showBinaryPart } from "./binary-part";
import { sourceAtCursor } from "./reveal-source";

export const EXPLAIN_DELAY_MS = 200;
export const EXPLAIN_COMMAND = "view.toggleExplain";

/** The container behind the active document if its format can explain, else null. */
export function explainableContainer(wb: Workbench): string | null {
  const doc = wb.activeDocument();
  if (!doc?.path || !doc.sourceMap) return null;
  try {
    const container = wb.platform.containers?.containerOf(doc.path) ?? null;
    if (container === null) return null;
    const provider = wb.registry.forPath(container);
    return provider?.kind === "text" && provider.binary?.explain ? container : null;
  } catch {
    return null;
  }
}

type Result =
  | { status: "idle" }
  | { status: "ready"; explanation: Explanation }
  | { status: "none" }
  | { status: "failed" };

function useExplanation(wb: Workbench, container: string): Result {
  const state = useActiveEditorState(wb);
  const doc = useActiveDocument(wb);
  const entry = state && doc ? sourceAtCursor(wb) : undefined;
  // The view is regenerated (new `modifiedMs`) when a part is saved, so the explanation follows.
  const key = entry ? `${entry.part}\u0000${entry.locator}\u0000${doc?.modifiedMs}` : "";
  // The result is kept with the key it answers, so one for an earlier paragraph is never shown
  // against a later one while the new answer is on its way.
  const [answer, setAnswer] = useState<{ key: string; result: Result } | null>(null);

  useEffect(() => {
    if (!entry) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const provider = wb.registry.forPath(container);
          if (provider?.kind !== "text" || !provider.binary?.explain) return;
          const { bytes } = await wb.platform.readBinaryFile(container);
          const explanation = await provider.binary.explain(bytes, {
            path: container,
            part: entry.part,
            locator: entry.locator,
          });
          if (live)
            setAnswer({
              key,
              result: explanation ? { status: "ready", explanation } : { status: "none" },
            });
        } catch {
          if (live) setAnswer({ key, result: { status: "failed" } });
        }
      })();
    }, EXPLAIN_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `entry` is derived from `key`; depending on the string keeps the effect from re-running on
    // every keystroke in the same paragraph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, container, wb]);

  if (!entry) return { status: "none" };
  return answer?.key === key ? answer.result : { status: "idle" };
}

function SourceLine({
  source,
  container,
  wb,
}: {
  source: ExplanationSource;
  container: string;
  wb: Workbench;
}) {
  const { part, locator } = source;
  if (!part || !locator) return <span>{source.label}</span>;
  return (
    <button
      type="button"
      className="explain-source"
      title="Reveal this layer in the source XML"
      onClick={() => void wb.revealPart(joinContainerPath(container, part), locator)}
    >
      {source.label}
    </button>
  );
}

function Row({ row, container, wb }: { row: ExplanationRow; container: string; wb: Workbench }) {
  // A repair is offered once per explanation: its locator describes the file as it was read, and
  // the view is not regenerated until the part is saved.
  const [applied, setApplied] = useState(false);
  return (
    <div className="explain-row" role="group" aria-label={row.label}>
      <dt>{row.label}</dt>
      <dd>
        <span className="explain-value">{row.value}</span>
        {row.source && (
          <span className="explain-from">
            {" from "}
            <SourceLine source={row.source} container={container} wb={wb} />
          </span>
        )}
        {row.uncertain && <span className="explain-uncertain"> (uncertain)</span>}
        {row.note && <p className="explain-note">{row.note}</p>}
        {row.fix && (
          <p className="explain-fix">
            <button
              type="button"
              className="explain-fix-button"
              title={row.fix.detail}
              aria-disabled={applied || undefined}
              onClick={() => {
                if (applied || !row.fix) return;
                void wb
                  .removePartElement(joinContainerPath(container, row.fix.part), row.fix.locator)
                  .then((done) => {
                    if (done) setApplied(true);
                  });
              }}
            >
              {row.fix.label}
            </button>
            {applied && " Done. Save the part to keep it, or undo it in its tab."}
          </p>
        )}
        {row.overridden?.map((o) => (
          <p className="explain-overridden" key={`${o.source.label}:${o.value}`}>
            Overrides {o.value} from <SourceLine source={o.source} container={container} wb={wb} />
          </p>
        ))}
      </dd>
    </div>
  );
}

function ExplainPanel({ workbench, container }: FeatureComponentProps & { container: string }) {
  const result = useExplanation(workbench, container);
  return (
    <div className="explain-pane">
      <h2 className="pane-title">Explain this paragraph</h2>
      {result.status === "ready" ? (
        <div className="explain-body" aria-live="polite">
          {result.explanation.sections.map((section) => (
            <div key={section.heading}>
              <h3>{section.heading}</h3>
              <dl>
                {section.rows.map((row) => (
                  <Row
                    key={`${row.label}\u0000${row.fix?.locator ?? ""}`}
                    row={row}
                    container={container}
                    wb={workbench}
                  />
                ))}
              </dl>
            </div>
          ))}
          {result.explanation.pictures && result.explanation.pictures.length > 0 && (
            <div>
              <h3>Pictures</h3>
              <ul className="explain-pictures">
                {result.explanation.pictures.map((picture) => (
                  <li key={picture.part}>
                    <span className="explain-value">{picture.name || picture.part}</span>
                    {picture.size && <span>, {picture.size}</span>}
                    <p className="explain-note">
                      {picture.alt ? `Alt text: ${picture.alt}` : "No alt text is written."}
                    </p>
                    <button
                      type="button"
                      className="explain-fix-button"
                      onClick={() => void showBinaryPart(workbench, container, picture.part)}
                    >
                      Show picture
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.explanation.notes.length > 0 && (
            <ul className="explain-notes">
              {result.explanation.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="explain-empty" aria-live="polite">
          {result.status === "failed"
            ? "Could not read the file to explain this line."
            : "Put the cursor in a paragraph to see where its formatting comes from."}
        </p>
      )}
    </div>
  );
}

function ExplainPane({ workbench }: FeatureComponentProps) {
  useActiveDocument(workbench);
  const container = explainableContainer(workbench);
  if (container === null) return null;
  return <ExplainPanel key={container} workbench={workbench} container={container} />;
}

export const explain: Feature = {
  id: "explain",

  commands: (wb) => [
    {
      id: EXPLAIN_COMMAND,
      title: "Explain this paragraph",
      defaultKey: "Mod-Alt-e",
      enabled: () => explainableContainer(wb) !== null,
      run: () => wb.settings.set("explain.visible", !wb.settings.get("explain.visible")),
    },
  ],

  menuItems: [
    {
      menu: "view",
      group: "5_source",
      command: EXPLAIN_COMMAND,
      order: 120,
      label: "Explain this paragraph",
      checked: (wb) => wb.settings.get("explain.visible"),
    },
  ],

  sidePane: {
    id: "explain",
    title: "Explain this paragraph",
    side: "right",
    defaultSize: 34,
    useVisible: (wb) => {
      const visible = useSetting(wb, "explain.visible");
      useActiveDocument(wb);
      return visible && explainableContainer(wb) !== null;
    },
    component: ExplainPane,
  },
};
