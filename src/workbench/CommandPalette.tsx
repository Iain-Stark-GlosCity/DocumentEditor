import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import type { Command } from "../core/commands";
import { filterByQuery } from "../core/fuzzy";
import { useCommands } from "./hooks";
import { formatKey } from "./keys";
import type { Workbench } from "./workbench";

const LISTBOX_ID = "palette-listbox";
const optionId = (i: number) => `palette-option-${i}`;

function PaletteDialog({ workbench }: { workbench: Workbench }) {
  const commands = useCommands(workbench);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [returnFocus] = useState(() => document.activeElement);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const available = commands.filter(
      (c) => c.id !== "view.commandPalette" && (!c.enabled || c.enabled()),
    );
    return filterByQuery(query, available, (c) => c.title);
    // `commands` identity changes whenever the registry does.
  }, [commands, query]);

  const active = Math.min(index, Math.max(0, matches.length - 1));

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function close() {
    if (
      returnFocus instanceof HTMLElement &&
      returnFocus.isConnected &&
      returnFocus !== document.body
    ) {
      returnFocus.focus();
    } else {
      workbench.focusEditor();
    }
    workbench.closePalette();
  }

  function run(command: Command) {
    close();
    void workbench.runCommand(command.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = matches.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count) setIndex((active + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (count) setIndex((active - 1 + count) % count);
        break;
      case "Enter": {
        event.preventDefault();
        const command = matches[active];
        if (command) run(command);
        break;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        // Focus stays in the filter box while the palette is open.
        event.preventDefault();
        break;
    }
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
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          type="text"
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={matches.length ? optionId(active) : undefined}
          aria-label="Type a command"
          placeholder="Type a command"
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
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Commands"
          className="palette-list"
        >
          {matches.map((command, i) => (
            <li
              key={command.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className="palette-option"
              onMouseMove={() => setIndex(i)}
              onClick={() => run(command)}
            >
              <span>{command.title}</span>
              {command.defaultKey && <kbd>{formatKey(command.defaultKey)}</kbd>}
            </li>
          ))}
        </ul>
        <p className="palette-status" role="status">
          {matches.length === 0 ? "No matching commands" : `${matches.length} commands`}
        </p>
      </div>
    </div>
  );
}

/** Modal command list: filter, arrow keys, Enter to run, Escape to close. */
export function CommandPalette({ workbench }: { workbench: Workbench }) {
  const open = useStore(workbench.ui, (s) => s.paletteOpen);
  return open ? <PaletteDialog workbench={workbench} /> : null;
}
