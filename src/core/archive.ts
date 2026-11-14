/**
 * Reading and surgically patching zip archives (the container of DOCX, ODT, XLSX, PPTX and EPUB).
 *
 * THE CONTRACT. The implementation is being written; this file fixes the interface that the rest
 * of the app builds against.
 *
 * - `readZip` never changes the input. It throws `ArchiveError` for anything that is not a readable
 *   zip (not a zip at all, truncated, encrypted entries it cannot read).
 * - `replace` returns the bytes of a NEW archive in which every entry other than `name` is copied
 *   verbatim (local header, data, extra fields, timestamps, comments, order all byte-identical);
 *   only the named entry is re-compressed, and the central directory and end record are rebuilt to
 *   match. If the entry does not exist it is appended. This is what lets a part of a DOCX be edited
 *   without disturbing anything else in the file.
 */

export class ArchiveError extends Error {
  override readonly name = "ArchiveError";
}

export interface ZipEntryInfo {
  /** Name inside the archive, `/` separators. */
  readonly name: string;
  /** Uncompressed size in bytes. */
  readonly size: number;
  readonly compressedSize: number;
  /** CRC-32 of the uncompressed data, as stored in the archive. */
  readonly crc32: number;
  readonly isDirectory: boolean;
}

export interface ZipArchive {
  /** Entries in archive order. */
  readonly entries: readonly ZipEntryInfo[];
  has(name: string): boolean;
  info(name: string): ZipEntryInfo | undefined;
  /** The entry's uncompressed bytes. Throws `ArchiveError` if it is missing or fails its CRC check. */
  bytes(name: string): Uint8Array;
  /** A new archive with `name` set to `bytes` and everything else untouched (see above). */
  replace(name: string, bytes: Uint8Array): Uint8Array;
}

export function readZip(bytes: Uint8Array): ZipArchive {
  void bytes;
  throw new ArchiveError("Zip support has not been built yet");
}
