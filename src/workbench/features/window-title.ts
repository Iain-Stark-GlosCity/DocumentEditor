import type { Feature } from "../feature";

/** Keeps the window title in step with the active document and its unsaved-changes flag. */
export const windowTitle: Feature = {
  id: "window-title",
  activate(wb) {
    const update = () => {
      const doc = wb.activeDocument();
      const dirty = doc ? wb.ui.getState().dirty[doc.id] === true : false;
      const title = doc ? `${dirty ? "● " : ""}${doc.title} - DocumentEditor` : "DocumentEditor";
      document.title = title;
      wb.platform.setWindowTitle(title).catch(() => {});
    };
    update();
    const offs = [wb.documents.subscribe(update), wb.ui.subscribe(update)];
    return () => offs.forEach((off) => off());
  },
};
