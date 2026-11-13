import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { SidePane } from "./feature";
import type { Workbench } from "./workbench";

const MIN = 15;
const MAX = 85;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

function SidePaneSlot({ pane, workbench }: { pane: SidePane; workbench: Workbench }) {
  const visible = pane.useVisible(workbench);
  const [size, setSize] = useState(pane.defaultSize ?? 40);
  const dragging = useRef(false);
  if (!visible) return null;
  const Content = pane.component;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    // The pane sits on the right: moving the splitter left makes it wider.
    switch (event.key) {
      case "ArrowLeft":
        setSize((s) => clamp(s + step));
        break;
      case "ArrowRight":
        setSize((s) => clamp(s - step));
        break;
      case "Home":
        setSize(MIN);
        break;
      case "End":
        setSize(MAX);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const area = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!area || area.width === 0) return;
    setSize(clamp(((area.right - event.clientX) / area.width) * 100));
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${pane.title.toLowerCase()}`}
        aria-valuenow={Math.round(size)}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        tabIndex={0}
        className="splitter"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
      <section className="side-pane" aria-label={pane.title} style={{ flexBasis: `${size}%` }}>
        <Content workbench={workbench} />
      </section>
    </>
  );
}

/** The editor beside any visible side panes, with a keyboard-operable splitter between. */
export function EditorArea({ workbench, children }: { workbench: Workbench; children: ReactNode }) {
  const panes = workbench.features.flatMap((f) => (f.sidePane ? [f.sidePane] : []));
  return (
    <div className="editor-area">
      <div className="editor-main">{children}</div>
      {panes.map((pane) => (
        <SidePaneSlot key={pane.id} pane={pane} workbench={workbench} />
      ))}
    </div>
  );
}
