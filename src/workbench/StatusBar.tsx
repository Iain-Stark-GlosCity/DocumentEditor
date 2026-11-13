import type { StatusItem } from "./feature";
import { useActiveDocument } from "./hooks";
import type { Workbench } from "./workbench";

function sorted(items: readonly StatusItem[], align: "left" | "right"): StatusItem[] {
  return items
    .filter((i) => (i.align ?? "left") === align)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Renders the status items contributed by features. */
export function StatusBar({ workbench }: { workbench: Workbench }) {
  const active = useActiveDocument(workbench);
  const items = workbench.features.flatMap((f) => f.statusItems ?? []);
  const render = (list: StatusItem[]) =>
    list.map(({ id, component: Item }) => (
      <div key={id} className="status-item">
        <Item workbench={workbench} />
      </div>
    ));
  return (
    <footer className="statusbar" aria-label="Status">
      {active === null && <span>No document open</span>}
      {render(sorted(items, "left"))}
      <div className="status-right">{render(sorted(items, "right"))}</div>
    </footer>
  );
}
