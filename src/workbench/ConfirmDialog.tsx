import { useEffect, useRef, type KeyboardEvent } from "react";
import type { DialogRequest } from "./workbench";

export interface ConfirmDialogProps extends DialogRequest {
  onChoose(value: string): void;
}

/** Modal alert dialog: focus is moved in, trapped while open and restored on close. */
export function ConfirmDialog({
  title,
  message,
  actions,
  cancelValue,
  initialFocus,
  onChoose,
}: ConfirmDialogProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = [...(root.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    // A dialog whose first action destroys something names the safe one to start on.
    const start =
      initialFocus === undefined ? undefined : actions.findIndex((a) => a.value === initialFocus);
    buttons[start !== undefined && start >= 0 ? start : 0]?.focus();
    return () => previous?.focus();
    // Focus is placed once, when the dialog appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onChoose(cancelValue);
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...(root.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    // Focus that has strayed out of the buttons (a click on the text) comes back in.
    if (!buttons.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={root}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
        onKeyDown={onKeyDown}
      >
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-message" style={{ whiteSpace: "pre-line" }}>
          {message}
        </p>
        <div className="dialog-actions">
          {actions.map((action) => (
            <button key={action.value} type="button" onClick={() => onChoose(action.value)}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
