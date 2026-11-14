/**
 * The Parts pane: when the active document belongs to a container file (a DOCX, say, which is a
 * zip of parts), a left pane lists the parts as a tree. The top row is the container itself,
 * which opens its generated view; a text part opens as an editable tab; a binary part cannot be
 * shown as text. The same tree pattern as the outline: roving tabindex, arrow keys, type-ahead.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { baseName } from "../../core/documents";
import { joinContainerPath, splitContainerPath } from "../../core/container-path";
import {
  ancestorKeys,
  buildPartsTree,
  formatSize,
  visibleParts,
  type PartsNode,
} from "../../core/parts-tree";
import type { ContainerPart } from "../../platform/platform";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument, useSetting } from "../hooks";
import type { Workbench } from "../workbench";

const TYPE_AHEAD_MS = 700;
const CONTAINER_KEY = "container";

function containerOfPath(workbench: Workbench, path: string): string | null {
  try {
    return workbench.platform.containers?.containerOf(path) ?? null;
  } catch {
    return null;
  }
}

function useContainer(workbench: Workbench): string | null {
  const doc = useActiveDocument(workbench);
  if (!doc?.path) return null;
  try {
    return workbench.platform.containers?.containerOf(doc.path) ?? null;
  } catch {
    return null;
  }
}

type Row = Omit<PartsNode, "kind"> & { kind: "container" | "dir" | "file" };

type Listing =
  | { container: string; status: "loading" }
  | { container: string; status: "ready"; parts: ContainerPart[] }
  | { container: string; status: "error"; message: string };

function PartsPanel({ workbench, container }: FeatureComponentProps & { container: string }) {
  const doc = useActiveDocument(workbench);
  const [listing, setListing] = useState<Listing>({ container, status: "loading" });
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [roving, setRoving] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const typed = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const request = useRef(0);

  const load = useCallback(
    (target: string) => {
      const mine = ++request.current;
      const containers = workbench.platform.containers;
      if (!containers) return;
      // A re-list keeps showing the old list until the new one arrives.
      containers.listParts(target).then(
        (parts) => {
          if (mine === request.current) setListing({ container: target, status: "ready", parts });
        },
        (e: unknown) => {
          if (mine !== request.current) return;
          setListing({
            container: target,
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        },
      );
    },
    [workbench],
  );

  // List when the container changes, and again after any part of it is saved.
  useEffect(() => {
    load(container);
    return workbench.onDidSave((event) => {
      if (containerOfPath(workbench, event.path) === container) load(container);
    });
  }, [container, load, workbench]);

  const parts =
    listing?.container === container && listing.status === "ready" ? listing.parts : null;
  const nodes = useMemo(() => buildPartsTree(parts ?? []), [parts]);

  const all: Row[] = useMemo(() => {
    if (container === null) return [];
    // The container row sits first among the top-level items, so their positions shift by one.
    const shifted: Row[] = nodes.map((n) =>
      n.parent === null ? { ...n, posInSet: n.posInSet + 1, setSize: n.setSize + 1 } : n,
    );
    const top = shifted.filter((n) => n.parent === null).length + 1;
    return [
      {
        key: CONTAINER_KEY,
        kind: "container",
        label: baseName(container),
        path: container,
        depth: 1,
        parent: null,
        hasChildren: false,
        posInSet: 1,
        setSize: top,
      },
      ...shifted,
    ];
  }, [nodes, container]);

  const visible: Row[] = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    if (wanted) {
      const files = visibleParts(nodes, collapsed, filter);
      const head = all[0];
      const showContainer = head !== undefined && head.label.toLowerCase().includes(wanted);
      return [...(showContainer && head ? [head] : []), ...files];
    }
    const head = all[0];
    return head ? [head, ...visibleParts(nodes, collapsed, "")] : [];
  }, [all, nodes, collapsed, filter]);

  // The row that belongs to the active document.
  let activeKey: string | null = null;
  if (doc?.path && container !== null) {
    if (doc.path === container) activeKey = CONTAINER_KEY;
    else {
      const split = splitContainerPath(doc.path);
      if (split && split.container === container) activeKey = `file:${split.part}`;
    }
  }
  const activePart = activeKey?.startsWith("file:") ? activeKey.slice(5) : null;

  // Open the folders above the active part when it changes, so it can be seen. Adjusting state
  // while rendering (rather than in an effect) avoids a frame with the part hidden.
  const [seenPart, setSeenPart] = useState<string | null>(null);
  if (seenPart !== activePart) {
    setSeenPart(activePart);
    const keys = activePart === null ? [] : ancestorKeys(activePart);
    if (keys.some((k) => collapsed.has(k))) {
      const next = new Set(collapsed);
      for (const k of keys) next.delete(k);
      setCollapsed(next);
    }
  }

  const visibleKeys = visible.map((r) => r.key);
  let shownActive: string | null = null;
  if (activeKey !== null) {
    if (visibleKeys.includes(activeKey)) shownActive = activeKey;
    else {
      // Collapsed (or filtered out): show the nearest folder that is visible.
      const byKey = new Map(all.map((r) => [r.key, r]));
      let parent = byKey.get(activeKey)?.parent ?? null;
      while (parent !== null && !visibleKeys.includes(parent)) {
        parent = byKey.get(parent)?.parent ?? null;
      }
      shownActive = filter.trim() ? null : parent;
    }
  }

  const current =
    roving !== null && visibleKeys.includes(roving)
      ? roving
      : shownActive !== null
        ? shownActive
        : (visibleKeys[0] ?? null);

  useEffect(() => {
    if (shownActive !== null) rows.current.get(shownActive)?.scrollIntoView?.({ block: "nearest" });
  }, [shownActive, visibleKeys.length]);

  function focusRow(key: string | undefined) {
    if (key === undefined) return;
    setRoving(key);
    rows.current.get(key)?.focus();
  }

  function toggle(row: Row, expand: boolean) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (expand) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  }

  function activate(row: Row) {
    if (container === null) return;
    if (row.kind === "dir") {
      toggle(row, collapsed.has(row.key));
      return;
    }
    if (row.kind === "container") {
      void workbench.openPaths([container]);
      return;
    }
    if (row.part && !row.part.text) {
      workbench.notify({
        message: `${row.label} is a binary part and cannot be shown as text.`,
      });
      return;
    }
    void workbench.openPaths([joinContainerPath(container, row.path)]);
  }

  function typeAhead(char: string) {
    const state = typed.current;
    clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = setTimeout(() => (state.text = ""), TYPE_AHEAD_MS);
    const repeated = state.text.length > 1 && [...state.text].every((c) => c === state.text[0]);
    const search = repeated ? (state.text[0] ?? "") : state.text;
    const position = current === null ? -1 : visibleKeys.indexOf(current);
    const start = search.length === 1 ? position + 1 : position;
    for (let step = 0; step < visible.length; step++) {
      const row = visible[(start + step) % visible.length];
      if (row?.label.toLowerCase().startsWith(search)) {
        focusRow(row.key);
        return;
      }
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>, row: Row) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const position = visibleKeys.indexOf(row.key);
    const filtering = filter.trim() !== "";
    const isFolder = row.kind === "dir" && row.hasChildren;
    switch (event.key) {
      case "ArrowDown":
        focusRow(visibleKeys[Math.min(position + 1, visibleKeys.length - 1)]);
        break;
      case "ArrowUp":
        focusRow(visibleKeys[Math.max(position - 1, 0)]);
        break;
      case "Home":
        focusRow(visibleKeys[0]);
        break;
      case "End":
        focusRow(visibleKeys[visibleKeys.length - 1]);
        break;
      case "ArrowRight":
        if (isFolder && !filtering) {
          if (collapsed.has(row.key)) toggle(row, true);
          else focusRow(visibleKeys[position + 1]);
        }
        break;
      case "ArrowLeft":
        if (isFolder && !collapsed.has(row.key) && !filtering) toggle(row, false);
        else if (row.parent !== null && visibleKeys.includes(row.parent)) focusRow(row.parent);
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      case "Escape":
        workbench.focusEditor();
        break;
      default:
        if (event.key.length === 1) {
          typeAhead(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
  }

  function onFilterKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(current ?? visibleKeys[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (filter) setFilter("");
      else workbench.focusEditor();
    }
  }

  const status = listing?.container === container ? listing.status : "loading";
  let empty: string | null = null;
  if (status === "ready" && nodes.length === 0) empty = "This file has no parts.";
  else if (status === "ready" && visible.length === 0) empty = "No parts match the filter.";

  const collapsibles = nodes.filter((n) => n.kind === "dir" && n.hasChildren);

  return (
    <div className="parts">
      <div className="parts-toolbar">
        <input
          type="search"
          className="parts-filter"
          aria-label="Filter parts"
          placeholder="Filter parts"
          autoComplete="off"
          spellCheck={false}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onFilterKeyDown}
        />
        <button
          type="button"
          className="parts-button"
          disabled={collapsibles.length === 0}
          onClick={() => setCollapsed(new Set(collapsibles.map((n) => n.key)))}
        >
          Collapse all
        </button>
        <button
          type="button"
          className="parts-button"
          disabled={collapsed.size === 0}
          onClick={() => setCollapsed(new Set())}
        >
          Expand all
        </button>
      </div>
      {status === "loading" && (
        <p className="parts-empty" role="status">
          Reading the parts…
        </p>
      )}
      {listing?.container === container && listing.status === "error" && (
        <div className="parts-empty parts-error" role="alert">
          <p>Could not list the parts: {listing.message}</p>
          <button
            type="button"
            className="parts-button"
            onClick={() => {
              setListing({ container, status: "loading" });
              load(container);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {empty !== null && (
        <p className="parts-empty" role="status">
          {empty}
        </p>
      )}
      {status === "ready" && empty === null && (
        <div role="tree" aria-label="Parts of the open file" className="parts-tree">
          {visible.map((row) => {
            const expanded =
              row.kind === "dir" && row.hasChildren && !filter.trim()
                ? !collapsed.has(row.key)
                : undefined;
            const binary = row.kind === "file" && row.part?.text === false;
            const indication =
              row.kind === "file"
                ? binary
                  ? "binary"
                  : "text"
                : row.kind === "container"
                  ? "file"
                  : null;
            const size = row.kind === "file" && row.part ? formatSize(row.part.size) : "";
            const depth = filter.trim() ? 1 : row.depth;
            return (
              <div
                key={row.key}
                ref={(el) => {
                  if (el) rows.current.set(row.key, el);
                  else rows.current.delete(row.key);
                }}
                role="treeitem"
                aria-level={depth}
                aria-posinset={filter.trim() ? undefined : row.posInSet}
                aria-setsize={filter.trim() ? undefined : row.setSize}
                aria-expanded={expanded}
                aria-current={row.key === shownActive ? "location" : undefined}
                aria-label={
                  row.kind === "file"
                    ? `${filter.trim() ? row.path : row.label}, ${size}, ${binary ? "binary" : "text"} part`
                    : row.kind === "container"
                      ? `${row.label}, formatting view`
                      : undefined
                }
                tabIndex={row.key === current ? 0 : -1}
                data-pane-focus={row.key === current ? "" : undefined}
                className={`parts-item${binary ? " parts-item--binary" : ""}${row.kind === "container" ? " parts-item--container" : ""}`}
                style={{ paddingInlineStart: `${8 + (depth - 1) * 14}px` }}
                onFocus={() => setRoving(row.key)}
                onClick={() => {
                  setRoving(row.key);
                  activate(row);
                }}
                onKeyDown={(e) => onKeyDown(e, row)}
              >
                <span className="parts-twisty" aria-hidden="true">
                  {expanded === undefined ? "" : expanded ? "▾" : "▸"}
                </span>
                <span className="parts-name">
                  {filter.trim() && row.kind === "file" ? row.path : row.label}
                </span>
                {(size !== "" || indication !== null) && (
                  <span className="parts-meta" aria-hidden="true">
                    {size}
                    {size !== "" && indication ? " · " : ""}
                    {indication}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Remounts the panel for each container, so its filter, folds and focus start afresh. */
function PartsPane({ workbench }: FeatureComponentProps) {
  const container = useContainer(workbench);
  if (container === null) return null;
  return <PartsPanel key={container} workbench={workbench} container={container} />;
}

export const parts: Feature = {
  id: "parts",

  commands: (wb) => [
    {
      id: "view.toggleParts",
      title: "Parts of the open file",
      defaultKey: "Mod-Alt-p",
      run: () => wb.settings.set("parts.visible", !wb.settings.get("parts.visible")),
    },
  ],

  menuItems: [
    {
      menu: "view",
      group: "3_outline",
      command: "view.toggleParts",
      order: 5,
      label: "Parts of the open file",
      checked: (wb) => wb.settings.get("parts.visible"),
    },
  ],

  sidePane: {
    id: "parts",
    title: "Parts",
    side: "left",
    defaultSize: 24,
    useVisible: (wb) => {
      const visible = useSetting(wb, "parts.visible");
      const container = useContainer(wb);
      return visible && container !== null;
    },
    component: PartsPane,
  },
};
