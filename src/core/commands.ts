/** Every user action is a registered command (CLAUDE.md rule 7). */
export interface Command {
  /** Namespaced id, for example `file.save`. */
  id: string;
  /** Sentence case, British English. */
  title: string;
  /** CodeMirror-style key notation, for example `Mod-Shift-s`. */
  defaultKey?: string;
  run(): void | Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  /** Registers a command and returns a function that removes it again. */
  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.commands.set(command.id, command);
    return () => {
      if (this.commands.get(command.id) === command) this.commands.delete(command.id);
    };
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  all(): readonly Command[] {
    return [...this.commands.values()];
  }

  async execute(id: string): Promise<void> {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Unknown command "${id}"`);
    await command.run();
  }
}
