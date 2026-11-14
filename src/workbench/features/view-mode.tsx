/**
 * View modes, from the `editor.viewMode` setting:
 *
 * - `source`: the Markdown as written.
 * - `live`: live preview. The same text, with formatting shown in place and the syntax revealed
 *   where the caret is (the format provider's decorations; the text never changes).
 * - `split`: the source editor beside a rendered preview. The split pane belongs to the preview
 *   feature; in split view the editor itself is in source mode.
 *
 * The mode is one setting for the whole app. A document whose format does not support the
 * chosen mode is shown in source mode (the workbench falls back), and the status bar shows
 * the mode actually in effect. Changing the mode rebuilds only the provider's editor
 * extensions (a compartment reconfigure), so caret, scroll and undo history are kept.
 *
 * "Cycle view mode" steps source → live → split → source, skipping modes the active format does
 * not support. Titles carry the current mode, so the menu and palette show it (the same
 * re-registering approach as the autosave command).
 */
import type { ViewMode } from "../../core/format";
import type { Command } from "../../core/commands";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument, useCommands, useSetting } from "../hooks";
import type { Workbench } from "../workbench";

const ORDER: readonly ViewMode[] = ["source", "live", "split"];

const NAMES: Record<ViewMode, string> = {
  source: "Source",
  live: "Live preview",
  split: "Split",
};

/** The modes the active document's format supports (source only if none is open). */
export function supportedModes(wb: Workbench): readonly ViewMode[] {
  const doc = wb.activeDocument();
  const provider = doc ? wb.registry.byId(doc.providerId) : undefined;
  return provider ? ORDER.filter((m) => provider.viewModes.includes(m)) : ["source"];
}

/** The mode actually in effect for the active document. */
export function effectiveMode(wb: Workbench): ViewMode {
  const requested = wb.settings.get("editor.viewMode");
  return supportedModes(wb).includes(requested) ? requested : "source";
}

export function nextMode(wb: Workbench): ViewMode {
  const modes = supportedModes(wb);
  const current = effectiveMode(wb);
  return modes[(modes.indexOf(current) + 1) % modes.length] ?? "source";
}

function setMode(wb: Workbench, mode: ViewMode): void {
  if (!supportedModes(wb).includes(mode)) {
    wb.notify({ message: `This kind of document has no ${NAMES[mode].toLowerCase()} view.` });
    return;
  }
  wb.settings.set("editor.viewMode", mode);
}

function commandsFor(wb: Workbench): Command[] {
  return [
    {
      id: "view.sourceMode",
      title: "Source mode",
      run: () => setMode(wb, "source"),
    },
    {
      id: "view.liveMode",
      title: "Live preview mode",
      enabled: () => supportedModes(wb).includes("live"),
      run: () => setMode(wb, "live"),
    },
    {
      id: "view.cycleViewMode",
      title: "Cycle view mode",
      defaultKey: "Alt-m",
      run: () => setMode(wb, nextMode(wb)),
    },
  ];
}

function ViewModeStatus({ workbench }: FeatureComponentProps) {
  // Subscribing re-renders when the mode or the active document changes.
  useSetting(workbench, "editor.viewMode");
  useCommands(workbench);
  const doc = useActiveDocument(workbench);
  if (!doc) return null;
  const mode = effectiveMode(workbench);
  const next = nextMode(workbench);
  return (
    <button
      type="button"
      className="view-mode-button"
      aria-label={`View mode: ${NAMES[mode]}. Switch to ${NAMES[next].toLowerCase()}`}
      title={`Switch to ${NAMES[next].toLowerCase()} (Alt+M)`}
      onClick={() => void workbench.runCommand("view.cycleViewMode")}
    >
      {NAMES[mode]}
    </button>
  );
}

export const viewMode: Feature = {
  id: "view-mode",

  activate(wb) {
    let key = "";
    let unregister: (() => void)[] = [];
    const register = () => {
      const commands = commandsFor(wb);
      const next = commands.map((c) => c.title).join("|");
      if (next === key) return;
      key = next;
      unregister.forEach((off) => off());
      unregister = commands.map((c) => wb.commands.register(c));
    };
    register();
    const offs = [
      wb.settings.subscribe("editor.viewMode", register),
      wb.onDidChangeActiveDocument(register),
      // Images in live preview follow the remote image setting.
      wb.settings.subscribe("preview.loadRemoteImages", () => wb.reconfigureEditors("provider")),
    ];
    return () => {
      offs.forEach((off) => off());
      unregister.forEach((off) => off());
    };
  },

  statusItems: [{ id: "view-mode", align: "right", order: 5, component: ViewModeStatus }],

  menuItems: [
    {
      menu: "view",
      group: "4_mode",
      command: "view.sourceMode",
      order: 1,
      submenu: "View mode",
      label: "Source",
      radio: true,
      checked: (wb) => effectiveMode(wb) === "source",
    },
    {
      menu: "view",
      group: "4_mode",
      command: "view.liveMode",
      order: 2,
      submenu: "View mode",
      label: "Live preview",
      radio: true,
      checked: (wb) => effectiveMode(wb) === "live",
    },
    {
      menu: "view",
      group: "4_mode",
      command: "view.cycleViewMode",
      order: 3,
      submenu: "View mode",
    },
  ],
};
