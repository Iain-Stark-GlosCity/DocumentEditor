import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ButtonModel, SelectModel } from "./ribbon-model";

/** Line icons: 16 by 16, 1.5 wide strokes in the text colour, so they follow every theme. */
export function RibbonIcon({ d }: { d: string }) {
  return (
    <svg
      className="ribbon-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export const CHEVRON = "M4 6l4 4 4-4";

/** `aria-keyshortcuts` wants `Control`, the tooltip shows `Ctrl`. */
export const ariaKeys = (keys: string | null): string | undefined =>
  keys ? keys.replace(/^Ctrl\b/, "Control").replace(/\+Ctrl\b/, "+Control") : undefined;

export interface ItemProps<T> {
  item: T;
  /** The one item of the toolbar that is in the tab order. */
  tabStop: boolean;
  /** Where the item sits: the toolbar strip or the overflow popup. */
  scope: "strip" | "popup";
  run(command: string): void;
}

export function RibbonButton({ item, tabStop, scope, run }: ItemProps<ButtonModel>) {
  return (
    <button
      type="button"
      className="ribbon-btn"
      data-ribbon-item=""
      data-scope={scope}
      data-key={item.key}
      data-tip={item.title}
      data-tip-keys={item.keys ?? undefined}
      data-pane-focus={tabStop && scope === "strip" ? "" : undefined}
      tabIndex={scope === "strip" && tabStop ? 0 : -1}
      aria-label={item.title}
      aria-keyshortcuts={ariaKeys(item.keys)}
      aria-pressed={item.pressed ?? undefined}
      aria-disabled={item.enabled ? undefined : true}
      onClick={() => {
        if (item.enabled) run(item.command);
      }}
    >
      <RibbonIcon d={item.icon} />
    </button>
  );
}

/** A compact menu button for one choice out of several, such as the block type. */
export function RibbonSelect({ item, tabStop, scope, run }: ItemProps<SelectModel>) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);

  const options = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

  // A menu opened from the keyboard takes focus; one opened with the mouse leaves it where it was.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const all = options();
    (all.find((b) => b.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
  }, [open]);

  // Keep the menu on screen at narrow widths.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!open || !el) return;
    const right = el.getBoundingClientRect().right;
    el.classList.toggle("ribbon-menu--end", right > window.innerWidth - 4);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && wrap.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  function openWith(keyboard: boolean) {
    focusOnOpen.current = keyboard;
    setOpen(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      openWith(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => all[(to + all.length) % all.length]?.focus();
    const handled = (fn: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      fn();
    };
    switch (event.key) {
      case "ArrowDown":
        return handled(() => move(at + 1));
      case "ArrowUp":
        return handled(() => move(at < 0 ? all.length - 1 : at - 1));
      case "Home":
        return handled(() => move(0));
      case "End":
        return handled(() => move(all.length - 1));
      case "Escape":
        return handled(() => {
          setOpen(false);
          trigger.current?.focus();
        });
      case "Tab":
        setOpen(false);
        return;
      case "ArrowLeft":
      case "ArrowRight":
        // Not for the toolbar: the menu is open.
        return handled(() => undefined);
    }
  }

  return (
    <div ref={wrap} className="ribbon-select">
      <button
        ref={trigger}
        type="button"
        className="ribbon-btn ribbon-select-btn"
        data-ribbon-item=""
        data-scope={scope}
        data-key={item.key}
        data-tip={item.label}
        data-pane-focus={tabStop && scope === "strip" ? "" : undefined}
        tabIndex={scope === "strip" && tabStop ? 0 : -1}
        aria-label={`${item.label}: ${item.value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={item.enabled ? undefined : true}
        onClick={(e) => {
          if (!item.enabled) return;
          // A keyboard activation (Enter, Space) arrives as a click with no pointer.
          if (open) setOpen(false);
          else openWith(e.detail === 0);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="ribbon-select-text">{item.value}</span>
        <RibbonIcon d={CHEVRON} />
      </button>
      {open && (
        <ul
          ref={menu}
          role="menu"
          className="ribbon-menu"
          aria-label={item.label}
          onKeyDown={onMenuKeyDown}
        >
          {item.options.map((option) => (
            <li key={option.command} role="none">
              <button
                type="button"
                role="menuitemradio"
                className="ribbon-menu-item"
                tabIndex={-1}
                aria-checked={option.active}
                aria-disabled={option.enabled ? undefined : true}
                aria-keyshortcuts={ariaKeys(option.keys)}
                onClick={() => {
                  setOpen(false);
                  if (option.enabled) run(option.command);
                  else trigger.current?.focus();
                }}
              >
                <span className="ribbon-menu-label">{option.label}</span>
                {option.keys && <span className="ribbon-menu-keys">{option.keys}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
