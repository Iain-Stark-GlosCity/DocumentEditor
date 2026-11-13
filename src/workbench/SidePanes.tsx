import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { SidePane } from "./feature";
import { useSetting } from "./hooks";
import type { Workbench } from "./workbench";
import { useZenMode } from "./zen";

const MIN = 15;
const MAX = 85;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/**
 * One docked pane with its splitter. Left panes sit before the editor with the splitter on
 * their right edge; right panes sit after it with the splitter on their left. Sizes are
 * percentages of the editor area and are saved in the `ui.paneSizes` setting.
 */
function SidePaneSlot({
  pane,
  workbench,
  hidden,
}: {
  pane: SidePane;
  workbench: Workbench;
  hidden: boolean;
}) {
  const visible = pane.useVisible(workbench);
  const sizes = useSetting(workbench, "ui.paneSizes");
  const size = sizes[pane.id] ?? pane.defaultSize ?? 40;
  const dragging = useRef(false);
  if (!visible) return null;
  const Content = pane.component;
  const left = pane.side === "left";

  const setSize = (next: number) => {
    workbench.settings.set("ui.paneSizes", {
      ...workbench.settings.get("ui.paneSizes"),
      [pane.id]: clamp(next),
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    // Moving the splitter away from its pane makes the pane wider.
    const grow = left ? "ArrowRight" : "ArrowLeft";
    const shrink = left ? "ArrowLeft" : "ArrowRight";
    switch (event.key) {
      case grow:
        setSize(size + step);
        break;
      case shrink:
        setSize(size - step);
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
    const x = left ? event.clientX - area.left : area.right - event.clientX;
    setSize((x / area.width) * 100);
  }

  const splitter = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${pane.title.toLowerCase()}`}
      aria-valuenow={Math.round(size)}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      className="splitter"
      hidden={hidden}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    />
  );
  const section = (
    <section
      className="side-pane"
      aria-label={pane.title}
      data-side={left ? "left" : "right"}
      hidden={hidden}
      style={{ flexBasis: `${size}%` }}
    >
      <Content workbench={workbench} />
    </section>
  );
  return left ? (
    <>
      {section}
      {splitter}
    </>
  ) : (
    <>
      {splitter}
      {section}
    </>
  );
}

/**
 * The editor with any visible side panes docked either side, each with its own
 * keyboard-operable splitter. Panes stay mounted but hidden in zen mode, so they keep their state.
 */
export function EditorArea({ workbench, children }: { workbench: Workbench; children: ReactNode }) {
  const zen = useZenMode(workbench);
  const panes = workbench.features.flatMap((f) => (f.sidePane ? [f.sidePane] : []));
  const slots = (side: "left" | "right") =>
    panes
      .filter((p) => (p.side ?? "right") === side)
      .map((pane) => <SidePaneSlot key={pane.id} pane={pane} workbench={workbench} hidden={zen} />);
  return (
    <div className="editor-area">
      {slots("left")}
      <div className="editor-main">{children}</div>
      {slots("right")}
    </div>
  );
}
