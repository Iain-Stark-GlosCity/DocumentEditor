/**
 * Makes the parts of container files (DOCX, ODT, XLSX, PPTX, EPUB: zip archives) look like files.
 *
 * `ContainerPlatform` wraps the real platform. A path such as `C:\docs\report.docx!/word/document.xml`
 * reads, stats, watches and saves the part inside the archive; the container itself reads as the
 * format's read-only `binary` view. Everything else goes straight through, so the rest of the app
 * needs no changes.
 *
 * Saving a part is the dangerous operation and is done defensively: the archive is re-read from
 * disk, only the one entry is replaced (see `replace` in `src/core/archive.ts`), the result is
 * read back and compared entry by entry BEFORE anything is written, a one-off backup is taken, and
 * the file is replaced atomically. Any failure leaves the file as it was.
 *
 * Version tokens. The workbench decides that a document "changed on disk" by comparing
 * `modifiedMs`. Saving part A changes the container's real modification time, which would make
 * every other open part look changed. So a part's `modifiedMs` is a token that moves only when
 * that part's content (CRC or size) changes; see `Tokens`.
 */
import { ArchiveError, readZip, type ZipArchive } from "../core/archive";
import { splitContainerPath } from "../core/container-path";
import type { FormatRegistry } from "../core/registry";
import { decodePartText, encodePartText } from "../core/text-codec";
import {
  FileExistsError,
  type ContainerAccess,
  type ContainerPart,
  type FileChange,
  type FileData,
  type FileDragPosition,
  type FileFilter,
  type FileFormat,
  type FilesDroppedEvent,
  type Platform,
  type RecoverySnapshot,
} from "./platform";
import { xmlProblem } from "./xml-check";

/** Parts with these extensions are text; everything else is treated as binary. */
const TEXT_EXTENSIONS = new Set([
  "xml",
  "rels",
  "txt",
  "html",
  "xhtml",
  "htm",
  "css",
  "json",
  "csv",
  "svg",
  "vml",
  "md",
]);

const XML_EXTENSIONS = new Set(["xml", "rels"]);

function partExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  // `.rels` is a name that starts with its dot: the extension is still `rels`.
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Whether a part can be opened as text, decided by its extension. */
export function isTextPart(name: string): boolean {
  return TEXT_EXTENSIONS.has(partExtension(name));
}

const READ_ONLY_MESSAGE =
  "This file is shown as a read-only view and cannot be saved over the original. Use Save as\u2026 to keep a text copy.";

const VIEW_FORMAT: FileFormat = { encoding: "utf-8", bom: false, eol: "lf", mixedEol: false };

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The key that serialises work on a container. Windows paths (a drive letter or a UNC share) are
 * case-insensitive and accept either slash, so `C:\Docs\a.docx` and `c:/docs/A.docx` must share
 * one queue, or two saves could each patch the same old bytes and the second would undo the first.
 */
function containerKey(container: string): string {
  return /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(container)
    ? container.replaceAll("/", "\\").toLowerCase()
    : container;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Throws unless `patched` is `original` with exactly the entry `part` replaced by `expected`:
 * the part reads back as the new bytes and every other entry has the same name, order, size and
 * CRC. Run before anything is written.
 */
export function verifyPatched(
  original: ZipArchive,
  patched: Uint8Array,
  part: string,
  expected: Uint8Array,
): void {
  let check: ZipArchive;
  try {
    check = readZip(patched);
  } catch (error) {
    throw new Error(`Self-check failed: the patched archive cannot be read (${describe(error)})`, {
      cause: error,
    });
  }
  if (!check.has(part) || !sameBytes(check.bytes(part), expected)) {
    throw new Error(`Self-check failed: ${part} does not read back as the saved content`);
  }
  const before = original.entries;
  const after = check.entries;
  if (before.length !== after.length) {
    throw new Error("Self-check failed: the patched archive has a different number of entries");
  }
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.name !== b.name) {
      throw new Error("Self-check failed: the order or names of the entries changed");
    }
    if (a.name === part) continue;
    if (a.size !== b.size || a.crc32 !== b.crc32) {
      throw new Error(`Self-check failed: ${a.name} would have been changed`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TokenEntry {
  crc: number;
  size: number;
  /** The container time at which this content last changed. */
  token: number;
}

/**
 * The version tokens of one container's parts. `sync` is called with every archive the platform
 * sees (and its modification time). When the container's time differs from the last one seen,
 * entries whose CRC or size changed get the container's new time as their token; the rest keep
 * theirs. First sight of an entry also gets the container's current time.
 */
class Tokens {
  private seen: number | null = null;
  private readonly entries = new Map<string, TokenEntry>();

  sync(archive: ZipArchive, modifiedMs: number): void {
    if (this.seen === modifiedMs) return;
    const next = new Map<string, TokenEntry>();
    for (const entry of archive.entries) {
      if (entry.isDirectory || next.has(entry.name)) continue;
      const old = this.entries.get(entry.name);
      const unchanged = old && old.crc === entry.crc32 && old.size === entry.size;
      next.set(entry.name, {
        crc: entry.crc32,
        size: entry.size,
        token: unchanged ? old.token : modifiedMs,
      });
    }
    this.entries.clear();
    for (const [name, entry] of next) this.entries.set(name, entry);
    this.seen = modifiedMs;
  }

  get(name: string): number | undefined {
    return this.entries.get(name)?.token;
  }
}

interface CachedArchive {
  modifiedMs: number;
  bytes: Uint8Array;
  archive: ZipArchive;
}

export class ContainerPlatform implements Platform {
  readonly containers: ContainerAccess;

  private readonly tokens = new Map<string, Tokens>();
  private readonly cache = new Map<string, CachedArchive>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly backedUp = new Set<string>();

  constructor(
    private readonly inner: Platform,
    private readonly registry: FormatRegistry,
  ) {
    this.containers = {
      containerOf: (path) => this.containerOf(path),
      listParts: (container) => this.listParts(container),
    };
  }

  // Path classification ----------------------------------------------------------------

  private isZipContainer(path: string): boolean {
    return this.registry.forPath(path)?.binary?.archive === "zip";
  }

  /** The container and part of a path, if it names a part of a zip container. */
  private partOf(path: string): { container: string; part: string } | null {
    const split = splitContainerPath(path);
    return split && this.isZipContainer(split.container) ? split : null;
  }

  private containerOf(path: string): string | null {
    const part = this.partOf(path);
    if (part) return part.container;
    return this.isZipContainer(path) ? path : null;
  }

  // Serialising and caching -------------------------------------------------------------

  /** Runs `task` after everything queued before it for this container has finished. */
  private serialised<T>(container: string, task: () => Promise<T>): Promise<T> {
    const key = containerKey(container);
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    this.chains.set(key, tail);
    void tail.then(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return run;
  }

  private tokensOf(container: string): Tokens {
    let tokens = this.tokens.get(container);
    if (!tokens) this.tokens.set(container, (tokens = new Tokens()));
    return tokens;
  }

  /**
   * The container's archive, from the cache when its modification time still matches, else read
   * from disk. Null if the file does not exist. Call inside `serialised`.
   */
  private async loadArchive(container: string): Promise<CachedArchive | null> {
    const stat = await this.inner.statFile(container);
    if (!stat) {
      this.cache.delete(container);
      return null;
    }
    let cached = this.cache.get(container);
    if (!cached || cached.modifiedMs !== stat.modifiedMs) {
      const read = await this.inner.readBinaryFile(container);
      cached = { modifiedMs: read.modifiedMs, bytes: read.bytes, archive: readZip(read.bytes) };
      this.cache.set(container, cached);
    }
    this.tokensOf(container).sync(cached.archive, cached.modifiedMs);
    return cached;
  }

  /** Reads the archive and finds a part, or throws a readable error. */
  private async withPart<T>(
    path: string,
    use: (archive: ZipArchive, token: number, part: string) => T,
  ): Promise<T> {
    const split = this.partOf(path);
    if (!split) throw new Error(`Not a path inside a container: ${path}`);
    return this.serialised(split.container, async () => {
      const loaded = await this.loadArchive(split.container);
      if (!loaded) throw new Error(`File not found: ${split.container}`);
      const info = loaded.archive.info(split.part);
      const token = this.tokensOf(split.container).get(split.part);
      if (!info || info.isDirectory || token === undefined) {
        throw new Error(`There is no part "${split.part}" in ${baseName(split.container)}`);
      }
      return use(loaded.archive, token, split.part);
    });
  }

  // ContainerAccess ---------------------------------------------------------------------

  private listParts(container: string): Promise<ContainerPart[]> {
    return this.serialised(container, async () => {
      const loaded = await this.loadArchive(container);
      if (!loaded) throw new Error(`File not found: ${container}`);
      return loaded.archive.entries
        .filter((entry) => !entry.isDirectory)
        .map((entry) => ({ name: entry.name, size: entry.size, text: isTextPart(entry.name) }));
    });
  }

  // Platform: files ----------------------------------------------------------------------

  async readFile(path: string): Promise<FileData> {
    if (this.partOf(path)) {
      return this.withPart(path, (archive, token, part) => {
        if (!isTextPart(part)) {
          throw new Error(`${part} is a binary part and cannot be opened as text`);
        }
        const { text, format } = decodePartText(archive.bytes(part));
        return { text, format, modifiedMs: token };
      });
    }
    const provider = this.registry.forPath(path);
    if (provider?.binary) {
      const { bytes, modifiedMs } = await this.inner.readBinaryFile(path);
      const decoded = await provider.binary.decode(bytes, { path });
      const text = typeof decoded === "string" ? decoded : decoded.text;
      const sourceMap = typeof decoded === "string" ? undefined : decoded.sourceMap;
      return {
        text,
        format: { ...VIEW_FORMAT },
        modifiedMs,
        ...(sourceMap ? { sourceMap } : {}),
      };
    }
    return this.inner.readFile(path);
  }

  async readBinaryFile(
    path: string,
    options?: { maxBytes?: number },
  ): Promise<{ bytes: Uint8Array; modifiedMs: number }> {
    if (this.partOf(path)) {
      return this.withPart(path, (archive, token, part) => ({
        bytes: archive.bytes(part),
        modifiedMs: token,
      }));
    }
    return this.inner.readBinaryFile(path, options);
  }

  async statFile(path: string): Promise<{ modifiedMs: number } | null> {
    const split = this.partOf(path);
    if (!split) return this.inner.statFile(path);
    return this.serialised(split.container, async () => {
      const loaded = await this.loadArchive(split.container);
      if (!loaded) return null;
      const info = loaded.archive.info(split.part);
      const token = this.tokensOf(split.container).get(split.part);
      return info && !info.isDirectory && token !== undefined ? { modifiedMs: token } : null;
    });
  }

  async fileExists(path: string): Promise<boolean> {
    if (this.partOf(path)) return (await this.statFile(path)) !== null;
    return this.inner.fileExists(path);
  }

  async writeFile(path: string, text: string, format: FileFormat): Promise<{ modifiedMs: number }> {
    const split = this.partOf(path);
    if (split) return this.writePart(split.container, split.part, text, format);
    if (this.registry.forPath(path)?.binary) throw new Error(READ_ONLY_MESSAGE);
    return this.inner.writeFile(path, text, format);
  }

  /** Saves a text part: the text is encoded, and XML parts must be well-formed. */
  private writePart(
    container: string,
    part: string,
    text: string,
    format: FileFormat,
  ): Promise<{ modifiedMs: number }> {
    return this.patchPart(container, part, () => {
      if (!isTextPart(part)) {
        throw new Error(`${part} is a binary part and cannot be saved as text`);
      }
      let bytes: Uint8Array;
      try {
        bytes = encodePartText(text, format);
      } catch (error) {
        throw new Error(`Could not save ${part}: ${describe(error)}. Nothing was saved.`, {
          cause: error,
        });
      }
      if (XML_EXTENSIONS.has(partExtension(part))) {
        const problem = xmlProblem(text);
        if (problem) {
          throw new Error(`${part} is not well-formed XML (${problem}). Nothing was saved.`);
        }
      }
      return bytes;
    });
  }

  /**
   * Replaces a binary part (a picture, say) with new bytes. Only an existing binary part can be
   * replaced, and it goes through exactly the same checks as a text part.
   */
  private writeBinaryPart(
    container: string,
    part: string,
    bytes: Uint8Array,
  ): Promise<{ modifiedMs: number }> {
    return this.patchPart(container, part, () => {
      if (isTextPart(part)) {
        throw new Error(`${part} is a text part and is saved as text`);
      }
      if (bytes.length === 0) throw new Error(`Refusing to replace ${part} with an empty file`);
      return bytes;
    });
  }

  /**
   * The safe save for one part: a fresh read of the container, the new bytes from `produce`
   * (which may refuse), a surgical patch, a self-check, a re-check that the file has not changed,
   * a one-off backup and an atomic write. Writes to one container are serialised.
   */
  private patchPart(
    container: string,
    part: string,
    produce: () => Uint8Array,
  ): Promise<{ modifiedMs: number }> {
    const file = baseName(container);
    return this.serialised(container, async () => {
      // Always the bytes on disk right now: another program may have changed other parts.
      this.cache.delete(container);
      let fresh: { bytes: Uint8Array; modifiedMs: number };
      try {
        fresh = await this.inner.readBinaryFile(container);
      } catch (error) {
        throw new Error(`Could not read ${file} to save ${part}: ${describe(error)}`, {
          cause: error,
        });
      }
      let archive: ZipArchive;
      try {
        archive = readZip(fresh.bytes);
      } catch (error) {
        const why = error instanceof ArchiveError ? error.message : describe(error);
        throw new Error(`Could not save ${part}: ${file} is not a readable archive (${why})`, {
          cause: error,
        });
      }
      const tokens = this.tokensOf(container);
      tokens.sync(archive, fresh.modifiedMs);

      const info = archive.info(part);
      if (!info || info.isDirectory) {
        throw new Error(`There is no part "${part}" in ${file}, and adding parts is not supported`);
      }
      const bytes = produce();

      let patched: Uint8Array;
      try {
        patched = archive.replace(part, bytes);
      } catch (error) {
        throw new Error(`Could not save ${part}: ${describe(error)}`, { cause: error });
      }
      verifyPatched(archive, patched, part, bytes);

      // Another program may have written the file since we read it; do not overwrite that.
      // The time alone is not proof: FAT keeps it to 2 seconds and some programs restore it.
      // So the bytes on disk must still be the ones that were patched.
      const changed = new Error(`${file} changed on disk while saving ${part}. Nothing was saved.`);
      const before = await this.inner.statFile(container);
      if (!before || before.modifiedMs !== fresh.modifiedMs) throw changed;
      let current: Uint8Array;
      try {
        current = (await this.inner.readBinaryFile(container)).bytes;
      } catch {
        throw changed;
      }
      if (!sameBytes(current, fresh.bytes)) throw changed;

      if (!this.backedUp.has(container)) {
        try {
          await this.inner.copyFile(container, `${container}.bak`, { overwrite: false });
        } catch (error) {
          // An existing .bak is the oldest copy and is kept. Anything else stops the save.
          if (!(error instanceof FileExistsError)) {
            throw new Error(`Could not back up ${file} before saving: ${describe(error)}`, {
              cause: error,
            });
          }
        }
        this.backedUp.add(container);
      }

      this.cache.delete(container);
      await this.inner.writeBinaryFile(container, patched, { overwrite: true });
      const after = await this.inner.statFile(container);
      if (!after) throw new Error(`${file} disappeared after saving ${part}`);
      tokens.sync(readZip(patched), after.modifiedMs);
      const token = tokens.get(part);
      if (token === undefined) throw new Error(`Saved ${part} but lost track of its version`);
      return { modifiedMs: token };
    });
  }

  async watchFile(path: string, onChange: (change: FileChange) => void): Promise<() => void> {
    const split = this.partOf(path);
    if (!split) return this.inner.watchFile(path, onChange);
    return this.inner.watchFile(split.container, (change) => onChange({ ...change, path }));
  }

  // Platform: forwarded unchanged ---------------------------------------------------------
  // Written out one by one on purpose: a new method on `Platform` fails to compile here until
  // someone decides what it means for containers.

  async writeBinaryFile(
    path: string,
    bytes: Uint8Array,
    options: { overwrite: boolean },
  ): Promise<void> {
    const split = this.partOf(path);
    if (split) {
      // Only a replacement of an existing binary part: adding parts is not supported.
      if (!options.overwrite) throw new FileExistsError(path);
      await this.writeBinaryPart(split.container, split.part, bytes);
      return;
    }
    return this.inner.writeBinaryFile(path, bytes, options);
  }

  copyFile(from: string, to: string, options: { overwrite: boolean }): Promise<void> {
    return this.inner.copyFile(from, to, options);
  }

  onFilesDropped(handler: (event: FilesDroppedEvent) => void): Promise<() => void> {
    return this.inner.onFilesDropped(handler);
  }

  onFileDragOver(handler: (position: FileDragPosition) => void): Promise<() => void> {
    return this.inner.onFileDragOver(handler);
  }

  showOpenDialog(options: { filters: FileFilter[]; multiple: boolean }): Promise<string[]> {
    return this.inner.showOpenDialog(options);
  }

  showSaveDialog(options: { filters: FileFilter[]; defaultPath?: string }): Promise<string | null> {
    return this.inner.showSaveDialog(options);
  }

  writeRecovery(snapshot: RecoverySnapshot): Promise<void> {
    return this.inner.writeRecovery(snapshot);
  }

  clearRecovery(id: string): Promise<void> {
    return this.inner.clearRecovery(id);
  }

  listRecovery(): Promise<RecoverySnapshot[]> {
    return this.inner.listRecovery();
  }

  onOpenRequest(handler: (paths: string[]) => void): Promise<() => void> {
    return this.inner.onOpenRequest(handler);
  }

  onCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
    return this.inner.onCloseRequested(handler);
  }

  setWindowTitle(title: string): Promise<void> {
    return this.inner.setWindowTitle(title);
  }

  readSettings(): Promise<string | null> {
    return this.inner.readSettings();
  }

  writeSettings(json: string): Promise<void> {
    return this.inner.writeSettings(json);
  }

  openExternal(url: string): Promise<void> {
    return this.inner.openExternal(url);
  }

  assetUrl(absolutePath: string): string {
    return this.inner.assetUrl(absolutePath);
  }
}
