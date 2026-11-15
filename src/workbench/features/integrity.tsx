/**
 * The Integrity pane: when the active document belongs to a container whose format can inspect
 * it (see `BinaryView.inspect`), a left pane lists what the check found, grouped by family, with
 * severity filters, a text filter and a jump to each location. The status bar shows the result in
 * a few words, and the report can be copied without any of the document's text in it.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { joinContainerPath } from "../../core/container-path";
import {
  countBySeverity,
  formatFindingsReport,
  type Finding,
  type FindingSeverity,
} from "../../core/findings";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument, useSetting } from "../hooks";
import { copyToClipboard } from "../preview/codeCopy";
import type { Workbench } from "../workbench";
import {
  inspectableContainer,
  integrityController,
  summarise,
  type IntegrityState,
} from "./integrity-controller";

const SEVERITIES: readonly FindingSeverity[] = ["error", "warning", "info"];
const WORD: Record<FindingSeverity, [string, string]> = {
  error: ["error", "errors"],
  warning: ["warning", "warnings"],
  info: ["note", "notes"],
};
const LABEL: Record<FindingSeverity, string> = { error: "Error", warning: "Warning", info: "Note" };
const ICON: Record<FindingSeverity, string> = { error: "✕", warning: "▲", info: "●" };

export const REPORT_EXPLANATION =
  "Copies a plain-text report of rule codes, counts and locations. It contains none of the document's text.";
export const EMPTY_MESSAGE =
  "No problems found. This checks the file's structure against the rules listed in the documentation; it does not prove that Word will open the file.";

const count = (n: number, severity: FindingSeverity) => `${n} ${WORD[severity][n === 1 ? 0 : 1]}`;

function useIntegrity(wb: Workbench): IntegrityState {
  const controller = integrityController(wb);
  return useSyncExternalStore(controller.subscribe, controller.getState);
}

type Row =
  | { key: string; kind: "group"; family: string; size: number; expanded: boolean }
  | { key: string; kind: "finding"; finding: Finding; expanded: boolean; family: string };

function matches(finding: Finding, text: string): boolean {
  if (text === "") return true;
  const haystack = [
    finding.title,
    finding.rule,
    finding.family,
    finding.why,
    ...finding.locations.flatMap((l) => [l.part, l.label ?? "", l.locator ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(text);
}

function IntegrityPanel({ workbench, container }: FeatureComponentProps & { container: string }) {
  const state = useIntegrity(workbench);
  const controller = integrityController(workbench);
  const [shown, setShown] = useState<ReadonlySet<FindingSeverity>>(() => new Set(SEVERITIES));
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [roving, setRoving] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rows = useRef(new Map<string, HTMLElement>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );

  const mine = state.container === container;
  const findings = mine ? state.findings : null;
  const status = mine ? state.status : "idle";
  const counts = useMemo(() => countBySeverity(findings ?? []), [findings]);

  const wanted = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (findings ?? []).filter((f) => shown.has(f.severity) && matches(f, wanted)),
    [findings, shown, wanted],
  );

  const visible: Row[] = useMemo(() => {
    // Findings arrive sorted errors first, so the first of each family sets the group order.
    const groups = new Map<string, Finding[]>();
    for (const finding of filtered) {
      const list = groups.get(finding.family);
      if (list) list.push(finding);
      else groups.set(finding.family, [finding]);
    }
    const out: Row[] = [];
    for (const [family, list] of groups) {
      const expanded = wanted !== "" || !collapsed.has(family);
      out.push({ key: `group:${family}`, kind: "group", family, size: list.length, expanded });
      if (!expanded) continue;
      for (const finding of list) {
        out.push({
          key: `finding:${finding.id}`,
          kind: "finding",
          finding,
          family,
          expanded: open.has(finding.id),
        });
      }
    }
    return out;
  }, [filtered, collapsed, open, wanted]);

  const keys = visible.map((r) => r.key);
  const current = roving !== null && keys.includes(roving) ? roving : (keys[0] ?? null);

  function focusRow(key: string | undefined) {
    if (key === undefined) return;
    setRoving(key);
    rows.current.get(key)?.focus();
  }

  function toggleSet(
    set: ReadonlySet<string>,
    update: (next: ReadonlySet<string>) => void,
    value: string,
    on: boolean,
  ) {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    update(next);
  }

  function activate(row: Row) {
    if (row.kind === "group") {
      if (wanted === "") toggleSet(collapsed, setCollapsed, row.family, row.expanded);
    } else {
      toggleSet(open, setOpen, row.finding.id, !row.expanded);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>, row: Row) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const position = keys.indexOf(row.key);
    switch (event.key) {
      case "ArrowDown":
        focusRow(keys[Math.min(position + 1, keys.length - 1)]);
        break;
      case "ArrowUp":
        focusRow(keys[Math.max(position - 1, 0)]);
        break;
      case "Home":
        focusRow(keys[0]);
        break;
      case "End":
        focusRow(keys[keys.length - 1]);
        break;
      case "ArrowRight":
        if (!row.expanded) activate(row);
        else if (row.kind === "group") focusRow(keys[position + 1]);
        else
          rows.current
            .get(`${row.key}:details`)
            ?.querySelector<HTMLElement>("button.integrity-location")
            ?.focus();
        break;
      case "ArrowLeft":
        if (row.expanded && (row.kind === "finding" || wanted === "")) activate(row);
        else if (row.kind === "finding") focusRow(`group:${row.family}`);
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      case "Escape":
        workbench.focusEditor();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onDetailsKeyDown(event: ReactKeyboardEvent<HTMLElement>, key: string) {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusRow(key);
    }
  }

  function onFilterKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(current ?? undefined);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (filter) setFilter("");
      else workbench.focusEditor();
    }
  }

  async function copyReport() {
    if (findings === null) return;
    const ok = await copyToClipboard(formatFindingsReport(findings));
    if (!ok) {
      workbench.notify({ kind: "error", message: "Could not copy the integrity report." });
      return;
    }
    setCopied(true);
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  const busy = status === "running";

  return (
    <div className="integrity" aria-busy={busy}>
      <div className="integrity-toolbar">
        <button
          type="button"
          className="integrity-button"
          disabled={busy}
          onClick={() => void controller.run()}
        >
          Check again
        </button>
        <button
          type="button"
          className="integrity-button"
          disabled={findings === null}
          title={REPORT_EXPLANATION}
          aria-describedby="integrity-report-help"
          onClick={() => void copyReport()}
        >
          Copy report
        </button>
        <span id="integrity-report-help" className="integrity-visually-hidden">
          {REPORT_EXPLANATION}
        </span>
        <span className="integrity-copied" role="status">
          {copied ? "Report copied" : ""}
        </span>
      </div>

      {busy && (
        <p className="integrity-note" role="status">
          {findings === null ? "Checking the file…" : "Checking the file again…"}
        </p>
      )}
      {status === "idle" && findings === null && (
        <p className="integrity-note" role="status">
          Not checked yet.
        </p>
      )}
      {mine && state.status === "failed" && (
        <div className="integrity-note integrity-error" role="alert">
          <p>Could not check the file: {state.message}</p>
        </div>
      )}

      {findings !== null && (
        <>
          <p className="integrity-summary" role="status">
            {findings.length === 0 ? "No problems" : summarise(findings)}
          </p>
          <div className="integrity-filters">
            <div role="group" aria-label="Show severities" className="integrity-severities">
              {SEVERITIES.map((severity) => (
                <button
                  key={severity}
                  type="button"
                  className={`integrity-toggle integrity-toggle--${severity}`}
                  aria-pressed={shown.has(severity)}
                  onClick={() => {
                    const next = new Set(shown);
                    if (next.has(severity)) next.delete(severity);
                    else next.add(severity);
                    setShown(next);
                  }}
                >
                  <span aria-hidden="true">{ICON[severity]} </span>
                  {count(counts[severity], severity)}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="integrity-filter"
              aria-label="Filter findings"
              placeholder="Filter findings"
              autoComplete="off"
              spellCheck={false}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={onFilterKeyDown}
            />
          </div>
          {findings.length === 0 && <p className="integrity-note">{EMPTY_MESSAGE}</p>}
          {findings.length > 0 && visible.length === 0 && (
            <p className="integrity-note" role="status">
              No findings match the filters.
            </p>
          )}
          {visible.length > 0 && (
            <div role="tree" aria-label="Findings" className="integrity-tree">
              {visible.map((row) => {
                const refFn = (el: HTMLElement | null) => {
                  if (el) rows.current.set(row.key, el);
                  else rows.current.delete(row.key);
                };
                if (row.kind === "group") {
                  return (
                    <div
                      key={row.key}
                      ref={refFn}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={row.expanded}
                      aria-label={`${row.family}, ${row.size} ${row.size === 1 ? "finding" : "findings"}`}
                      tabIndex={row.key === current ? 0 : -1}
                      data-pane-focus={row.key === current ? "" : undefined}
                      className="integrity-group"
                      onFocus={() => setRoving(row.key)}
                      onClick={() => {
                        setRoving(row.key);
                        activate(row);
                      }}
                      onKeyDown={(e) => onKeyDown(e, row)}
                    >
                      <span className="integrity-twisty" aria-hidden="true">
                        {row.expanded ? "▾" : "▸"}
                      </span>
                      <span className="integrity-group-name">{row.family}</span>
                      <span className="integrity-meta">
                        {row.size} {row.size === 1 ? "finding" : "findings"}
                      </span>
                    </div>
                  );
                }
                const { finding } = row;
                const places = finding.locations.length;
                const facts = Object.entries(finding.facts ?? {});
                return (
                  <div key={row.key} className="integrity-entry">
                    <div
                      ref={refFn}
                      role="treeitem"
                      aria-level={2}
                      aria-expanded={row.expanded}
                      aria-label={`${LABEL[finding.severity]}: ${finding.title}, ${places} ${places === 1 ? "location" : "locations"}`}
                      tabIndex={row.key === current ? 0 : -1}
                      data-pane-focus={row.key === current ? "" : undefined}
                      className={`integrity-row integrity-row--${finding.severity}`}
                      onFocus={() => setRoving(row.key)}
                      onClick={() => {
                        setRoving(row.key);
                        activate(row);
                      }}
                      onKeyDown={(e) => onKeyDown(e, row)}
                    >
                      <span className="integrity-severity">
                        <span aria-hidden="true">{ICON[finding.severity]} </span>
                        {LABEL[finding.severity]}
                      </span>
                      <span className="integrity-title">{finding.title}</span>
                      <span className="integrity-meta" aria-hidden="true">
                        {places} {places === 1 ? "location" : "locations"}
                      </span>
                    </div>
                    {row.expanded && (
                      <div
                        role="group"
                        aria-label={`Details of ${finding.title}`}
                        className="integrity-details"
                        ref={(el) => {
                          if (el) rows.current.set(`${row.key}:details`, el);
                          else rows.current.delete(`${row.key}:details`);
                        }}
                        onKeyDown={(e) => onDetailsKeyDown(e, row.key)}
                      >
                        <p className="integrity-why">{finding.why}</p>
                        {facts.length > 0 && (
                          <dl className="integrity-facts">
                            {facts.map(([name, value]) => (
                              <div key={name} className="integrity-fact">
                                <dt>{name}</dt>
                                <dd>{String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {places > 0 && (
                          <ul className="integrity-locations" aria-label="Locations">
                            {finding.locations.map((location, index) => {
                              const where = location.label ?? location.locator ?? "";
                              return (
                                <li key={`${location.part}:${location.locator ?? index}`}>
                                  <button
                                    type="button"
                                    className="integrity-location"
                                    aria-label={
                                      where === "" ? location.part : `${location.part} ${where}`
                                    }
                                    onClick={() =>
                                      void workbench.revealPart(
                                        joinContainerPath(container, location.part),
                                        location.locator,
                                      )
                                    }
                                  >
                                    <span className="integrity-part">{location.part}</span>
                                    {where !== "" && (
                                      <span className="integrity-where"> {where}</span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function useInspectableContainer(wb: Workbench): string | null {
  const doc = useActiveDocument(wb);
  return inspectableContainer(wb, doc);
}

/** Remounts the panel for each container, so its filters and folds start afresh. */
function IntegrityPane({ workbench }: FeatureComponentProps) {
  const container = useInspectableContainer(workbench);
  if (container === null) return null;
  return <IntegrityPanel key={container} workbench={workbench} container={container} />;
}

function IntegrityStatus({ workbench }: FeatureComponentProps) {
  const state = useIntegrity(workbench);
  const container = useInspectableContainer(workbench);
  if (container === null || state.container !== container || state.findings === null) return null;
  const summary = summarise(state.findings);
  return (
    <button
      type="button"
      className="integrity-status"
      aria-label={`Integrity: ${summary}. Show the integrity pane`}
      title={`Integrity: ${summary}`}
      onClick={() => workbench.settings.set("integrity.visible", true)}
    >
      Integrity: {summary}
    </button>
  );
}

export const integrity: Feature = {
  id: "integrity",

  activate: (wb) => integrityController(wb).start(),

  commands: (wb) => [
    {
      id: "view.toggleIntegrity",
      title: "Document integrity",
      defaultKey: "Mod-Alt-i",
      run: () => wb.settings.set("integrity.visible", !wb.settings.get("integrity.visible")),
    },
    {
      id: "view.checkIntegrity",
      title: "Check document integrity",
      enabled: () => inspectableContainer(wb, wb.activeDocument()) !== null,
      run: () => {
        wb.settings.set("integrity.visible", true);
        // Showing the pane starts a check when none is current; otherwise start one now.
        const controller = integrityController(wb);
        if (controller.getState().status !== "running") return controller.run();
      },
    },
  ],

  menuItems: [
    {
      menu: "view",
      group: "3_outline",
      command: "view.toggleIntegrity",
      order: 6,
      label: "Document integrity",
      checked: (wb) => wb.settings.get("integrity.visible"),
    },
  ],

  statusItems: [{ id: "integrity", align: "right", order: 7, component: IntegrityStatus }],

  sidePane: {
    id: "integrity",
    title: "Integrity",
    side: "left",
    defaultSize: 28,
    useVisible: (wb) => {
      const visible = useSetting(wb, "integrity.visible");
      const container = useInspectableContainer(wb);
      return visible && container !== null;
    },
    component: IntegrityPane,
  },
};
