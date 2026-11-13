import type { FormatProvider } from "./format";

/** Lower-case extension of the final path segment, without the dot, or "" if there is none. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export class FormatRegistry {
  private readonly providers = new Map<string, FormatProvider>();

  register(provider: FormatProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`A format with id "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  byId(id: string): FormatProvider | undefined {
    return this.providers.get(id);
  }

  /** The first registered provider that claims the file's extension (case-insensitive). */
  forPath(path: string): FormatProvider | undefined {
    const ext = extensionOf(path);
    if (ext === "") return undefined;
    return this.all().find((p) => p.fileExtensions.some((e) => e.toLowerCase() === ext));
  }

  all(): readonly FormatProvider[] {
    return [...this.providers.values()];
  }
}
