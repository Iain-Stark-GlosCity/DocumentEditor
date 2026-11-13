import { useCommands } from "./hooks";
import { commandKeys, formatKey } from "./keys";
import type { Workbench } from "./workbench";

const SHORTCUTS = ["file.new", "file.open", "view.commandPalette"];

/** Shown when no tabs are open. */
export function EmptyState({ workbench }: { workbench: Workbench }) {
  const commands = useCommands(workbench);
  const shortcuts = SHORTCUTS.flatMap((id) => {
    const command = commands.find((c) => c.id === id);
    return command ? [command] : [];
  });
  return (
    <div className="empty-state">
      <h2>No document open</h2>
      <p>Start a new file, or open one that you already have.</p>
      <div className="empty-actions">
        <button type="button" onClick={() => void workbench.runCommand("file.new")}>
          New file
        </button>
        <button type="button" onClick={() => void workbench.runCommand("file.open")}>
          Open file…
        </button>
      </div>
      <dl className="empty-shortcuts">
        {shortcuts.map((command) => (
          <div key={command.id}>
            <dt>{command.title}</dt>
            <dd>
              {commandKeys(command).map((key) => (
                <kbd key={key}>{formatKey(key)}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
