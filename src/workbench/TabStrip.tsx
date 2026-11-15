import { useEffect, type KeyboardEvent } from "react";
import type { OpenDocument } from "../core/documents";

export const tabId = (id: string) => `tab-${id}`;
export const PANEL_ID = "editor-panel";

export interface TabStripProps {
  documents: readonly OpenDocument[];
  activeId: string | null;
  dirty: Readonly<Record<string, boolean>>;
  /** Ids of documents whose format is view-only. */
  readOnly?: ReadonlySet<string>;
  onSelect(id: string): void;
  onClose(id: string): void;
}

export function TabStrip({
  documents,
  activeId,
  dirty,
  readOnly,
  onSelect,
  onClose,
}: TabStripProps) {
  // Ctrl+Tab and the like can activate a tab that is scrolled out of sight.
  useEffect(() => {
    if (activeId !== null) {
      document
        .getElementById(tabId(activeId))
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [activeId]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Movement starts from the tab that has focus, which is the active one unless a mouse
    // click on the close button left focus elsewhere.
    const focused = documents.findIndex((d) => tabId(d.id) === (event.target as HTMLElement).id);
    const index = focused >= 0 ? focused : documents.findIndex((d) => d.id === activeId);
    if (index < 0) return;
    if (event.key === "Delete" && focused >= 0) {
      event.preventDefault();
      const doc = documents[focused];
      if (doc) onClose(doc.id);
      return;
    }
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % documents.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + documents.length) % documents.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = documents.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = documents[next];
    if (!target) return;
    onSelect(target.id);
    document.getElementById(tabId(target.id))?.focus();
  }

  if (documents.length === 0) return null;

  return (
    <div className="tabstrip" role="tablist" aria-label="Open documents" onKeyDown={onKeyDown}>
      {documents.map((doc) => {
        const selected = doc.id === activeId;
        const isDirty = dirty[doc.id] === true;
        const locked = readOnly?.has(doc.id) === true;
        return (
          <div key={doc.id} className="tab-wrap" role="presentation" data-selected={selected}>
            <button
              type="button"
              role="tab"
              id={tabId(doc.id)}
              className="tab"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              title={`${doc.path ?? doc.title}${locked ? " (read-only)" : ""}`}
              onClick={() => onSelect(doc.id)}
              // Middle-click closes the tab. Stop the browser's autoscroll on mouse down.
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                onClose(doc.id);
              }}
            >
              <span className="tab-title">{doc.title}</span>
              {locked && (
                <>
                  <span className="tab-lock" aria-hidden="true">
                    🔒
                  </span>
                  <span className="sr-only"> (read-only)</span>
                </>
              )}
              {isDirty && (
                <>
                  <span className="dirty-dot" aria-hidden="true">
                    ●
                  </span>
                  <span className="sr-only"> (unsaved changes)</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="tab-close"
              tabIndex={-1}
              aria-label={`Close ${doc.title}`}
              onClick={() => onClose(doc.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
