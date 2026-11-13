import type { Feature } from "../feature";

/** Ctrl+Tab and Ctrl+Shift+Tab cycle through the open documents. */
export const tabs: Feature = {
  id: "tabs",
  commands: (wb) => {
    const cycle = (step: 1 | -1) => () => {
      const { documents, activeId } = wb.documents.getState();
      if (documents.length < 2) return;
      const index = documents.findIndex((d) => d.id === activeId);
      const next = documents[(index + step + documents.length) % documents.length];
      if (next) wb.documents.getState().setActive(next.id);
    };
    const several = () => wb.documents.getState().documents.length > 1;
    return [
      {
        id: "tabs.next",
        title: "Next tab",
        defaultKey: "Mod-Tab",
        enabled: several,
        run: cycle(1),
      },
      {
        id: "tabs.previous",
        title: "Previous tab",
        defaultKey: "Mod-Shift-Tab",
        enabled: several,
        run: cycle(-1),
      },
    ];
  },
};
