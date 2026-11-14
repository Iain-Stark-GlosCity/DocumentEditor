import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { CHEVRON, RibbonButton, RibbonIcon, RibbonSelect } from "./RibbonItems";
import { createRibbonStore, groupsThatFit, type GroupModel, type ItemModel } from "./ribbon-model";
import type { Workbench } from "./workbench";

const MORE_KEY = "more";
const TIP_DELAY_MS = 450;

interface Tip {
  title: string;
  keys: string | null;
  anchor: { left: number; width: number; bottom: number };
}

/** The elements of a toolbar scope that take part in arrow-key movement. */
function itemsIn(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>("[data-ribbon-item]")];
}

/**
 * The formatting ribbon: one strip of icon buttons for the active document's format, drawn from
 * the provider's declared toolbar. Groups that do not fit move into a "More" popup. It renders
 * nothing when there is no toolbar, so the editor gets the room back.
 */
export function Ribbon({ workbench }: { workbench: Workbench }) {
  const store = useMemo(() => createRibbonStore(workbench), [workbench]);
  const groups = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const tipTimer = useRef<number | null>(null);
  const hovered = useRef<Element | null>(null);
  const focusPopup = useRef(false);

  const [width, setWidth] = useState<number | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);

  const present = groups.length > 0;

  // How much room the strip has. Without ResizeObserver (tests) everything is shown.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = (w: number) => setWidth(w > 0 ? Math.floor(w) : null);
    measure(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [present]);

  const fit = groupsThatFit(groups, width);
  const inline = groups.slice(0, fit);
  const overflow = groups.slice(fit);
  const popupOpen = open && overflow.length > 0;

  const keys = [
    ...inline.flatMap((g) => g.items.map((i) => i.key)),
    ...(overflow.length ? [MORE_KEY] : []),
  ];
  const tabStop = stop !== null && keys.includes(stop) ? stop : (keys[0] ?? null);

  const hideTip = useCallback(() => {
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = null;
    hovered.current = null;
    setTip(null);
  }, []);

  useEffect(() => () => hideTip(), [hideTip]);

  function showTip(el: Element, delay: number) {
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    const title = el.getAttribute("data-tip");
    if (!title) return;
    const keysText = el.getAttribute("data-tip-keys");
    const reveal = () => {
      const rect = el.getBoundingClientRect();
      setTip({
        title,
        keys: keysText,
        anchor: { left: rect.left, width: rect.width, bottom: rect.bottom },
      });
    };
    if (delay === 0) reveal();
    else tipTimer.current = window.setTimeout(reveal, delay);
  }

  // Centre the tooltip under its button, kept inside the window.
  useLayoutEffect(() => {
    const el = tipEl.current;
    if (!tip || !el) return;
    const w = el.offsetWidth;
    const left = tip.anchor.left + tip.anchor.width / 2 - w / 2;
    el.style.left = `${Math.max(4, Math.min(left, window.innerWidth - w - 4))}px`;
    el.style.top = `${tip.anchor.bottom + 6}px`;
  }, [tip]);

  // Place the popup under More, kept inside the window.
  useLayoutEffect(() => {
    const el = popup.current;
    const anchor = moreButton.current;
    const host = root.current;
    if (!popupOpen || !el || !anchor || !host) return;
    const hostRect = host.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = Math.max(
      4,
      Math.min(anchor.getBoundingClientRect().left, window.innerWidth - w - 4),
    );
    el.style.left = `${left - hostRect.left}px`;
  }, [popupOpen, overflow.length]);

  // A popup opened from the keyboard takes focus.
  useEffect(() => {
    if (!popupOpen || !focusPopup.current) return;
    focusPopup.current = false;
    if (popup.current) itemsIn(popup.current)[0]?.focus();
  }, [popupOpen]);

  // A click outside closes the popup.
  useEffect(() => {
    if (!popupOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [popupOpen]);

  function run(command: string) {
    hideTip();
    setOpen(false);
    // Return to the editor first, as the menus do: commands act on the focused editor.
    workbench.focusEditor();
    void workbench.runCommand(command);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      hideTip();
      if (popupOpen) {
        const inPopup = popup.current?.contains(target);
        setOpen(false);
        if (inPopup) moreButton.current?.focus();
        return;
      }
      workbench.focusEditor();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Tab" && popupOpen && popup.current?.contains(target)) {
      setOpen(false);
      return;
    }
    const keyed = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keyed.includes(event.key)) return;
    const scope = target.closest(".ribbon-strip, .ribbon-popup");
    if (!scope) return;
    const items = itemsIn(scope);
    const at = items.indexOf(target);
    // Focus on a menu inside an item is that menu's business.
    if (at < 0) return;
    event.preventDefault();
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (at + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[to]?.focus();
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset["scope"] === "strip") setStop(target.dataset["key"] ?? null);
    const tipped = target.closest("[data-tip]");
    if (tipped) showTip(tipped, 0);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    hideTip();
    const next = event.relatedTarget;
    if (popupOpen && !(next instanceof Node && root.current?.contains(next))) setOpen(false);
  }

  function onMouseOver(event: MouseEvent<HTMLDivElement>) {
    const el = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    if (el === hovered.current) return;
    hovered.current = el;
    if (el) showTip(el, TIP_DELAY_MS);
    else hideTip();
  }

  function onMouseLeave() {
    hideTip();
  }

  function renderItem(item: ItemModel, scope: "strip" | "popup") {
    const props = { tabStop: item.key === tabStop, scope, run };
    return item.kind === "button" ? (
      <RibbonButton key={item.key} item={item} {...props} />
    ) : (
      <RibbonSelect key={item.key} item={item} {...props} />
    );
  }

  if (!present) return null;

  return (
    <div
      ref={root}
      className="ribbon"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseOver={onMouseOver}
      onMouseLeave={onMouseLeave}
      // Pressing a button must not take focus (and the selection) away from the editor.
      onMouseDown={(e) => {
        if (e.target instanceof Element && e.target.closest("button")) e.preventDefault();
      }}
    >
      <div ref={strip} className="ribbon-strip" role="toolbar" aria-label="Formatting">
        {inline.map((group, i) => (
          <Fragment key={group.id}>
            {i > 0 && (
              <div className="ribbon-divider" role="separator" aria-orientation="vertical" />
            )}
            <div className="ribbon-group" role="group" aria-label={group.label}>
              {group.items.map((item) => renderItem(item, "strip"))}
            </div>
          </Fragment>
        ))}
        {overflow.length > 0 && (
          <>
            {inline.length > 0 && (
              <div className="ribbon-divider" role="separator" aria-orientation="vertical" />
            )}
            <button
              ref={moreButton}
              type="button"
              className="ribbon-btn ribbon-more"
              data-ribbon-item=""
              data-scope="strip"
              data-key={MORE_KEY}
              data-tip="More formatting"
              data-pane-focus={tabStop === MORE_KEY ? "" : undefined}
              tabIndex={tabStop === MORE_KEY ? 0 : -1}
              aria-label="More"
              aria-haspopup="true"
              aria-expanded={popupOpen}
              aria-controls={popupOpen ? "ribbon-popup" : undefined}
              onClick={(e) => {
                hideTip();
                focusPopup.current = e.detail === 0;
                setOpen((o) => !o);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  focusPopup.current = true;
                  setOpen(true);
                }
              }}
            >
              <RibbonIcon d={CHEVRON} />
            </button>
          </>
        )}
      </div>
      {popupOpen && (
        <div
          ref={popup}
          id="ribbon-popup"
          className="ribbon-popup"
          role="group"
          aria-label="More formatting"
        >
          {overflow.map((group: GroupModel) => (
            <div key={group.id} className="ribbon-popup-row" role="group" aria-label={group.label}>
              <span className="ribbon-popup-label" aria-hidden="true">
                {group.label}
              </span>
              <div className="ribbon-group">
                {group.items.map((item) => renderItem(item, "popup"))}
              </div>
            </div>
          ))}
        </div>
      )}
      {tip && (
        <div ref={tipEl} className="ribbon-tip" role="tooltip">
          {tip.title}
          {tip.keys && <span className="ribbon-tip-keys">{tip.keys}</span>}
        </div>
      )}
    </div>
  );
}
