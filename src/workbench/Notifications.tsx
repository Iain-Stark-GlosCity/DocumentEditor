import { useStore } from "zustand";
import type { Workbench } from "./workbench";

/** Non-modal banners with optional actions. Errors are announced assertively. */
export function Notifications({ workbench }: { workbench: Workbench }) {
  const notifications = useStore(workbench.ui, (s) => s.notifications);
  return (
    <>
      {notifications.map((n) => (
        <div
          key={n.id}
          className="banner"
          data-kind={n.kind ?? "info"}
          role={n.kind === "error" ? "alert" : "status"}
        >
          <span>{n.message}</span>
          <span className="banner-actions">
            {n.actions?.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  workbench.dismissNotification(n.id);
                  action.run();
                }}
              >
                {action.label}
              </button>
            ))}
            <button type="button" onClick={() => workbench.dismissNotification(n.id)}>
              Dismiss
            </button>
          </span>
        </div>
      ))}
    </>
  );
}
