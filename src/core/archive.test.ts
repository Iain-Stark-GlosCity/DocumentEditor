import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { ArchiveError, crc32, readZip } from "./archive";

// fflate, passed through but counted, so tests can assert how much work a patch does.
const work = vi.hoisted(() => {
  const counts = { deflateCalls: 0, deflatedBytes: 0, inflateCalls: 0 };
  return Object.assign(counts, {
    reset() {
      counts.deflateCalls = 0;
      counts.deflatedBytes = 0;
      counts.inflateCalls = 0;
    },
  });
});
vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return {
    ...actual,
    deflateSync(data: Uint8Array, options?: Parameters<typeof actual.deflateSync>[1]) {
      work.deflateCalls++;
      work.deflatedBytes += data.length;
      return actual.deflateSync(data, options);
    },
    inflateSync(data: Uint8Array, options?: Parameters<typeof actual.inflateSync>[1]) {
      work.inflateCalls++;
      return actual.inflateSync(data, options);
    },
  };
});

const enc = new TextEncoder();
const text = (s: string): Uint8Array => enc.encode(s);
const str = (b: Uint8Array): string => new TextDecoder().decode(b);

// ---------------------------------------------------------------------------------------------
// A hand-rolled zip writer, so tests can build layouts that fflate cannot.

interface Spec {
  name: string | Uint8Array;
  data?: Uint8Array;
  method?: 0 | 8;
  descriptor?: "none" | "signed" | "unsigned";
  utf8Flag?: boolean;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  fileComment?: string;
  time?: number;
  date?: number;
  /** Extra general-purpose flag bits (for example 0x06, the deflate option bits). */
  extraFlags?: number;
  /** The stored (compressed) bytes as written, instead of compressing `data`. */
  body?: Uint8Array;
  /** Overrides, for building corrupt entries. */
  crc?: number;
  claimedSize?: number;
}

interface Built {
  bytes: Uint8Array;
  /** Local record [start, end) per entry, in order written. */
  records: Array<[number, number]>;
  cdOffset: number;
}

function le(n: number, size: 2 | 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  return out;
}

function build(
  specs: Spec[],
  options: { prefix?: Uint8Array; comment?: string; junkBetween?: Uint8Array } = {},
): Built {
  const out: number[] = [...(options.prefix ?? [])];
  const central: number[] = [];
  const records: Array<[number, number]> = [];
  specs.forEach((spec, index) => {
    const data = spec.data ?? new Uint8Array(0);
    const method = spec.method ?? 8;
    const body = spec.body ?? (method === 8 ? deflateSync(data) : data);
    const nameBytes = typeof spec.name === "string" ? [...text(spec.name)] : [...spec.name];
    const descriptor = spec.descriptor ?? "none";
    const flags =
      (descriptor === "none" ? 0 : 8) | (spec.utf8Flag ? 0x800 : 0) | (spec.extraFlags ?? 0);
    const crc = spec.crc ?? crc32(data);
    const usize = spec.claimedSize ?? data.length;
    const time = spec.time ?? 0x6000 + index;
    const date = spec.date ?? 0x5821;
    const localExtra = [...(spec.localExtra ?? [])];
    const centralExtra = [...(spec.centralExtra ?? [])];
    const comment = [...text(spec.fileComment ?? "")];
    const start = out.length;
    const withDescriptor = descriptor !== "none";
    out.push(
      ...le(0x04034b50, 4),
      ...le(20, 2),
      ...le(flags, 2),
      ...le(method, 2),
      ...le(time, 2),
      ...le(date, 2),
      // With a data descriptor the local header carries zeros.
      ...le(withDescriptor ? 0 : crc, 4),
      ...le(withDescriptor ? 0 : body.length, 4),
      ...le(withDescriptor ? 0 : usize, 4),
      ...le(nameBytes.length, 2),
      ...le(localExtra.length, 2),
      ...nameBytes,
      ...localExtra,
      ...body,
    );
    if (descriptor === "signed") out.push(...le(0x08074b50, 4));
    if (withDescriptor) out.push(...le(crc, 4), ...le(body.length, 4), ...le(usize, 4));
    records.push([start, out.length]);
    central.push(
      ...le(0x02014b50, 4),
      ...le(20, 2),
      ...le(20, 2),
      ...le(flags, 2),
      ...le(method, 2),
      ...le(time, 2),
      ...le(date, 2),
      ...le(crc, 4),
      ...le(body.length, 4),
      ...le(usize, 4),
      ...le(nameBytes.length, 2),
      ...le(centralExtra.length, 2),
      ...le(comment.length, 2),
      ...le(0, 2),
      ...le(0, 2),
      ...le(0, 4),
      ...le(start, 4),
      ...nameBytes,
      ...centralExtra,
      ...comment,
    );
  });
  if (options.junkBetween) out.push(...options.junkBetween);
  const cdOffset = out.length;
  const comment = [...text(options.comment ?? "")];
  out.push(
    ...central,
    ...le(0x06054b50, 4),
    ...le(0, 2),
    ...le(0, 2),
    ...le(specs.length, 2),
    ...le(specs.length, 2),
    ...le(central.length, 4),
    ...le(cdOffset, 4),
    ...le(comment.length, 2),
    ...comment,
  );
  return { bytes: new Uint8Array(out), records, cdOffset };
}

const bigText = (n: number): Uint8Array => {
  const words = ["alpha", "beta", "gamma", "delta", "<w:p>", "</w:p>", "\n"];
  let s = "";
  let i = 0;
  while (s.length < n) s += words[(i++ * 7) % words.length] + " ";
  return text(s.slice(0, n));
};

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function sample(): Built {
  return build(
    [
      { name: "[Content_Types].xml", data: text("<Types/>") },
      { name: "_rels/", data: new Uint8Array(0), method: 0 },
      { name: "word/document.xml", data: bigText(5000), descriptor: "signed" },
      {
        name: "word/styles.xml",
        data: bigText(3000),
        descriptor: "unsigned",
        localExtra: new Uint8Array([0xfe, 0xca, 0, 0]),
      },
      { name: "word/empty.xml", data: new Uint8Array(0), method: 0 },
      {
        name: "media/logo.png",
        data: new Uint8Array([1, 2, 3, 4, 5]),
        method: 0,
        centralExtra: new Uint8Array([0xfe, 0xca, 2, 0, 0x41, 0x42]),
      },
      { name: "docProps/core.xml", data: text("<core/>"), fileComment: "hello" },
    ],
    { comment: "archive comment" },
  );
}

// ---------------------------------------------------------------------------------------------

describe("crc32", () => {
  it("matches known values", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(text("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("can continue from a previous value", () => {
    const whole = crc32(text("hello world"));
    expect(crc32(text(" world"), crc32(text("hello")))).toBe(whole);
  });
});

describe("readZip", () => {
  it("reads an archive made by fflate", () => {
    const bytes = zipSync({ "a.txt": text("hello"), "dir/b.txt": [text("world"), { level: 0 }] });
    const zip = readZip(bytes);
    expect(zip.entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.txt"]);
    expect(str(zip.bytes("a.txt"))).toBe("hello");
    expect(str(zip.bytes("dir/b.txt"))).toBe("world");
    expect(zip.has("a.txt")).toBe(true);
    expect(zip.has("nope")).toBe(false);
    expect(zip.info("a.txt")).toMatchObject({
      size: 5,
      crc32: crc32(text("hello")),
      isDirectory: false,
    });
    expect(() => zip.bytes("nope")).toThrow(ArchiveError);
  });

  it("does not modify its input", () => {
    const { bytes } = sample();
    const copy = bytes.slice();
    const zip = readZip(bytes);
    for (const e of zip.entries) if (!e.isDirectory) zip.bytes(e.name);
    zip.replace("word/document.xml", text("<new/>"));
    zip.replace("added.xml", text("<new/>"));
    expect(same(bytes, copy)).toBe(true);
  });

  it("reads data descriptors, extra fields, comments, directories and empty files", () => {
    const { bytes } = sample();
    const zip = readZip(bytes);
    expect(zip.entries.map((e) => e.name)).toEqual([
      "[Content_Types].xml",
      "_rels/",
      "word/document.xml",
      "word/styles.xml",
      "word/empty.xml",
      "media/logo.png",
      "docProps/core.xml",
    ]);
    expect(zip.info("_rels/")?.isDirectory).toBe(true);
    expect(same(zip.bytes("word/document.xml"), bigText(5000))).toBe(true);
    expect(same(zip.bytes("word/styles.xml"), bigText(3000))).toBe(true);
    expect(zip.bytes("word/empty.xml").length).toBe(0);
    expect(same(zip.bytes("media/logo.png"), new Uint8Array([1, 2, 3, 4, 5]))).toBe(true);
    expect(str(zip.bytes("docProps/core.xml"))).toBe("<core/>");
  });

  it("finds the end record behind a maximum-size comment, even one that mimics an end record", () => {
    const fake = new Uint8Array(2000);
    fake.set([0x50, 0x4b, 0x05, 0x06], 100); // a lookalike signature inside the comment
    const comment = String.fromCharCode(...fake.map((v) => v || 32)).padEnd(65535, "x");
    const { bytes } = build([{ name: "a.txt", data: text("hi") }], { comment });
    expect(str(readZip(bytes).bytes("a.txt"))).toBe("hi");
  });

  it("reads an empty archive", () => {
    const bytes = build([]).bytes;
    expect(readZip(bytes).entries).toEqual([]);
  });

  it("decodes names: UTF-8 with the flag, Latin-1 without", () => {
    const utf8 = build([{ name: "café.xml", data: text("a"), utf8Flag: true }]).bytes;
    expect(readZip(utf8).has("café.xml")).toBe(true);
    const latin = build([
      { name: new Uint8Array([0x63, 0x61, 0x66, 0xe9]), data: text("a") },
    ]).bytes;
    expect(readZip(latin).entries[0]?.name).toBe("café");
  });

  it("uses the central directory sizes and the local header's own name and extra lengths", () => {
    const built = build([
      {
        name: "a.xml",
        data: bigText(400),
        localExtra: new Uint8Array([0xfe, 0xca, 6, 0, 1, 2, 3, 4, 5, 6]),
        centralExtra: new Uint8Array([0xfe, 0xca, 0, 0]),
      },
    ]);
    expect(same(readZip(built.bytes).bytes("a.xml"), bigText(400))).toBe(true);
  });

  it("refuses unsupported methods, encryption and mismatched stored sizes", () => {
    const built = build([{ name: "a.txt", data: text("hello"), method: 0 }]);
    const b = built.bytes.slice();
    // Central header method field -> 12 (bzip2).
    const dv = new DataView(b.buffer);
    dv.setUint16(built.cdOffset + 10, 12, true);
    expect(() => readZip(b).bytes("a.txt")).toThrow(/compression method 12/);
    const e = built.bytes.slice();
    new DataView(e.buffer).setUint16(built.cdOffset + 8, 1, true);
    expect(() => readZip(e).bytes("a.txt")).toThrow(/encrypted/);
    const s = built.bytes.slice();
    new DataView(s.buffer).setUint32(built.cdOffset + 24, 99, true);
    expect(() => readZip(s).bytes("a.txt")).toThrow(ArchiveError);
  });

  it("detects a bad CRC", () => {
    const { bytes } = build([{ name: "a.txt", data: text("hello"), crc: 1234 }]);
    expect(() => readZip(bytes).bytes("a.txt")).toThrow(/CRC/);
  });

  it("detects corrupted entry data", () => {
    const built = build([{ name: "a.txt", data: text("hello world"), method: 0 }]);
    const b = built.bytes.slice();
    b[35] = (b[35]! ^ 0xff) & 0xff; // first data byte
    expect(() => readZip(b).bytes("a.txt")).toThrow(/CRC/);
  });

  it("rejects a wrong local-header offset", () => {
    const built = build([{ name: "a.txt", data: text("hello") }]);
    const b = built.bytes.slice();
    new DataView(b.buffer).setUint32(built.cdOffset + 42, 3, true);
    expect(() => readZip(b).bytes("a.txt")).toThrow(/local header/);
    new DataView(b.buffer).setUint32(built.cdOffset + 42, 0xfff0, true);
    expect(() => readZip(b).bytes("a.txt")).toThrow(ArchiveError);
  });

  it("rejects non-zips, truncation and a bad end record", () => {
    expect(() => readZip(new Uint8Array(0))).toThrow(ArchiveError);
    expect(() => readZip(text("this is not a zip file at all, definitely"))).toThrow(/Not a zip/);
    const { bytes } = sample();
    for (const cut of [1, 10, 22, 100, bytes.length - 30, bytes.length - 1]) {
      expect(() => {
        const z = readZip(bytes.subarray(0, cut));
        for (const e of z.entries) if (!e.isDirectory) z.bytes(e.name);
      }).toThrow(ArchiveError);
    }
    const bad = bytes.slice();
    bad.fill(0, bad.length - 40 - "archive comment".length, bad.length - 15);
    expect(() => readZip(bad)).toThrow(ArchiveError);
  });

  it("rejects a central directory claiming more entries than fit", () => {
    const built = build([{ name: "a.txt", data: text("x") }]);
    const b = built.bytes.slice();
    const eocd = b.length - 22;
    new DataView(b.buffer).setUint16(eocd + 10, 5000, true);
    expect(() => readZip(b)).toThrow(ArchiveError);
  });

  it("refuses zip-bomb claims", () => {
    const huge = build([{ name: "a.txt", data: text("x"), claimedSize: 600 * 1024 * 1024 }]);
    expect(() => readZip(huge.bytes).bytes("a.txt")).toThrow(/too large/);
    const ratio = build([{ name: "a.txt", data: text("hello"), claimedSize: 100 * 1024 * 1024 }]);
    expect(() => readZip(ratio.bytes).bytes("a.txt")).toThrow(/bomb/);
  });

  it("detects data that inflates to a different size than claimed", () => {
    const data = bigText(4000);
    const smaller = build([{ name: "a.txt", data, claimedSize: 3000, crc: crc32(data) }]);
    expect(() => readZip(smaller.bytes).bytes("a.txt")).toThrow(ArchiveError);
    const bigger = build([{ name: "a.txt", data, claimedSize: 5000 }]);
    expect(() => readZip(bigger.bytes).bytes("a.txt")).toThrow(ArchiveError);
    // A real bomb: 20 MB of zeros claimed as 1000 bytes.
    const bomb = build([{ name: "a.txt", data: new Uint8Array(20_000_000), claimedSize: 1000 }]);
    expect(() => readZip(bomb.bytes).bytes("a.txt")).toThrow(ArchiveError);
  });

  it("reads a zip64 archive", () => {
    const data = text("zip64 content here");
    const body = deflateSync(data);
    const name = text("a.txt");
    const extra = [
      ...le(1, 2),
      ...le(16, 2),
      ...le(data.length, 4),
      0,
      0,
      0,
      0,
      ...le(body.length, 4),
      0,
      0,
      0,
      0,
    ];
    const out: number[] = [];
    out.push(
      ...le(0x04034b50, 4),
      ...le(45, 2),
      ...le(0, 2),
      ...le(8, 2),
      ...le(0, 2),
      ...le(0x21, 2),
      ...le(crc32(data), 4),
      ...le(body.length, 4),
      ...le(data.length, 4),
      ...le(name.length, 2),
      ...le(0, 2),
      ...name,
      ...body,
    );
    const cdOffset = out.length;
    const cd = [
      ...le(0x02014b50, 4),
      ...le(45, 2),
      ...le(45, 2),
      ...le(0, 2),
      ...le(8, 2),
      ...le(0, 2),
      ...le(0x21, 2),
      ...le(crc32(data), 4),
      ...le(0xffffffff, 4),
      ...le(0xffffffff, 4),
      ...le(name.length, 2),
      ...le(extra.length, 2),
      ...le(0, 2),
      ...le(0, 2),
      ...le(0, 2),
      ...le(0, 4),
      ...le(0, 4),
      ...name,
      ...extra,
    ];
    out.push(...cd);
    const z64At = out.length;
    out.push(
      ...le(0x06064b50, 4),
      ...le(44, 4),
      0,
      0,
      0,
      0,
      ...le(45, 2),
      ...le(45, 2),
      ...le(0, 4),
      ...le(0, 4),
      ...le(1, 4),
      0,
      0,
      0,
      0,
      ...le(1, 4),
      0,
      0,
      0,
      0,
      ...le(cd.length, 4),
      0,
      0,
      0,
      0,
      ...le(cdOffset, 4),
      0,
      0,
      0,
      0,
    );
    out.push(...le(0x07064b50, 4), ...le(0, 4), ...le(z64At, 4), 0, 0, 0, 0, ...le(1, 4));
    out.push(
      ...le(0x06054b50, 4),
      ...le(0, 2),
      ...le(0, 2),
      ...le(0xffff, 2),
      ...le(0xffff, 2),
      ...le(0xffffffff, 4),
      ...le(0xffffffff, 4),
      ...le(0, 2),
    );
    const bytes = new Uint8Array(out);
    const zip = readZip(bytes);
    expect(zip.info("a.txt")?.size).toBe(data.length);
    expect(str(zip.bytes("a.txt"))).toBe("zip64 content here");
    expect(() => zip.replace("a.txt", text("x"))).toThrow(/zip64/);
  });
});

describe("replace", () => {
  it("copies every other entry's local record byte for byte, in order", () => {
    const built = sample();
    const zip = readZip(built.bytes);
    const patched = zip.replace("word/document.xml", bigText(9000));
    const after = readZip(patched);
    const target = 2;
    expect(after.entries.map((e) => e.name)).toEqual(zip.entries.map((e) => e.name));

    // Walk the new archive's local records using its central offsets.
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    const cd = view.getUint32(patched.length - 22 - "archive comment".length + 16, true);
    const offsets: number[] = [];
    let p = cd;
    for (let i = 0; i < after.entries.length; i++) {
      offsets.push(view.getUint32(p + 42, true));
      p +=
        46 +
        view.getUint16(p + 28, true) +
        view.getUint16(p + 30, true) +
        view.getUint16(p + 32, true);
    }
    const ends = [...offsets.slice(1), cd];
    built.records.forEach(([start, end], i) => {
      if (i === target) return;
      const original = built.bytes.subarray(start, end);
      expect(same(original, patched.subarray(offsets[i]!, ends[i]!)), `record ${i}`).toBe(true);
    });
    for (const e of zip.entries) {
      if (e.name === "word/document.xml" || e.isDirectory) continue;
      expect(after.bytes(e.name)).toEqual(zip.bytes(e.name));
      expect(after.info(e.name)?.crc32).toBe(e.crc32);
    }
    expect(same(after.bytes("word/document.xml"), bigText(9000))).toBe(true);
    expect(after.info("word/document.xml")?.crc32).toBe(crc32(bigText(9000)));
  });

  it("keeps central headers (extra, comment, times) and the archive comment", () => {
    const built = sample();
    const patched = readZip(built.bytes).replace("word/styles.xml", text("<s/>"));
    const tail = "archive comment";
    expect(str(patched.subarray(patched.length - tail.length))).toBe(tail);
    const a = readZip(built.bytes);
    const b = readZip(patched);
    expect(b.entries.length).toBe(a.entries.length);
    // File comment and central extra of other entries survive.
    expect(str(patched)).toContain("hello");
    expect(str(patched)).toContain("AB");
  });

  it("keeps the replaced entry's date and time, and its local extra", () => {
    const built = build([
      {
        name: "a.xml",
        data: text("old"),
        time: 0x1234,
        date: 0x4abc,
        localExtra: text("UT\x01\0Z"),
      },
      { name: "b.xml", data: text("b") },
    ]);
    const patched = readZip(built.bytes).replace(
      "a.xml",
      text("new content new content new content"),
    );
    const dv = new DataView(patched.buffer);
    expect(dv.getUint16(10, true)).toBe(0x1234);
    expect(dv.getUint16(12, true)).toBe(0x4abc);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint16(4, true)).toBe(20);
    expect(dv.getUint16(6, true) & 8).toBe(0);
    expect(str(patched.subarray(30 + 5, 30 + 5 + 5))).toBe("UT\x01\0Z");
    expect(str(readZip(patched).bytes("a.xml"))).toBe("new content new content new content");
  });

  it("replaces an entry that used a data descriptor, with none in the new record", () => {
    const built = build([
      { name: "a.xml", data: bigText(2000), descriptor: "signed" },
      { name: "b.xml", data: bigText(2000), descriptor: "unsigned" },
    ]);
    for (const name of ["a.xml", "b.xml"]) {
      const patched = readZip(built.bytes).replace(name, text("<x/>"));
      const zip = readZip(patched);
      expect(str(zip.bytes(name))).toBe("<x/>");
      const other = name === "a.xml" ? "b.xml" : "a.xml";
      expect(same(zip.bytes(other), bigText(2000))).toBe(true);
    }
  });

  it("appends a new entry as the last, with UTF-8 flag only for non-ASCII names", () => {
    const built = sample();
    const zip = readZip(built.bytes);
    const patched = zip.replace("word/new.xml", text("<n/>"));
    const after = readZip(patched);
    expect(after.entries.at(-1)?.name).toBe("word/new.xml");
    expect(after.entries.length).toBe(zip.entries.length + 1);
    expect(str(after.bytes("word/new.xml"))).toBe("<n/>");
    // Every original record is a verbatim prefix.
    expect(same(patched.subarray(0, built.cdOffset), built.bytes.subarray(0, built.cdOffset))).toBe(
      true,
    );

    const unicode = readZip(zip.replace("café/日本.xml", text("<u/>")));
    expect(str(unicode.bytes("café/日本.xml"))).toBe("<u/>");
    const flagAscii = new DataView(patched.buffer).getUint16(built.cdOffset + 8, true);
    expect(flagAscii).toBe(0); // first original entry's flags are untouched
  });

  it("marks a new non-ASCII name with the UTF-8 flag", () => {
    const patched = readZip(build([]).bytes).replace("é.xml", text("<u/>"));
    expect(new DataView(patched.buffer).getUint16(6, true) & 0x800).toBe(0x800);
  });

  it("preserves a Latin-1 name's encoding when replacing it", () => {
    const built = build([{ name: new Uint8Array([0x63, 0xe9]), data: text("a") }]);
    const patched = readZip(built.bytes).replace("cé", text("<b/>"));
    expect(new DataView(patched.buffer).getUint16(6, true) & 0x800).toBe(0);
    expect(str(readZip(patched).bytes("cé"))).toBe("<b/>");
  });

  it("appends to an empty archive and to one with a comment", () => {
    const empty = readZip(build([]).bytes).replace("a.txt", text("hello hello hello hello"));
    expect(str(readZip(empty).bytes("a.txt"))).toBe("hello hello hello hello");
    const commented = build([{ name: "a", data: text("x") }], { comment: "keep me" });
    const patched = readZip(commented.bytes).replace("b", text("y"));
    expect(str(patched.subarray(patched.length - 7))).toBe("keep me");
  });

  it("replacing with identical content gives an archive that reads identically", () => {
    const built = sample();
    const zip = readZip(built.bytes);
    for (const e of zip.entries) {
      if (e.isDirectory) continue;
      const patched = readZip(zip.replace(e.name, zip.bytes(e.name)));
      expect(patched.entries.map((x) => [x.name, x.size, x.crc32])).toEqual(
        zip.entries.map((x) => [x.name, x.size, x.crc32]),
      );
      for (const o of zip.entries) {
        if (!o.isDirectory) expect(patched.bytes(o.name)).toEqual(zip.bytes(o.name));
      }
    }
  });

  it("keeps stored entries stored, and mimetype first (ODT)", () => {
    const mimetype = "application/vnd.oasis.opendocument.text";
    const built = build([
      { name: "mimetype", data: text(mimetype), method: 0 },
      { name: "content.xml", data: bigText(4000) },
      { name: "styles.xml", data: bigText(1000) },
    ]);
    const patched = readZip(built.bytes).replace("mimetype", text("application/x-other"));
    const zip = readZip(patched);
    expect(zip.entries[0]?.name).toBe("mimetype");
    expect(zip.entries[0]?.compressedSize).toBe(zip.entries[0]?.size);
    expect(new DataView(patched.buffer).getUint16(8, true)).toBe(0);
    expect(str(patched.subarray(30, 38))).toBe("mimetype");
    expect(str(patched.subarray(38, 38 + 19))).toBe("application/x-other");
    // Patching another entry leaves mimetype's record identical.
    const other = readZip(built.bytes).replace("content.xml", text("<c/>"));
    expect(
      same(other.subarray(0, built.records[0]![1]), built.bytes.subarray(0, built.records[0]![1])),
    ).toBe(true);
  });

  it("stores content that does not compress, and handles empty content", () => {
    const random = new Uint8Array(3000);
    let s = 12345;
    for (let i = 0; i < random.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      random[i] = s >>> 16;
    }
    const built = build([{ name: "a.bin", data: bigText(100) }]);
    const zip = readZip(built.bytes);
    const stored = readZip(zip.replace("a.bin", random));
    expect(stored.info("a.bin")?.compressedSize).toBe(3000);
    expect(same(stored.bytes("a.bin"), random)).toBe(true);
    const empty = readZip(zip.replace("a.bin", new Uint8Array(0)));
    expect(empty.bytes("a.bin").length).toBe(0);
    expect(empty.info("a.bin")?.size).toBe(0);
  });

  it("works when applied twice to the same entry, and in sequence", () => {
    const built = sample();
    const once = readZip(built.bytes).replace("word/document.xml", text("<one/>"));
    const twice = readZip(once).replace("word/document.xml", bigText(7000));
    const zip = readZip(twice);
    expect(same(zip.bytes("word/document.xml"), bigText(7000))).toBe(true);
    const added = readZip(zip.replace("new.xml", text("<n/>")));
    const again = readZip(added.replace("new.xml", text("<m/>")));
    expect(str(again.bytes("new.xml"))).toBe("<m/>");
    expect(same(again.bytes("word/styles.xml"), bigText(3000))).toBe(true);
    expect(again.entries.length).toBe(built.records.length + 1);
  });

  it("handles a central directory whose order differs from the local order", () => {
    // Build normally, then swap the two central headers.
    const built = build([
      { name: "a.xml", data: bigText(500) },
      { name: "b.xml", data: bigText(700) },
    ]);
    const b = built.bytes.slice();
    const cd = built.cdOffset;
    const first = 46 + 5;
    const hdrA = b.slice(cd, cd + first);
    const hdrB = b.slice(cd + first, cd + 2 * first);
    b.set(hdrB, cd);
    b.set(hdrA, cd + first);
    const zip = readZip(b);
    expect(zip.entries.map((e) => e.name)).toEqual(["b.xml", "a.xml"]);
    const patched = readZip(zip.replace("a.xml", text("<a/>")));
    expect(str(patched.bytes("a.xml"))).toBe("<a/>");
    expect(same(patched.bytes("b.xml"), bigText(700))).toBe(true);
    expect(patched.entries.map((e) => e.name)).toEqual(["b.xml", "a.xml"]);
    const patchedB = readZip(zip.replace("b.xml", text("<b/>")));
    expect(same(patchedB.bytes("a.xml"), bigText(500))).toBe(true);
    expect(str(patchedB.bytes("b.xml"))).toBe("<b/>");
  });

  describe("refuses unsafe layouts, saying why", () => {
    it("data before the first entry (self-extractor stub)", () => {
      const built = build([{ name: "a.txt", data: text("x") }], {
        prefix: text("MZ-stub-stub-stub"),
      });
      const zip = readZip(built.bytes);
      expect(() => zip.replace("a.txt", text("y"))).toThrow(/precedes the first entry/);
    });

    it("junk between the last entry and the central directory", () => {
      const built = build([{ name: "a.txt", data: text("x") }], { junkBetween: text("JUNK") });
      expect(() => readZip(built.bytes).replace("a.txt", text("y"))).toThrow(/unexpected 4 bytes/);
    });

    it("a gap between records", () => {
      const built = build([
        { name: "a.txt", data: text("x") },
        { name: "b.txt", data: text("y") },
      ]);
      const [aStart, aEnd] = built.records[0]!;
      const b = new Uint8Array(built.bytes.length + 3);
      b.set(built.bytes.subarray(0, aEnd), 0);
      b.set(built.bytes.subarray(aEnd), aEnd + 3);
      const dv = new DataView(b.buffer);
      // Shift b's offset and the central directory offset.
      const cd = built.cdOffset + 3;
      const second = cd + 46 + 5;
      dv.setUint32(second + 42, built.records[1]![0] + 3, true);
      dv.setUint32(b.length - 22 + 16, cd, true);
      expect(aStart).toBe(0);
      expect(() => readZip(b).replace("a.txt", text("z"))).toThrow(/Cannot patch/);
    });

    it("trailing data after the archive", () => {
      const built = build([{ name: "a.txt", data: text("x") }]);
      const b = new Uint8Array(built.bytes.length + 4);
      b.set(built.bytes);
      b.set(text("TAIL"), built.bytes.length);
      const zip = readZip(b);
      expect(same(zip.bytes("a.txt"), text("x"))).toBe(true);
      expect(() => zip.replace("a.txt", text("y"))).toThrow(/extra data after/);
    });

    it("a directory entry as the target, or a new name ending in a slash", () => {
      const zip = readZip(sample().bytes);
      expect(() => zip.replace("_rels/", text("x"))).toThrow(/directory/);
      expect(() => zip.replace("new/", text("x"))).toThrow(/directory/);
      expect(() => zip.replace("", text("x"))).toThrow(/empty name/);
    });

    it("duplicate names and encrypted targets", () => {
      const dup = build([
        { name: "a.txt", data: text("1") },
        { name: "a.txt", data: text("2") },
      ]);
      expect(() => readZip(dup.bytes).replace("a.txt", text("3"))).toThrow(/more than once/);
      const built = build([{ name: "a.txt", data: text("1") }]);
      const b = built.bytes.slice();
      new DataView(b.buffer).setUint16(built.cdOffset + 8, 1, true);
      expect(() => readZip(b).replace("a.txt", text("3"))).toThrow(/encrypted/);
    });
  });

  it("does linear work: a 20 MB entry is compressed once and nothing else is decompressed", () => {
    // Counted work rather than a wall-clock limit, which fails on a loaded machine.
    const others = [bigText(300_000), bigText(200_000)];
    const built = build([
      { name: "a.xml", data: others[0] },
      { name: "big.xml", data: bigText(1000) },
      { name: "c.xml", data: others[1] },
    ]);
    const big = bigText(20 * 1024 * 1024);
    const zip = readZip(built.bytes);
    work.reset();
    const patched = zip.replace("big.xml", big);
    // Exactly one deflate, of exactly the new content; no other entry inflated or re-deflated.
    expect(work.deflateCalls).toBe(1);
    expect(work.deflatedBytes).toBe(big.length);
    expect(work.inflateCalls).toBe(0);
    // The output is the other records verbatim plus the new record: no copies accumulate.
    const otherRecords = built.records
      .filter((_, i) => i !== 1)
      .reduce((sum, [s, e]) => sum + (e - s), 0);
    expect(patched.length).toBeLessThan(otherRecords + big.length / 10 + 1024);
    work.reset();
    const back = readZip(patched).bytes("big.xml");
    expect(work.inflateCalls).toBe(1);
    expect(work.deflateCalls).toBe(0);
    expect(same(back, big)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Adversarial layouts, checked with readers that share no code with archive.ts.

/** Each entry's raw local record (header, data, descriptor), found by an independent walk. */
function localRecords(bytes: Uint8Array): Array<{ name: string; record: Uint8Array }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= 0; p--) {
    if (
      dv.getUint32(p, true) === 0x06054b50 &&
      p + 22 + dv.getUint16(p + 20, true) === bytes.length
    ) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end record");
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const found: Array<{ name: string; offset: number }> = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    const name = Array.from(bytes.subarray(p + 46, p + 46 + nameLen), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    found.push({ name, offset: dv.getUint32(p + 42, true) });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const starts = [...found.map((f) => f.offset), cdOffset].sort((a, b) => a - b);
  return found.map(({ name, offset }) => {
    const end = starts.find((s) => s > offset) ?? cdOffset;
    return { name, record: bytes.subarray(offset, end) };
  });
}

const hasPython = spawnSync("python3", ["-c", "import zipfile"], { stdio: "ignore" }).status === 0;
const hasUnzip = spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;

/** Python's zipfile (if present): [size, crc] of every entry, read and CRC-checked by Python. */
function pythonEntries(bytes: Uint8Array): Array<[number, number]> | null {
  if (!hasPython) return null;
  const dir = mkdtempSync(join(tmpdir(), "archive-py-"));
  try {
    const file = join(dir, "a.zip");
    writeFileSync(file, bytes);
    const script =
      "import zipfile,zlib,json,sys\n" +
      "z=zipfile.ZipFile(sys.argv[1])\n" +
      "print(json.dumps([[len(d),zlib.crc32(d)] for d in (z.read(i) for i in z.infolist())]))";
    const r = spawnSync("python3", ["-I", "-c", script, file], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`python zipfile rejected the archive: ${r.stderr}`);
    return JSON.parse(r.stdout) as Array<[number, number]>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `unzip -t` (if present): "ok", or its complaint. */
function unzipTest(bytes: Uint8Array): string | null {
  if (!hasUnzip) return null;
  const dir = mkdtempSync(join(tmpdir(), "archive-unzip-"));
  try {
    const file = join(dir, "a.zip");
    writeFileSync(file, bytes);
    const r = spawnSync("unzip", ["-tqq", file], { encoding: "utf8" });
    return r.status === 0 ? "ok" : `unzip -t failed (${r.status}): ${r.stdout}${r.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Proves `patched` is `original` with only entry `index` replaced: every other local record is
 * byte-identical, and fflate, Python and unzip read every entry as `contents` (in entry order).
 */
function expectSurgical(
  original: Uint8Array,
  patched: Uint8Array,
  index: number,
  contents: readonly Uint8Array[],
  external = true,
): void {
  const before = localRecords(original);
  const after = localRecords(patched);
  expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
  before.forEach((r, i) => {
    if (i !== index) expect(same(after[i]!.record, r.record), `record ${i}`).toBe(true);
  });
  const fromFflate = unzipSync(patched);
  readZip(patched).entries.forEach((entry, i) => {
    if (entry.isDirectory) return;
    expect(same(fromFflate[entry.name]!, contents[i]!), `fflate ${entry.name}`).toBe(true);
  });
  if (!external) return;
  const py = pythonEntries(patched);
  if (py) expect(py).toEqual(contents.map((c) => [c.length, crc32(c)]));
  // unzip's overlap check assumes signed data descriptors, so it rejects some valid archives;
  // the patch must not make it any less happy than it was with the original.
  const unzip = unzipTest(patched);
  if (unzip) expect(unzip).toBe(unzipTest(original));
}

describe("adversarial archives", () => {
  /** Info-ZIP Unicode Path extra field (0x7075): version 1, CRC of the header name, the name. */
  const unicodePath = (name: string): Uint8Array =>
    new Uint8Array([
      ...le(0x7075, 2),
      ...le(5 + text(name).length, 2),
      1,
      ...le(crc32(text(name)), 4),
      ...text(name),
    ]);

  function zoo(): { built: Built; contents: Uint8Array[] } {
    const specs: Spec[] = [
      { name: "mimetype", data: text("application/zip-test"), method: 0 },
      { name: "dir/", data: new Uint8Array(0), method: 0 },
      { name: "a\\back\\slash.xml", data: bigText(900) },
      { name: "../up.xml", data: text("<up/>"), descriptor: "signed" },
      { name: "/abs.xml", data: bigText(300), descriptor: "unsigned", extraFlags: 0x06 },
      { name: "名前/ünï.xml", data: text("<u>ü</u>"), utf8Flag: true, fileComment: "c" },
      {
        name: "ut.xml",
        data: bigText(2000),
        localExtra: new Uint8Array([0x55, 0x54, 5, 0, 1, 1, 2, 3, 4]),
        centralExtra: unicodePath("ut.xml"),
      },
      { name: "empty-stored.xml", data: new Uint8Array(0), method: 0 },
      { name: "empty-deflated.xml", data: new Uint8Array(0), method: 8 },
      { name: "bin.dat", data: Uint8Array.from({ length: 256 }, (_, i) => i), method: 0 },
    ];
    return {
      built: build(specs, { comment: "zoo comment" }),
      contents: specs.map((s) => s.data ?? new Uint8Array(0)),
    };
  }

  it("reads every entry of a zoo of unusual entries, as python does", () => {
    const { built, contents } = zoo();
    const zip = readZip(built.bytes);
    expect(zip.entries.map((e) => e.name)).toContain("a\\back\\slash.xml");
    zip.entries.forEach((e, i) => {
      if (!e.isDirectory) expect(same(zip.bytes(e.name), contents[i]!), e.name).toBe(true);
    });
    const py = pythonEntries(built.bytes);
    if (py) expect(py).toEqual(contents.map((c) => [c.length, crc32(c)]));
  });

  // Generous timeout: it starts python and unzip about twenty times, slow on a loaded machine.
  it(
    "patches each entry of the zoo in turn, leaving every other record byte for byte",
    {
      timeout: 120_000,
    },
    () => {
      const { built, contents } = zoo();
      const zip = readZip(built.bytes);
      zip.entries.forEach((entry, index) => {
        if (entry.isDirectory) return;
        [bigText(1500), new Uint8Array(0), text("tiny")].forEach((replacement, n) => {
          const patched = zip.replace(entry.name, replacement);
          const expected = contents.map((c, i) => (i === index ? replacement : c));
          // The outside readers check the first replacement of each entry; ours check them all.
          expectSurgical(built.bytes, patched, index, expected, n === 0);
        });
      });
    },
  );

  it("copies a neighbour with a bad CRC exactly as it was (never repaired or dropped)", () => {
    const built = build([
      { name: "bad.xml", data: text("damaged"), crc: 0xdeadbeef },
      { name: "good.xml", data: text("<g/>") },
    ]);
    const patched = readZip(built.bytes).replace("good.xml", text("<h/>"));
    expect(same(localRecords(patched)[0]!.record, localRecords(built.bytes)[0]!.record)).toBe(true);
    expect(() => readZip(patched).bytes("bad.xml")).toThrow(/CRC/);
    expect(str(readZip(patched).bytes("good.xml"))).toBe("<h/>");
  });

  it("reads a deflated entry with no compressed bytes at all as empty, as other readers do", () => {
    const built = build([
      { name: "a.xml", data: new Uint8Array(0), method: 8, body: new Uint8Array(0) },
      { name: "b.xml", data: text("<b/>") },
    ]);
    const py = pythonEntries(built.bytes);
    if (py) expect(py[0]).toEqual([0, 0]);
    const zip = readZip(built.bytes);
    expect(zip.bytes("a.xml").length).toBe(0);
    expectSurgical(built.bytes, zip.replace("b.xml", text("<c/>")), 1, [
      new Uint8Array(0),
      text("<c/>"),
    ]);
    // But no bytes that claim to inflate to something is still corrupt.
    const b = built.bytes.slice();
    new DataView(b.buffer).setUint32(built.cdOffset + 24, 5, true);
    expect(() => readZip(b).bytes("a.xml")).toThrow(ArchiveError);
  });

  describe("refuses to patch what it cannot reproduce exactly", () => {
    const expectRefused = (bytes: Uint8Array, name: string, why: RegExp): void => {
      let zip: ReturnType<typeof readZip>;
      try {
        zip = readZip(bytes);
      } catch (error) {
        expect(error).toBeInstanceOf(ArchiveError);
        return;
      }
      expect(() => zip.replace(name, text("<new/>"))).toThrow(why);
    };

    /** Inserts `extra` at the end of the central directory and counts it in the CD size. */
    function withCentralTail(built: Built, extra: Uint8Array): Uint8Array {
      const eocd = built.bytes.length - 22;
      const out = new Uint8Array(built.bytes.length + extra.length);
      out.set(built.bytes.subarray(0, eocd), 0);
      out.set(extra, eocd);
      out.set(built.bytes.subarray(eocd), eocd + extra.length);
      const dv = new DataView(out.buffer);
      const at = eocd + extra.length;
      dv.setUint32(at + 12, dv.getUint32(at + 12, true) + extra.length, true);
      return out;
    }

    const two = (): Built =>
      build([
        { name: "a.xml", data: text("<a/>") },
        { name: "b.xml", data: text("<b/>") },
      ]);

    it("data in the central directory after the last counted header (it would be dropped)", () => {
      // A digital signature record (header 0x05054b50) belongs to the central directory.
      const signature = new Uint8Array([...le(0x05054b50, 4), ...le(4, 2), 1, 2, 3, 4]);
      const bytes = withCentralTail(two(), signature);
      expect(str(readZip(bytes).bytes("a.xml"))).toBe("<a/>");
      expectRefused(bytes, "a.xml", /central directory/);
    });

    it("a central header that the end record does not count (an alias of a record)", () => {
      const built = two();
      const second = built.cdOffset + 46 + 5;
      const alias = built.bytes.slice(second, second + 46 + 5);
      new DataView(alias.buffer).setUint32(42, 0, true);
      expectRefused(withCentralTail(built, alias), "b.xml", /central directory/);
    });

    it("two central headers sharing one local record", () => {
      const built = two();
      const b = built.bytes.slice();
      new DataView(b.buffer).setUint32(built.cdOffset + 46 + 5 + 42, 0, true);
      expectRefused(b, "a.xml", /Cannot patch/);
    });

    it("a record that starts inside another one's data (overlap)", () => {
      const inner = build([{ name: "x.xml", data: text("<x/>"), method: 0 }]);
      const built = build([
        { name: "a.bin", data: inner.bytes.subarray(0, inner.records[0]![1]), method: 0 },
        { name: "b.xml", data: text("<b/>") },
      ]);
      const b = built.bytes.slice();
      // Point b's central header at the local header hidden inside a's data.
      new DataView(b.buffer).setUint32(built.cdOffset + 46 + 5 + 42, 30 + 5, true);
      expectRefused(b, "a.bin", /Cannot patch/);
    });

    it("offsets beyond the central directory, and a truncated central directory", () => {
      const built = two();
      const far = built.bytes.slice();
      new DataView(far.buffer).setUint32(built.cdOffset + 42, 0x7ffffff0, true);
      expect(() => readZip(far).bytes("a.xml")).toThrow(ArchiveError);
      expectRefused(far, "b.xml", /Corrupt|Cannot patch/);
      // Remove the last 10 bytes of the central directory, keeping a well-formed end record.
      const eocd = built.bytes.length - 22;
      const cut = new Uint8Array(built.bytes.length - 10);
      cut.set(built.bytes.subarray(0, eocd - 10), 0);
      cut.set(built.bytes.subarray(eocd), eocd - 10);
      expect(() => readZip(cut)).toThrow(ArchiveError);
    });

    it("a neighbour with a zip64 data descriptor (24 bytes)", () => {
      const built = build([
        { name: "a.xml", data: text("<a/>"), descriptor: "signed" },
        { name: "b.xml", data: text("<b/>") },
      ]);
      const aEnd = built.records[0]![1];
      const grow = 8;
      const b = new Uint8Array(built.bytes.length + grow);
      b.set(built.bytes.subarray(0, aEnd), 0);
      b.set(built.bytes.subarray(aEnd), aEnd + grow);
      const dv = new DataView(b.buffer);
      const cd = built.cdOffset + grow;
      dv.setUint32(cd + 46 + 5 + 42, built.records[1]![0] + grow, true);
      dv.setUint32(b.length - 22 + 16, cd, true);
      expect(str(readZip(b).bytes("b.xml"))).toBe("<b/>");
      expectRefused(b, "b.xml", /unexpected 24 bytes/);
    });
  });
});

describe("fuzzing", () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function exercise(bytes: Uint8Array): void {
    try {
      const zip = readZip(bytes);
      for (const e of zip.entries) {
        try {
          if (!e.isDirectory) zip.bytes(e.name);
        } catch (error) {
          if (!(error instanceof ArchiveError)) throw error;
        }
      }
      const first = zip.entries.find((e) => !e.isDirectory);
      zip.replace(first?.name ?? "x.xml", text("<patched/>"));
      zip.replace("appended.xml", text("<patched/>"));
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
    }
  }

  it("only ever succeeds or throws ArchiveError under random corruption (600 iterations)", () => {
    const original = sample().bytes;
    const random = rng(20240601);
    const started = performance.now();
    for (let i = 0; i < 600; i++) {
      const b = original.slice();
      const kind = i % 4;
      if (kind === 0) {
        b[Math.floor(random() * b.length)] = Math.floor(random() * 256);
      } else if (kind === 1) {
        const at = Math.floor(random() * b.length);
        const len = Math.floor(random() * 40);
        for (let k = at; k < Math.min(b.length, at + len); k++) b[k] = Math.floor(random() * 256);
      } else if (kind === 2) {
        // Corrupt the structural regions: local headers and the tail.
        const at = b.length - 1 - Math.floor(random() * 400);
        b[at] = Math.floor(random() * 256);
        b[Math.floor(random() * 40)] = Math.floor(random() * 256);
      } else {
        exercise(b.subarray(0, Math.floor(random() * b.length)));
        continue;
      }
      const before = b.slice();
      exercise(b);
      expect(same(b, before)).toBe(true);
    }
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it("copes with pure noise and tiny inputs", () => {
    const random = rng(7);
    for (let i = 0; i < 100; i++) {
      const b = new Uint8Array(Math.floor(random() * 300));
      for (let k = 0; k < b.length; k++) b[k] = Math.floor(random() * 256);
      exercise(b);
    }
  });
});

describe("cross-check with real zip tools", () => {
  const tool = (cmd: string, args: string[]): boolean => {
    const r = spawnSync(cmd, args, { stdio: "ignore" });
    return !r.error && r.status === 0;
  };
  const hasPython = tool("python3", ["-c", "import zipfile"]);
  const hasUnzip = spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;

  function check(label: string, bytes: Uint8Array): void {
    const dir = mkdtempSync(join(tmpdir(), "archive-test-"));
    try {
      const file = join(dir, "patched.zip");
      writeFileSync(file, bytes);
      if (hasPython) {
        const real = spawnSync(
          "python3",
          [
            "-I",
            "-c",
            "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None",
            file,
          ],
          { encoding: "utf8" },
        );
        expect(real.status, `${label}: python zipfile: ${real.stderr}`).toBe(0);
      }
      if (hasUnzip) {
        const real = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
        expect(real.status, `${label}: unzip -t: ${real.stdout}`).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.skipIf(!hasPython && !hasUnzip)("patched archives pass python zipfile and unzip -t", () => {
    const built = sample();
    const zip = readZip(built.bytes);
    check("original", built.bytes);
    check("replace deflated", zip.replace("word/document.xml", bigText(30000)));
    check("replace with descriptor", zip.replace("word/styles.xml", text("<s/>")));
    check("replace stored", zip.replace("media/logo.png", new Uint8Array([9, 9, 9])));
    check("replace empty", zip.replace("word/empty.xml", text("now not empty")));
    check("append", zip.replace("word/added.xml", text("<a/>")));
    check("append unicode", zip.replace("word/é日本.xml", text("<a/>")));
    const odt = build([
      { name: "mimetype", data: text("application/vnd.oasis.opendocument.text"), method: 0 },
      { name: "content.xml", data: bigText(4000) },
    ]);
    check("odt", readZip(odt.bytes).replace("content.xml", bigText(8000)));
    check(
      "twice",
      readZip(zip.replace("word/document.xml", text("<1/>"))).replace(
        "word/document.xml",
        text("<2/>"),
      ),
    );
  });

  it.skipIf(hasPython || hasUnzip)("SKIPPED: neither python3 nor unzip is available", () => {
    expect(true).toBe(true);
  });
});
