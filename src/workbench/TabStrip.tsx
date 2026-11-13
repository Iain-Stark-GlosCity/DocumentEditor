import type { KeyboardEvent } from "react";
import type { OpenDocument } from "../core/documents";

export const tabId = (id: string) => `tab-${id}`;
export const PANEL_ID = "editor-panel";

export interface TabStripProps {
  documents: readonly OpenDocument[];
  activeId: string | null;
  dirty: Readonly<Record<string, boolean>>;
  onSelect(id: string): void;
  onClose(id: string): void;
}

export function TabStrip({ documents, activeId, dirty, onSelect, onClose }: TabStripProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = documents.findIndex((d) => d.id === activeId);
    if (index < 0) return;
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
              title={doc.path ?? doc.title}
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
