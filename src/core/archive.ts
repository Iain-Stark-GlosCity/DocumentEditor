/**
 * Reading and surgically patching zip archives (the container of DOCX, ODT, XLSX, PPTX and EPUB).
 *
 * - `readZip` never changes the input. It throws `ArchiveError` for anything that is not a readable
 *   zip (not a zip at all, truncated, encrypted entries it cannot read).
 * - `replace` returns the bytes of a NEW archive in which every entry other than `name` is copied
 *   verbatim (local header, data, extra fields, timestamps, comments, order all byte-identical);
 *   only the named entry is re-compressed, and the central directory and end record are rebuilt to
 *   match. If the entry does not exist it is appended. This is what lets a part of a DOCX be edited
 *   without disturbing anything else in the file.
 *
 * Implementation notes. The zip structure is parsed and written here; `fflate` supplies only raw
 * deflate and inflate. Reading understands zip64; patching refuses it (and any other layout it
 * cannot reproduce byte for byte) with an explicit `ArchiveError` rather than risk the file.
 * Plain TypeScript: no DOM, no Tauri, safe in a Web Worker.
 */
import { deflateSync, inflateSync } from "fflate";

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

/** The largest uncompressed entry `bytes` will produce. */
export const MAX_ENTRY_SIZE = 512 * 1024 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;

const EOCD_SIZE = 22;
const LOCATOR_SIZE = 20;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const MAX_COMMENT = 0xffff;
const U32_MAX = 0xffffffff;
/** 1980-01-01, the date given to entries that did not exist before (keeps output reproducible). */
const DEFAULT_DOS_DATE = 0x0021;

// ---------------------------------------------------------------------------------------------
// CRC-32

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE, as used by zip) of `data`. Pass a previous result as `previous` to continue. */
export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return ~c >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Parsing

interface RawEntry {
  readonly info: ZipEntryInfo;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly localOffset: number;
  /** Where this central header starts and how long it is (name + extra + comment included). */
  readonly centralStart: number;
  readonly centralLength: number;
  readonly extra: Uint8Array;
  /** True if the central header needed zip64 values or has a zip64 extra field. */
  readonly zip64: boolean;
}

interface Layout {
  readonly entries: readonly RawEntry[];
  readonly cdOffset: number;
  readonly cdSize: number;
  readonly eocdPos: number;
  readonly commentLength: number;
  readonly zip64: boolean;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u64(dv: DataView, pos: number, what: string): number {
  const lo = dv.getUint32(pos, true);
  const hi = dv.getUint32(pos + 4, true);
  if (hi >= 0x200000)
    throw new ArchiveError(`The zip ${what} is larger than this editor can handle`);
  return hi * 0x100000000 + lo;
}

function decodeName(raw: Uint8Array, flags: number): string {
  if (flags & 0x800) return new TextDecoder("utf-8").decode(raw);
  let out = "";
  for (let i = 0; i < raw.length; i += 8192) {
    out += String.fromCharCode(...raw.subarray(i, i + 8192));
  }
  return out;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
}

function findEocd(bytes: Uint8Array, dv: DataView): number {
  const last = bytes.length - EOCD_SIZE;
  if (last < 0) throw new ArchiveError("Not a zip file: it is too short to contain an end record");
  const first = Math.max(0, last - MAX_COMMENT);
  let fallback = -1;
  for (let pos = last; pos >= first; pos--) {
    if (dv.getUint32(pos, true) !== SIG_EOCD) continue;
    const end = pos + EOCD_SIZE + dv.getUint16(pos + 20, true);
    if (end === bytes.length) return pos;
    if (end < bytes.length && fallback < 0) fallback = pos;
  }
  if (fallback >= 0) return fallback;
  throw new ArchiveError("Not a zip file: no end of central directory record found");
}

function parseLayout(bytes: Uint8Array): Layout {
  const dv = view(bytes);
  const eocdPos = findEocd(bytes, dv);
  const commentLength = dv.getUint16(eocdPos + 20, true);
  let diskNo = dv.getUint16(eocdPos + 4, true);
  let cdDisk = dv.getUint16(eocdPos + 6, true);
  let total = dv.getUint16(eocdPos + 10, true);
  let cdSize = dv.getUint32(eocdPos + 12, true);
  let cdOffset = dv.getUint32(eocdPos + 16, true);
  let zip64 = false;

  const locatorPos = eocdPos - LOCATOR_SIZE;
  if (locatorPos >= 0 && dv.getUint32(locatorPos, true) === SIG_ZIP64_LOCATOR) {
    zip64 = true;
    const recPos = u64(dv, locatorPos + 8, "end record offset");
    if (recPos + 56 > bytes.length || dv.getUint32(recPos, true) !== SIG_ZIP64_EOCD) {
      throw new ArchiveError("The zip64 end of central directory record is missing or corrupt");
    }
    diskNo = dv.getUint32(recPos + 16, true);
    cdDisk = dv.getUint32(recPos + 20, true);
    total = u64(dv, recPos + 32, "entry count");
    cdSize = u64(dv, recPos + 40, "central directory");
    cdOffset = u64(dv, recPos + 48, "central directory offset");
  }

  if (diskNo !== 0 || cdDisk !== 0) {
    throw new ArchiveError("Multi-part (split) zip archives are not supported");
  }
  const limit = zip64 ? eocdPos - LOCATOR_SIZE : eocdPos;
  if (cdOffset > limit || cdSize > limit - cdOffset) {
    throw new ArchiveError(
      "The zip central directory lies outside the file (truncated or corrupt)",
    );
  }
  if (total * CENTRAL_SIZE > cdSize) {
    throw new ArchiveError(
      "The zip central directory is too small for the number of entries it claims",
    );
  }

  const entries: RawEntry[] = [];
  const cdEnd = cdOffset + cdSize;
  let pos = cdOffset;
  for (let i = 0; i < total; i++) {
    if (pos + CENTRAL_SIZE > cdEnd || dv.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new ArchiveError(`Corrupt zip central directory (bad header for entry ${i + 1})`);
    }
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const time = dv.getUint16(pos + 12, true);
    const date = dv.getUint16(pos + 14, true);
    const crc = dv.getUint32(pos + 16, true);
    let csize = dv.getUint32(pos + 20, true);
    let usize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const entryDisk = dv.getUint16(pos + 34, true);
    let localOffset = dv.getUint32(pos + 42, true);
    const length = CENTRAL_SIZE + nameLen + extraLen + commentLen;
    if (pos + length > cdEnd) {
      throw new ArchiveError(`Corrupt zip central directory (entry ${i + 1} runs past the end)`);
    }
    const nameBytes = bytes.subarray(pos + CENTRAL_SIZE, pos + CENTRAL_SIZE + nameLen);
    const extra = bytes.subarray(
      pos + CENTRAL_SIZE + nameLen,
      pos + CENTRAL_SIZE + nameLen + extraLen,
    );

    let entryZip64 = false;
    const needs64 = {
      usize: usize === U32_MAX,
      csize: csize === U32_MAX,
      offset: localOffset === U32_MAX,
    };
    // Walk the extra fields (id, size, data) looking for the zip64 one.
    const edv = view(extra);
    let e = 0;
    while (e + 4 <= extra.length) {
      const id = edv.getUint16(e, true);
      const size = edv.getUint16(e + 2, true);
      if (e + 4 + size > extra.length) break; // ignore a malformed tail, as other readers do
      if (id === 0x0001) {
        entryZip64 = true;
        let p = e + 4;
        const end = e + 4 + size;
        const next = (what: string): number => {
          if (p + 8 > end) throw new ArchiveError(`Corrupt zip64 extra field on entry ${i + 1}`);
          const v = u64(edv, p, what);
          p += 8;
          return v;
        };
        if (needs64.usize) usize = next("entry size");
        if (needs64.csize) csize = next("entry size");
        if (needs64.offset) localOffset = next("entry offset");
        break;
      }
      e += 4 + size;
    }
    if ((needs64.usize || needs64.csize || needs64.offset) && !entryZip64) {
      throw new ArchiveError(`Entry ${i + 1} needs zip64 values but has no zip64 extra field`);
    }
    if (entryDisk !== 0 && entryDisk !== 0xffff) {
      throw new ArchiveError("Multi-part (split) zip archives are not supported");
    }

    const name = decodeName(nameBytes, flags);
    entries.push({
      info: {
        name,
        size: usize,
        compressedSize: csize,
        crc32: crc,
        isDirectory: name.endsWith("/"),
      },
      nameBytes,
      flags,
      method,
      time,
      date,
      localOffset,
      centralStart: pos,
      centralLength: length,
      extra,
      zip64: entryZip64 || needs64.usize || needs64.csize || needs64.offset,
    });
    pos += length;
  }
  return { entries, cdOffset, cdSize, eocdPos, commentLength, zip64 };
}

// ---------------------------------------------------------------------------------------------
// Reading entry data

/** Where the entry's data starts, found from its LOCAL header (whose lengths may differ). */
function localDataStart(dv: DataView, entry: RawEntry, cdOffset: number): number {
  const off = entry.localOffset;
  const where = `"${entry.info.name}"`;
  if (off + LOCAL_SIZE > cdOffset || dv.getUint32(off, true) !== SIG_LOCAL) {
    throw new ArchiveError(`Corrupt zip: the local header of ${where} is missing (bad offset)`);
  }
  const start = off + LOCAL_SIZE + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
  if (start > cdOffset || start + entry.info.compressedSize > cdOffset) {
    throw new ArchiveError(`Corrupt zip: the data of ${where} runs past the end of the file`);
  }
  return start;
}

function readEntry(bytes: Uint8Array, dv: DataView, entry: RawEntry, cdOffset: number): Uint8Array {
  const { name, size, compressedSize, crc32: crc } = entry.info;
  if (entry.flags & 0x41) throw new ArchiveError(`"${name}" is encrypted, which is not supported`);
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ArchiveError(
      `"${name}" uses compression method ${entry.method}, which is not supported`,
    );
  }
  if (size > MAX_ENTRY_SIZE) {
    throw new ArchiveError(`"${name}" claims to be ${size} bytes uncompressed, which is too large`);
  }
  // Deflate cannot expand data more than about 1032 times: a bigger claim is a zip bomb or corrupt.
  if (entry.method === 8 && size > compressedSize * 1100 + 1024) {
    throw new ArchiveError(`"${name}" claims an impossible compression ratio (possible zip bomb)`);
  }
  const start = localDataStart(dv, entry, cdOffset);
  const raw = bytes.subarray(start, start + compressedSize);
  let out: Uint8Array;
  if (entry.method === 0) {
    if (compressedSize !== size) {
      throw new ArchiveError(`"${name}" is stored but its sizes disagree`);
    }
    out = raw.slice();
  } else {
    let inflated: Uint8Array;
    try {
      // One spare byte so that a stream which inflates to MORE than claimed is detectable.
      inflated = inflateSync(raw, { out: new Uint8Array(size + 1) });
    } catch (error) {
      throw new ArchiveError(
        `"${name}" could not be decompressed (${error instanceof Error ? error.message : "corrupt data"})`,
      );
    }
    if (inflated.length !== size) {
      throw new ArchiveError(`"${name}" inflates to a different size than the archive claims`);
    }
    // A plain view in this realm's Uint8Array (no copy).
    out = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.length);
  }
  if (crc32(out) !== crc)
    throw new ArchiveError(`"${name}" failed its CRC-32 check (corrupt data)`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Patching

function hasZip64Extra(extra: Uint8Array): boolean {
  const dv = view(extra);
  let e = 0;
  while (e + 4 <= extra.length) {
    if (dv.getUint16(e, true) === 0x0001) return true;
    e += 4 + dv.getUint16(e + 2, true);
  }
  return false;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function patchArchive(
  bytes: Uint8Array,
  layout: Layout,
  name: string,
  data: Uint8Array,
): Uint8Array {
  const dv = view(bytes);
  const { entries, cdOffset, eocdPos, commentLength } = layout;

  // --- Refuse anything we cannot reproduce byte for byte. ---
  if (layout.zip64 || entries.some((e) => e.zip64)) {
    throw new ArchiveError("Cannot patch a zip64 archive safely; the file was left untouched");
  }
  if (eocdPos + EOCD_SIZE + commentLength !== bytes.length) {
    throw new ArchiveError("Cannot patch: there is extra data after the end of the zip archive");
  }
  if (layout.cdOffset + layout.cdSize !== eocdPos) {
    throw new ArchiveError(
      "Cannot patch: unexpected data between the central directory and the end record",
    );
  }
  const matching = entries.filter((e) => e.info.name === name);
  if (matching.length > 1) {
    throw new ArchiveError(`Cannot patch: the archive contains "${name}" more than once`);
  }
  const target = matching[0];
  if (target?.info.isDirectory || (!target && name.endsWith("/"))) {
    throw new ArchiveError(`Cannot patch "${name}": it is a directory entry`);
  }
  if (!target && name.length === 0)
    throw new ArchiveError("Cannot add an entry with an empty name");
  if (target && target.flags & 0x41) {
    throw new ArchiveError(`Cannot patch "${name}": it is encrypted`);
  }

  // Local records must tile the space before the central directory exactly.
  const order = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  let expected = 0;
  const recordEnd = new Map<RawEntry, number>();
  for (let i = 0; i < order.length; i++) {
    const e = order[i]!;
    if (e.localOffset !== expected) {
      throw new ArchiveError(
        expected === 0
          ? "Cannot patch: data precedes the first entry (for example a self-extractor stub)"
          : `Cannot patch: unexpected data or a gap before the entry "${e.info.name}"`,
      );
    }
    const next = i + 1 < order.length ? order[i + 1]!.localOffset : cdOffset;
    const dataEnd = localDataStart(dv, e, cdOffset) + e.info.compressedSize;
    const gap = next - dataEnd;
    const hasDescriptor = (dv.getUint16(e.localOffset + 6, true) & 0x08) !== 0;
    const okGap =
      gap === 0 ||
      (hasDescriptor &&
        (gap === 12 || (gap === 16 && dv.getUint32(dataEnd, true) === SIG_DESCRIPTOR)));
    if (!okGap) {
      throw new ArchiveError(
        `Cannot patch: unexpected ${gap} bytes after the data of "${e.info.name}" (overlap, gap or junk)`,
      );
    }
    recordEnd.set(e, next);
    expected = next;
  }
  if (expected !== cdOffset) {
    throw new ArchiveError(
      "Cannot patch: unexpected data between the last entry and the central directory",
    );
  }

  // --- Build the replacement local record. ---
  let nameBytes: Uint8Array;
  let flags: number;
  let time: number;
  let date: number;
  let localExtra: Uint8Array = new Uint8Array(0);
  let keepStored = false;
  if (target) {
    const nl = dv.getUint16(target.localOffset + 26, true);
    const el = dv.getUint16(target.localOffset + 28, true);
    localExtra = bytes.subarray(
      target.localOffset + LOCAL_SIZE + nl,
      target.localOffset + LOCAL_SIZE + nl + el,
    );
    if (hasZip64Extra(localExtra) || hasZip64Extra(target.extra)) {
      throw new ArchiveError(`Cannot patch "${name}": it carries zip64 fields`);
    }
    nameBytes = target.nameBytes;
    flags = target.flags & 0x800; // keep only the name encoding flag
    time = target.time;
    date = target.date;
    keepStored = target.method === 0;
  } else {
    nameBytes = new TextEncoder().encode(name);
    flags = isAscii(name) ? 0 : 0x800;
    time = 0;
    date = DEFAULT_DOS_DATE;
  }
  if (nameBytes.length > 0xffff)
    throw new ArchiveError("Cannot add an entry with such a long name");
  if (data.length >= U32_MAX) {
    throw new ArchiveError("Cannot patch: the new content is too large (4 GB limit)");
  }

  let method = 0;
  let payload = data;
  if (!keepStored && data.length > 0) {
    const deflated = deflateSync(data);
    if (deflated.length < data.length) {
      method = 8;
      payload = deflated;
    }
  }
  const crc = crc32(data);
  const local = new Uint8Array(LOCAL_SIZE + nameBytes.length + localExtra.length);
  const ldv = view(local);
  ldv.setUint32(0, SIG_LOCAL, true);
  ldv.setUint16(4, 20, true);
  ldv.setUint16(6, flags, true);
  ldv.setUint16(8, method, true);
  ldv.setUint16(10, time, true);
  ldv.setUint16(12, date, true);
  ldv.setUint32(14, crc, true);
  ldv.setUint32(18, payload.length, true);
  ldv.setUint32(22, data.length, true);
  ldv.setUint16(26, nameBytes.length, true);
  ldv.setUint16(28, localExtra.length, true);
  local.set(nameBytes, LOCAL_SIZE);
  local.set(localExtra, LOCAL_SIZE + nameBytes.length);

  const oldStart = target ? target.localOffset : cdOffset;
  const oldEnd = target ? recordEnd.get(target)! : cdOffset;
  const delta = local.length + payload.length - (oldEnd - oldStart);
  if (cdOffset + delta >= U32_MAX) {
    throw new ArchiveError("Cannot patch: the archive would exceed 4 GB");
  }

  // --- Rebuild the central directory. ---
  const central: Uint8Array[] = [];
  for (const e of entries) {
    const header = bytes.slice(e.centralStart, e.centralStart + e.centralLength);
    const hdv = view(header);
    if (e === target) {
      hdv.setUint16(6, 20, true);
      hdv.setUint16(8, flags, true);
      hdv.setUint16(10, method, true);
      hdv.setUint32(16, crc, true);
      hdv.setUint32(20, payload.length, true);
      hdv.setUint32(24, data.length, true);
    } else if (target && e.localOffset >= oldEnd) {
      hdv.setUint32(42, e.localOffset + delta, true);
    }
    central.push(header);
  }
  if (!target) {
    const header = new Uint8Array(CENTRAL_SIZE + nameBytes.length);
    const hdv = view(header);
    hdv.setUint32(0, SIG_CENTRAL, true);
    hdv.setUint16(4, 20, true);
    hdv.setUint16(6, 20, true);
    hdv.setUint16(8, flags, true);
    hdv.setUint16(10, method, true);
    hdv.setUint16(12, time, true);
    hdv.setUint16(14, date, true);
    hdv.setUint32(16, crc, true);
    hdv.setUint32(20, payload.length, true);
    hdv.setUint32(24, data.length, true);
    hdv.setUint16(28, nameBytes.length, true);
    hdv.setUint32(42, oldStart, true);
    header.set(nameBytes, CENTRAL_SIZE);
    central.push(header);
  }
  const count = central.length;
  if (count > 0xfffe)
    throw new ArchiveError("Cannot patch: too many entries for a non-zip64 archive");
  const cd = concat(central);

  const eocd = new Uint8Array(EOCD_SIZE);
  const edv = view(eocd);
  edv.setUint32(0, SIG_EOCD, true);
  edv.setUint16(8, count, true);
  edv.setUint16(10, count, true);
  edv.setUint32(12, cd.length, true);
  edv.setUint32(16, cdOffset + delta, true);
  edv.setUint16(20, commentLength, true);

  return concat([
    bytes.subarray(0, oldStart),
    local,
    payload,
    bytes.subarray(oldEnd, cdOffset),
    cd,
    eocd,
    bytes.subarray(eocdPos + EOCD_SIZE),
  ]);
}

// ---------------------------------------------------------------------------------------------

export function readZip(bytes: Uint8Array): ZipArchive {
  const layout = parseLayout(bytes);
  const dv = view(bytes);
  const byName = new Map<string, RawEntry>();
  for (const entry of layout.entries) {
    if (!byName.has(entry.info.name)) byName.set(entry.info.name, entry);
  }
  return {
    entries: layout.entries.map((e) => e.info),
    has: (name) => byName.has(name),
    info: (name) => byName.get(name)?.info,
    bytes(name) {
      const entry = byName.get(name);
      if (!entry) throw new ArchiveError(`There is no entry "${name}" in the archive`);
      return readEntry(bytes, dv, entry, layout.cdOffset);
    },
    replace(name, data) {
      return patchArchive(bytes, layout, name, data);
    },
  };
}
