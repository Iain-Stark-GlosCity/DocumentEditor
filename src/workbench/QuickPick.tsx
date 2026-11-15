import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { filterByQuery } from "../core/fuzzy";
import type { PickItem, Workbench } from "./workbench";

export interface QuickPickProps<T> {
  /** Accessible name of the dialog. */
  title: string;
  items: readonly PickItem<T>[];
  placeholder?: string;
  emptyMessage?: string;
  /** Called with the chosen value, or null when dismissed. The caller decides where focus goes. */
  onClose(value: T | null): void;
}

/**
 * A small modal list: type to filter, arrows to move, Enter to choose, Escape to dismiss. It
 * follows the ARIA combobox-with-listbox pattern (focus stays in the filter box and the
 * highlighted option is `aria-activedescendant`). Items marked `checked` carry a tick.
 */
export function QuickPick<T>({
  title,
  items,
  placeholder,
  emptyMessage,
  onClose,
}: QuickPickProps<T>) {
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-option-${i}`;
  const [query, setQuery] = useState("");
  // Opens on the ticked item, so the current choice is the one Enter keeps.
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((i) => i.checked),
    ),
  );
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => filterByQuery(query, items, (i) => i.label), [items, query]);
  const active = Math.min(index, Math.max(0, matches.length - 1));

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = matches.length;
    switch (event.key) {
      case "ArrowDown":
        if (count) setIndex((active + 1) % count);
        break;
      case "ArrowUp":
        if (count) setIndex((active - 1 + count) % count);
        break;
      case "Enter": {
        // Enter that confirms an input-method composition is not a choice.
        if (event.nativeEvent.isComposing) return;
        const item = matches[active];
        if (item) onClose(item.value);
        break;
      }
      case "Escape":
        onClose(null);
        break;
      case "Tab":
        // Focus stays in the filter box while the pick is open.
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
        if (e.target === e.currentTarget) onClose(null);
      }}
    >
      <div
        className="palette quick-pick"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          type="text"
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={matches.length ? optionId(active) : undefined}
          aria-label={placeholder ?? title}
          placeholder={placeholder ?? title}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
        />
        <ul ref={list} id={listId} role="listbox" aria-label={title} className="palette-list">
          {matches.map((item, i) => (
            <li
              key={i}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className="palette-option"
              onMouseMove={() => setIndex(i)}
              onClick={() => onClose(item.value)}
            >
              <span className="quick-pick-label">
                <span className="quick-pick-tick" aria-hidden="true">
                  {item.checked ? "✓" : ""}
                </span>
                {item.label}
                {item.checked && <span className="quick-pick-current"> (current)</span>}
              </span>
              {item.detail && <kbd>{item.detail}</kbd>}
            </li>
          ))}
        </ul>
        <p className="palette-status" role="status">
          {matches.length === 0
            ? (emptyMessage ?? "No matches")
            : `${matches.length} ${matches.length === 1 ? "choice" : "choices"}`}
        </p>
      </div>
    </div>
  );
}

/** Shows the quick pick requested through `workbench.pick`, and puts focus back in the editor. */
export function QuickPickHost({ workbench }: { workbench: Workbench }) {
  const pending = useStore(workbench.ui, (s) => s.pick);
  if (!pending) return null;
  return (
    <QuickPick
      key={pending.id}
      title={pending.title}
      items={pending.items}
      placeholder={pending.placeholder}
      emptyMessage={pending.emptyMessage}
      onClose={(value) => {
        workbench.resolvePick(pending.id, value);
        workbench.focusEditor();
      }}
    />
  );
}
