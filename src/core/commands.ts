/** Every user action is a registered command (CLAUDE.md rule 7). */
export interface Command {
  /** Namespaced id, for example `file.save`. */
  id: string;
  /** Sentence case, British English. */
  title: string;
  /** CodeMirror-style key notation, for example `Mod-Shift-s`. */
  defaultKey?: string;
  /** Further keys that run the same command, for example `F1`. */
  altKeys?: readonly string[];
  /**
   * The key is handled natively by the editor or browser (undo, copy and so on). It is shown in
   * menus and the palette but not dispatched by the global key handler.
   */
  nativeKey?: boolean;
  /** Menus and the palette disable the command when this returns false. Default: enabled. */
  enabled?(): boolean;
  run(): void | Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly listeners = new Set<() => void>();
  private list: readonly Command[] = [];

  /** Registers a command and returns a function that removes it again. */
  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.commands.set(command.id, command);
    this.changed();
    return () => {
      if (this.commands.get(command.id) === command) {
        this.commands.delete(command.id);
        this.changed();
      }
    };
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** The same array instance until the set of commands changes (safe for useSyncExternalStore). */
  all(): readonly Command[] {
    return this.list;
  }

  /** Calls back when commands are added or removed. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async execute(id: string): Promise<void> {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Unknown command "${id}"`);
    await command.run();
  }

  private changed(): void {
    this.list = [...this.commands.values()];
    for (const listener of [...this.listeners]) listener();
  }
}
