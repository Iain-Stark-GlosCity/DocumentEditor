import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { useCommands } from "./hooks";
import { buildMenus, type MenuEntry } from "./menus";
import type { Workbench } from "./workbench";

type Pending = "first" | "last" | null;

/**
 * In-app menu bar (ARIA menubar pattern). Alt or F10 focuses it; arrows move, Enter or Space
 * activates, Escape closes and returns focus to where it was.
 */
export function MenuBar({ workbench }: { workbench: Workbench }) {
  const commands = useCommands(workbench);
  // Re-render when the active document changes so `enabled` is re-read.
  useStore(workbench.documents, (s) => s.activeId);
  const menus = useMemo(
    () => buildMenus(workbench.menuItems(), workbench.commands),
    // `commands` changing means contributions may have appeared or gone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workbench, commands],
  );
  const focusRequest = useStore(workbench.ui, (s) => s.menuFocusRequest);

  const [openId, setOpenId] = useState<string | null>(null);
  const [topIndex, setTopIndex] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pending = useRef<Pending>(null);
  const topRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const index = Math.min(topIndex, Math.max(0, menus.length - 1));

  function remember() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !bar.current?.contains(active)) {
      returnFocus.current = active;
    }
  }

  function leave() {
    setOpenId(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target && target.isConnected && target !== document.body) target.focus();
    else workbench.focusEditor();
  }

  function focusTop(i: number) {
    setTopIndex(i);
    topRefs.current[i]?.focus();
  }

  function openMenu(i: number, focus: Pending) {
    remember();
    setTopIndex(i);
    pending.current = focus;
    setOpenId(menus[i]?.id ?? null);
    if (focus === null) topRefs.current[i]?.focus();
  }

  function itemButtons(): HTMLButtonElement[] {
    return [
      ...(bar.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menu"] [role="menuitem"]:not([aria-disabled="true"])',
      ) ?? []),
    ];
  }

  // Move focus into a menu that was just opened from the keyboard.
  useEffect(() => {
    if (openId === null || pending.current === null) return;
    const items = itemButtons();
    (pending.current === "last" ? items[items.length - 1] : items[0])?.focus();
    pending.current = null;
  }, [openId]);

  // Alt or F10 asks for focus.
  const firstRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === firstRequest.current) return;
    firstRequest.current = focusRequest;
    if (bar.current?.contains(document.activeElement)) {
      leave();
      return;
    }
    remember();
    focusTop(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // A tap of Alt on its own (no other key between press and release) focuses the bar.
  useEffect(() => {
    let armed = false;
    const down = (e: globalThis.KeyboardEvent) => {
      armed = e.key === "Alt" && !e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Alt" && armed) {
        const ui = workbench.ui.getState();
        if (ui.dialogs.length === 0 && !ui.paletteOpen) {
          e.preventDefault();
          void workbench.runCommand("view.focusMenuBar");
        }
      }
      armed = false;
    };
    const pointer = () => {
      armed = false;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, [workbench]);

  // Clicking elsewhere closes an open menu without stealing focus back.
  useEffect(() => {
    if (openId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && bar.current?.contains(e.target)) return;
      returnFocus.current = null;
      setOpenId(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openId]);

  function activate(entry: MenuEntry) {
    if (entry.command.enabled && !entry.command.enabled()) return;
    // Restore focus first: edit commands act on the focused editor.
    leave();
    void workbench.runCommand(entry.command.id);
  }

  function adjacent(i: number, step: 1 | -1): number {
    return (i + step + menus.length) % menus.length;
  }

  function onTopKeyDown(event: KeyboardEvent<HTMLButtonElement>, i: number) {
    const key = event.key;
    if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault();
      const next = adjacent(i, key === "ArrowRight" ? 1 : -1);
      if (openId !== null) openMenu(next, "first");
      else focusTop(next);
    } else if (key === "ArrowDown" || key === "Enter" || key === " ") {
      event.preventDefault();
      openMenu(i, "first");
    } else if (key === "ArrowUp") {
      event.preventDefault();
      openMenu(i, "last");
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      const target = key === "Home" ? 0 : menus.length - 1;
      if (openId !== null) openMenu(target, "first");
      else focusTop(target);
    } else if (key === "Escape") {
      event.preventDefault();
      if (openId !== null) setOpenId(null);
      else leave();
    } else if (key === "Tab") {
      setOpenId(null);
      returnFocus.current = null;
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>, i: number) {
    const key = event.key;
    const items = itemButtons();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (key === "ArrowDown") move(at + 1);
    else if (key === "ArrowUp") move(at < 0 ? items.length - 1 : at - 1);
    else if (key === "Home") move(0);
    else if (key === "End") move(items.length - 1);
    else if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault();
      openMenu(adjacent(i, key === "ArrowRight" ? 1 : -1), "first");
    } else if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenId(null);
      topRefs.current[i]?.focus();
    } else if (key === "Tab") {
      setOpenId(null);
      returnFocus.current = null;
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLButtonElement | null)?.click();
    } else if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Type-ahead: jump to the next item starting with this letter.
      const letter = key.toLowerCase();
      const order = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      const hit = order.find((b) => (b.dataset.label ?? "").toLowerCase().startsWith(letter));
      if (hit) {
        event.preventDefault();
        hit.focus();
      }
    }
  }

  return (
    <div
      ref={bar}
      className="menubar"
      role="menubar"
      aria-label="Application menu"
      onBlur={(e) => {
        if (!bar.current?.contains(e.relatedTarget as Node | null)) setOpenId(null);
      }}
    >
      {menus.map((menu, i) => {
        const open = openId === menu.id;
        return (
          <div key={menu.id} className="menu-wrap" role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                topRefs.current[i] = el;
              }}
              className="menu-top"
              aria-haspopup="menu"
              aria-expanded={open}
              tabIndex={i === index ? 0 : -1}
              onClick={() => (open ? setOpenId(null) : openMenu(i, null))}
              onPointerEnter={() => {
                if (openId !== null && !open) openMenu(i, null);
              }}
              onKeyDown={(e) => onTopKeyDown(e, i)}
            >
              {menu.label}
            </button>
            {open && (
              <ul
                role="menu"
                className="menu"
                aria-label={menu.label}
                onKeyDown={(e) => onMenuKeyDown(e, i)}
              >
                {menu.groups.map((group, g) => [
                  g > 0 ? (
                    <li key={`sep-${g}`} role="separator" className="menu-separator" />
                  ) : null,
                  ...group.map((entry) => {
                    const enabled = entry.command.enabled ? entry.command.enabled() : true;
                    return (
                      <li key={entry.command.id} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item"
                          tabIndex={-1}
                          data-label={entry.label}
                          aria-disabled={!enabled}
                          aria-keyshortcuts={entry.keys ?? undefined}
                          onClick={() => activate(entry)}
                        >
                          <span>{entry.label}</span>
                          {entry.keys && <span className="menu-keys">{entry.keys}</span>}
                        </button>
                      </li>
                    );
                  }),
                ])}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
