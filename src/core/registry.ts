import type { FormatProvider } from "./format";

/** Lower-case extension of the final path segment, without the dot, or "" if there is none. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export interface RegisterOptions {
  /** The format a new, unsaved document starts as. At most one provider claims this. */
  default?: boolean;
  /** The format for a file whose extension no provider claims. At most one provider claims this. */
  fallback?: boolean;
}

export class FormatRegistry {
  private readonly providers = new Map<string, FormatProvider>();
  private defaultId: string | undefined;
  private fallbackId: string | undefined;

  register(provider: FormatProvider, options: RegisterOptions = {}): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`A format with id "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
    if (options.default) this.defaultId = provider.id;
    if (options.fallback) this.fallbackId = provider.id;
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

  /** The format for a new, unsaved document: the one registered as default, else the first. */
  defaultProvider(): FormatProvider | undefined {
    return (this.defaultId ? this.providers.get(this.defaultId) : undefined) ?? this.all()[0];
  }

  /** The format for a file nobody claims: the registered fallback, else the default. */
  fallbackProvider(): FormatProvider | undefined {
    return (
      (this.fallbackId ? this.providers.get(this.fallbackId) : undefined) ?? this.defaultProvider()
    );
  }

  /** The format to open a path as: the one that claims its extension, else the fallback. */
  resolve(path: string): FormatProvider | undefined {
    return this.forPath(path) ?? this.fallbackProvider();
  }

  all(): readonly FormatProvider[] {
    return [...this.providers.values()];
  }
}
