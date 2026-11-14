/**
 * The outline: a left pane listing the active document's headings as a tree, heading
 * navigation commands, and a "go to heading" picker.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { OutlineItem } from "../../core/format";
import type { Feature, FeatureComponentProps } from "../feature";
import { useSetting } from "../hooks";
import {
  adjacentHeading,
  headingIndexAt,
  headingsOf,
  outlineModel,
  revealHeading,
} from "../outline-model";
import type { Workbench } from "../workbench";

// Tree structure -------------------------------------------------------------------------

interface Node {
  index: number;
  text: string;
  /** Depth in the tree, from 1 (not the heading level: levels can be skipped). */
  depth: number;
  parent: number;
  hasChildren: boolean;
  /** Stable across edits, so collapse state survives re-reading the headings. */
  key: string;
  posInSet: number;
  setSize: number;
}

function buildNodes(items: readonly OutlineItem[]): Node[] {
  const nodes: Node[] = [];
  const stack: number[] = [];
  const seen = new Map<string, number>();
  const siblings = new Map<number, number>();
  items.forEach((item, index) => {
    while (stack.length > 0 && (items[stack[stack.length - 1] ?? 0]?.level ?? 0) >= item.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1] ?? -1;
    const base = `${item.level}|${item.text}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    const posInSet = (siblings.get(parent) ?? 0) + 1;
    siblings.set(parent, posInSet);
    const parentNode = nodes[parent];
    if (parentNode) parentNode.hasChildren = true;
    nodes.push({
      index,
      text: item.text,
      depth: parentNode ? parentNode.depth + 1 : 1,
      parent,
      hasChildren: false,
      key: `${base}|${nth}`,
      posInSet,
      setSize: 0,
    });
    stack.push(index);
  });
  for (const node of nodes) node.setSize = siblings.get(node.parent) ?? 1;
  return nodes;
}

/** Indices of the nodes to show: all matches while filtering, else those not under a collapsed one. */
function visibleIndices(
  nodes: readonly Node[],
  collapsed: ReadonlySet<string>,
  filter: string,
): number[] {
  const wanted = filter.trim().toLowerCase();
  if (wanted) {
    return nodes.filter((n) => n.text.toLowerCase().includes(wanted)).map((n) => n.index);
  }
  const out: number[] = [];
  let hiddenDepth = Infinity;
  for (const node of nodes) {
    if (node.depth > hiddenDepth) continue;
    hiddenDepth = Infinity;
    out.push(node.index);
    if (node.hasChildren && collapsed.has(node.key)) hiddenDepth = node.depth;
  }
  return out;
}

// The panel ---------------------------------------------------------------------------------

const TYPE_AHEAD_MS = 700;

function OutlinePanel({ workbench }: FeatureComponentProps) {
  const model = outlineModel(workbench);
  useEffect(() => model.start(), [model]);
  const items = useStore(model.store, (s) => s.items);
  const active = useStore(model.store, (s) => s.active);

  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // The roving item, remembered only until the cursor moves to another heading.
  const [roving, setRoving] = useState<{ index: number; active: number } | null>(null);
  const rows = useRef(new Map<number, HTMLElement>());
  const typed = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const nodes = useMemo(() => buildNodes(items ?? []), [items]);
  const visible = useMemo(
    () => visibleIndices(nodes, collapsed, filter),
    [nodes, collapsed, filter],
  );

  // The heading that contains the cursor, or the nearest shown ancestor if it is collapsed.
  let shownActive = -1;
  if (active >= 0 && !filter.trim()) {
    shownActive = active;
    while (shownActive >= 0 && !visible.includes(shownActive)) {
      shownActive = nodes[shownActive]?.parent ?? -1;
    }
  } else if (active >= 0 && visible.includes(active)) {
    shownActive = active;
  }

  const wanted = roving && roving.active === active ? roving.index : -1;
  const current = visible.includes(wanted)
    ? wanted
    : visible.includes(shownActive)
      ? shownActive
      : (visible[0] ?? -1);

  // Keep the highlighted heading in view as the cursor moves.
  useEffect(() => {
    rows.current.get(shownActive)?.scrollIntoView?.({ block: "nearest" });
  }, [shownActive, visible]);

  function focusRow(index: number | undefined) {
    if (index === undefined) return;
    setRoving({ index, active });
    rows.current.get(index)?.focus();
  }

  function activate(index: number) {
    // Positions are read fresh: the list the panel shows may be a debounce behind.
    const fresh = headingsOf(workbench);
    const target = fresh?.[index] ?? items?.[index];
    if (target) revealHeading(workbench, target);
  }

  function toggle(node: Node, expand: boolean) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (expand) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
  }

  function typeAhead(char: string) {
    const state = typed.current;
    clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = setTimeout(() => (state.text = ""), TYPE_AHEAD_MS);
    const repeated = state.text.length > 1 && [...state.text].every((c) => c === state.text[0]);
    const search = repeated ? (state.text[0] ?? "") : state.text;
    const position = visible.indexOf(current);
    const start = search.length === 1 ? position + 1 : position;
    for (let step = 0; step < visible.length; step++) {
      const index = visible[(start + step) % visible.length];
      if (index !== undefined && nodes[index]?.text.toLowerCase().startsWith(search)) {
        focusRow(index);
        return;
      }
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>, node: Node) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const position = visible.indexOf(node.index);
    switch (event.key) {
      case "ArrowDown":
        focusRow(visible[Math.min(position + 1, visible.length - 1)]);
        break;
      case "ArrowUp":
        focusRow(visible[Math.max(position - 1, 0)]);
        break;
      case "Home":
        focusRow(visible[0]);
        break;
      case "End":
        focusRow(visible[visible.length - 1]);
        break;
      case "ArrowRight":
        if (node.hasChildren && !filter.trim()) {
          if (collapsed.has(node.key)) toggle(node, true);
          else focusRow(visible[position + 1]);
        }
        break;
      case "ArrowLeft":
        if (node.hasChildren && !collapsed.has(node.key) && !filter.trim()) toggle(node, false);
        else if (node.parent >= 0 && visible.includes(node.parent)) focusRow(node.parent);
        break;
      case "Enter":
      case " ":
        activate(node.index);
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
      focusRow(current >= 0 ? current : visible[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (filter) setFilter("");
      else workbench.focusEditor();
    }
  }

  const collapsibles = nodes.filter((n) => n.hasChildren);
  let empty: string | null = null;
  if (items === null) empty = "This document has no outline.";
  else if (items.length === 0) empty = "No headings yet.";
  else if (visible.length === 0) empty = "No headings match the filter.";

  return (
    <div className="outline">
      <div className="outline-toolbar">
        <input
          type="search"
          className="outline-filter"
          aria-label="Filter headings"
          placeholder="Filter headings"
          autoComplete="off"
          spellCheck={false}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onFilterKeyDown}
        />
        <button
          type="button"
          className="outline-button"
          disabled={collapsibles.length === 0}
          onClick={() => setCollapsed(new Set(collapsibles.map((n) => n.key)))}
        >
          Collapse all
        </button>
        <button
          type="button"
          className="outline-button"
          disabled={collapsed.size === 0}
          onClick={() => setCollapsed(new Set())}
        >
          Expand all
        </button>
      </div>
      {empty !== null && (
        <p className="outline-empty" role="status">
          {empty}
        </p>
      )}
      {empty === null && (
        <div role="tree" aria-label="Document outline" className="outline-tree">
          {visible.map((index) => {
            const node = nodes[index];
            if (!node) return null;
            const expanded =
              node.hasChildren && !filter.trim() ? !collapsed.has(node.key) : undefined;
            return (
              <div
                key={node.key}
                ref={(el) => {
                  if (el) rows.current.set(index, el);
                  else rows.current.delete(index);
                }}
                role="treeitem"
                aria-level={node.depth}
                aria-posinset={node.posInSet}
                aria-setsize={node.setSize}
                aria-expanded={expanded}
                aria-current={index === shownActive ? "location" : undefined}
                tabIndex={index === current ? 0 : -1}
                data-pane-focus={index === current ? "" : undefined}
                className="outline-item"
                style={{ paddingInlineStart: `${8 + (node.depth - 1) * 14}px` }}
                onFocus={() => setRoving({ index, active })}
                onClick={() => {
                  setRoving({ index, active });
                  activate(index);
                }}
                onKeyDown={(e) => onKeyDown(e, node)}
              >
                <span className="outline-twisty" aria-hidden="true">
                  {expanded === undefined ? "" : expanded ? "▾" : "▸"}
                </span>
                {node.text || "(empty heading)"}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Go to heading -----------------------------------------------------------------------------

interface PickerState {
  open: boolean;
}

const pickers = new WeakMap<Workbench, StoreApi<PickerState>>();

function pickerStore(workbench: Workbench): StoreApi<PickerState> {
  let store = pickers.get(workbench);
  if (!store) {
    store = createStore<PickerState>()(() => ({ open: false }));
    pickers.set(workbench, store);
  }
  return store;
}

function HeadingPickerDialog({ workbench }: { workbench: Workbench }) {
  const [headings] = useState(() => headingsOf(workbench) ?? []);
  const [query, setQuery] = useState("");
  const [returnFocus] = useState(() => document.activeElement);
  const [index, setIndex] = useState(() => {
    const head = workbench.activeEditorState()?.selection.main.head ?? 0;
    return Math.max(0, headingIndexAt(headings, head));
  });
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return headings.filter((h) => h.text.toLowerCase().includes(wanted));
  }, [headings, query]);
  const selected = Math.min(index, Math.max(0, matches.length - 1));

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  function close() {
    pickerStore(workbench).setState({ open: false });
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    else workbench.focusEditor();
  }

  function choose(item: OutlineItem | undefined) {
    close();
    if (item) revealHeading(workbench, item);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const count = matches.length;
    switch (event.key) {
      case "ArrowDown":
        if (count) setIndex((selected + 1) % count);
        break;
      case "ArrowUp":
        if (count) setIndex((selected - 1 + count) % count);
        break;
      case "Enter":
        choose(matches[selected]);
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      className="dialog-backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to heading"
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          type="text"
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="heading-picker-list"
          aria-autocomplete="list"
          aria-activedescendant={matches.length ? `heading-picker-${selected}` : undefined}
          aria-label="Type a heading"
          placeholder="Type a heading"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
        />
        <ul
          ref={list}
          id="heading-picker-list"
          role="listbox"
          aria-label="Headings"
          className="palette-list"
        >
          {matches.map((item, i) => (
            <li
              key={item.from}
              id={`heading-picker-${i}`}
              role="option"
              aria-selected={i === selected}
              className="palette-option"
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(item)}
            >
              <span style={{ paddingInlineStart: `${(item.level - 1) * 12}px` }}>
                {item.text || "(empty heading)"}
              </span>
              <kbd>{`H${item.level}`}</kbd>
            </li>
          ))}
        </ul>
        <p className="palette-status" role="status">
          {matches.length === 0 ? "No matching headings" : `${matches.length} headings`}
        </p>
      </div>
    </div>
  );
}

function HeadingPicker({ workbench }: FeatureComponentProps) {
  const open = useStore(pickerStore(workbench), (s) => s.open);
  return open ? <HeadingPickerDialog workbench={workbench} /> : null;
}

// The feature -------------------------------------------------------------------------------

function step(workbench: Workbench, direction: 1 | -1): void {
  const view = workbench.activeView();
  const items = headingsOf(workbench);
  if (!view || !items) {
    workbench.notify({ message: "This document has no outline." });
    return;
  }
  const target = adjacentHeading(items, view.state.selection.main.head, direction);
  if (target) revealHeading(workbench, target);
}

export const outline: Feature = {
  id: "outline",

  commands: (wb) => [
    {
      id: "view.toggleOutline",
      title: "Toggle outline",
      defaultKey: "Mod-Shift-o",
      run: () => wb.settings.set("outline.visible", !wb.settings.get("outline.visible")),
    },
    {
      id: "navigate.nextHeading",
      title: "Go to next heading",
      defaultKey: "Alt-PageDown",
      run: () => step(wb, 1),
    },
    {
      id: "navigate.previousHeading",
      title: "Go to previous heading",
      defaultKey: "Alt-PageUp",
      run: () => step(wb, -1),
    },
    {
      id: "navigate.goToHeading",
      title: "Go to heading…",
      defaultKey: "Mod-Alt-o",
      run: () => {
        if (!headingsOf(wb)) {
          wb.notify({ message: "This document has no outline." });
          return;
        }
        pickerStore(wb).setState({ open: true });
      },
    },
  ],

  menuItems: [
    {
      menu: "view",
      group: "3_outline",
      command: "view.toggleOutline",
      order: 1,
      label: "Outline",
      checked: (wb) => wb.settings.get("outline.visible"),
    },
    { menu: "view", group: "3_outline", command: "navigate.goToHeading", order: 2 },
    { menu: "view", group: "3_outline", command: "navigate.nextHeading", order: 3 },
    { menu: "view", group: "3_outline", command: "navigate.previousHeading", order: 4 },
  ],

  sidePane: {
    id: "outline",
    title: "Outline",
    side: "left",
    defaultSize: 22,
    useVisible: (wb) => useSetting(wb, "outline.visible"),
    component: OutlinePanel,
  },

  overlays: [HeadingPicker],
};
