import { zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readZip } from "../core/archive";
import type { FormatProvider } from "../core/format";
import { FormatRegistry } from "../core/registry";
import { ContainerPlatform, isTextPart } from "./containers";
import { MemoryPlatform } from "./memory";
import type { FileFormat, Platform } from "./platform";

// A deliberately faulty `replace`, to prove the self-check blocks a bad result before it is written.
const fault = vi.hoisted(() => ({ mode: null as null | "noop" | "other" | "reorder" }));

vi.mock("../core/archive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/archive")>();
  return {
    ...actual,
    readZip(bytes: Uint8Array) {
      const real = actual.readZip(bytes);
      return {
        ...real,
        replace(name: string, data: Uint8Array) {
          const good = real.replace(name, data);
          if (fault.mode === "noop") return bytes;
          if (fault.mode === null) return good;
          const parts: Record<string, Uint8Array> = {};
          const names = real.entries.filter((e) => !e.isDirectory).map((e) => e.name);
          for (const n of fault.mode === "reorder" ? [...names].reverse() : names) {
            parts[n] = n === name ? data : real.bytes(n);
          }
          if (fault.mode === "other") parts["word/styles.xml"] = new TextEncoder().encode("<x/>");
          return zipSync(parts);
        },
      };
    },
  };
});

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const DOC =
  '<?xml version="1.0"?>\n<w:document xmlns:w="urn:w"><w:body>Hello</w:body></w:document>';
const STYLES = "<styles>\n  <style id='a'/>\n</styles>";
const RELS = '<Relationships><Relationship Id="1"/></Relationships>';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254]);

const CONTAINER = "/demo/report.docx";
const part = (name: string) => `${CONTAINER}!/${name}`;

function docx(overrides: Record<string, Uint8Array | string> = {}): Uint8Array {
  const entries: Record<string, Uint8Array | string> = {
    "[Content_Types].xml": "<Types/>",
    "_rels/.rels": RELS,
    "word/": "",
    "word/document.xml": DOC,
    "word/styles.xml": STYLES,
    "word/media/image1.png": PNG,
    ...overrides,
  };
  const input: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries)) {
    input[name] = typeof value === "string" ? enc(value) : value;
  }
  return zipSync(input, { mtime: new Date(2020, 0, 1) });
}

const fakeDocx: FormatProvider = {
  kind: "text",
  id: "docx",
  name: "Word document",
  fileExtensions: ["docx"],
  viewModes: ["source"],
  readOnly: true,
  binary: {
    archive: "zip",
    decode: async (bytes, { path }) => `view of ${path}: ${bytes.length} bytes`,
  },
  editorExtensions: () => [],
};
const fakeBin: FormatProvider = {
  ...fakeDocx,
  id: "bin",
  fileExtensions: ["bin"],
  binary: { decode: async () => "binary view" },
};

const LF: FileFormat = { encoding: "utf-8", bom: false, eol: "lf", mixedEol: false };

let memory: MemoryPlatform;
let platform: ContainerPlatform;

function setup(bytes: Uint8Array = docx()) {
  const registry = new FormatRegistry();
  registry.register(fakeDocx);
  registry.register(fakeBin);
  memory = new MemoryPlatform();
  memory.seedBinary(CONTAINER, bytes);
  platform = new ContainerPlatform(memory, registry);
}

function disk(path = CONTAINER): Uint8Array {
  const bytes = memory.binaryFiles.get(path);
  if (!bytes) throw new Error(`no ${path} on the fake disk`);
  return bytes;
}

beforeEach(() => {
  fault.mode = null;
  setup();
});

describe("isTextPart", () => {
  it("decides by extension, including the dot-first .rels", () => {
    for (const name of ["a.xml", "_rels/.rels", "x/Y.RELS", "a.txt", "p.html", "s.svg", "n.md"]) {
      expect(isTextPart(name), name).toBe(true);
    }
    for (const name of ["a.png", "word/fonts/x.odttf", "noextension", "a.xml.bin"]) {
      expect(isTextPart(name), name).toBe(false);
    }
  });
});

describe("containers access", () => {
  it("finds the container of a part, of a container, and of an ordinary file", () => {
    const access = platform.containers;
    expect(access.containerOf(part("word/document.xml"))).toBe(CONTAINER);
    expect(access.containerOf(CONTAINER)).toBe(CONTAINER);
    expect(access.containerOf("/demo/notes.md")).toBeNull();
    expect(access.containerOf("/demo/other.bin")).toBeNull(); // binary view, but not a zip
    expect(access.containerOf("/demo/weird!/x.xml")).toBeNull();
  });

  it("lists parts in archive order, without directories, text decided by extension", async () => {
    const parts = await platform.containers.listParts(CONTAINER);
    expect(parts.map((p) => p.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/media/image1.png",
    ]);
    expect(parts.map((p) => p.text)).toEqual([true, true, true, true, false]);
    expect(parts[2]?.size).toBe(enc(DOC).length);
  });

  it("rejects listing a file that is missing or not an archive", async () => {
    await expect(platform.containers.listParts("/demo/none.docx")).rejects.toThrow(/not found/i);
    memory.seedBinary("/demo/bad.docx", enc("not a zip at all"));
    await expect(platform.containers.listParts("/demo/bad.docx")).rejects.toThrow();
  });
});

describe("reading", () => {
  it("reads a part's text through the codec, with its version token", async () => {
    const data = await platform.readFile(part("word/document.xml"));
    expect(data.text).toBe(DOC);
    expect(data.format).toEqual(LF);
    const stat = await platform.statFile(part("word/document.xml"));
    expect(data.modifiedMs).toBe(stat?.modifiedMs);
  });

  it("detects the part's BOM and line endings", async () => {
    const crlf = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("<a>\r\n</a>\r\n")]);
    setup(docx({ "word/document.xml": crlf }));
    const data = await platform.readFile(part("word/document.xml"));
    expect(data.text).toBe("<a>\n</a>\n");
    expect(data.format).toEqual({ encoding: "utf-8", bom: true, eol: "crlf", mixedEol: false });
  });

  it("rejects a binary part, a missing part and invalid UTF-8", async () => {
    await expect(platform.readFile(part("word/media/image1.png"))).rejects.toThrow(
      "word/media/image1.png is a binary part and cannot be opened as text",
    );
    await expect(platform.readFile(part("word/nope.xml"))).rejects.toThrow(
      /no part "word\/nope.xml"/,
    );
    setup(docx({ "word/document.xml": Uint8Array.from([0x3c, 0xff, 0x3e]) }));
    await expect(platform.readFile(part("word/document.xml"))).rejects.toThrow(/not valid UTF-8/);
  });

  it("reads the container as its read-only view with the real modification time", async () => {
    const data = await platform.readFile(CONTAINER);
    expect(data.text).toBe(`view of ${CONTAINER}: ${disk().length} bytes`);
    expect(data.format).toEqual(LF);
    expect((await memory.statFile(CONTAINER))?.modifiedMs).toBe(data.modifiedMs);
  });

  it("hands back the source map when a view's decode provides one, and none when it does not", async () => {
    const map = [
      { fromLine: 1, toLine: 2, part: "word/document.xml", locator: "/w:document/w:body/w:p[1]" },
    ];
    const withMap: FormatProvider = {
      ...fakeDocx,
      binary: { archive: "zip", decode: async () => ({ text: "mapped view", sourceMap: map }) },
    };
    const registry = new FormatRegistry();
    registry.register(withMap);
    const mapped = new ContainerPlatform(memory, registry);
    const data = await mapped.readFile(CONTAINER);
    expect(data.text).toBe("mapped view");
    expect(data.sourceMap).toEqual(map);
    // A decode that returns plain text has no source map.
    expect((await platform.readFile(CONTAINER)).sourceMap).toBeUndefined();
  });

  it("forwards ordinary files and non-zip binary views", async () => {
    memory.seedFile("/demo/a.md", "# hi", LF);
    expect((await platform.readFile("/demo/a.md")).text).toBe("# hi");
    memory.seedBinary("/demo/x.bin", [1, 2]);
    expect((await platform.readFile("/demo/x.bin")).text).toBe("binary view");
  });

  it("returns a part's bytes and forwards other binary reads", async () => {
    const png = await platform.readBinaryFile(part("word/media/image1.png"));
    expect(Array.from(png.bytes)).toEqual(Array.from(PNG));
    const whole = await platform.readBinaryFile(CONTAINER);
    expect(whole.bytes).toEqual(disk());
  });

  it("stats parts, the root and missing things", async () => {
    expect(await platform.statFile(part("word/nope.xml"))).toBeNull();
    expect(await platform.statFile("/demo/none.docx!/word/document.xml")).toBeNull();
    expect(await platform.statFile(CONTAINER)).toEqual(await memory.statFile(CONTAINER));
    expect(await platform.fileExists(part("word/document.xml"))).toBe(true);
    expect(await platform.fileExists(part("word/nope.xml"))).toBe(false);
  });

  it("reads the archive once for many parts, and again when the file changes", async () => {
    const spy = vi.spyOn(memory, "readBinaryFile");
    await platform.readFile(part("word/document.xml"));
    await platform.readFile(part("word/styles.xml"));
    await platform.statFile(part("_rels/.rels"));
    await platform.containers.listParts(CONTAINER);
    expect(spy).toHaveBeenCalledTimes(1);
    memory.seedBinary(CONTAINER, docx({ "word/styles.xml": "<styles/>" }));
    expect((await platform.readFile(part("word/styles.xml"))).text).toBe("<styles/>");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("watching", () => {
  it("watches the container and reports the virtual path", async () => {
    const seen: string[] = [];
    const stop = await platform.watchFile(part("word/document.xml"), (c) =>
      seen.push(`${c.kind} ${c.path}`),
    );
    memory.triggerFileChange(CONTAINER);
    memory.triggerFileChange(CONTAINER, "removed");
    expect(seen).toEqual([
      `modified ${part("word/document.xml")}`,
      `removed ${part("word/document.xml")}`,
    ]);
    stop();
    memory.triggerFileChange(CONTAINER);
    expect(seen).toHaveLength(2);
  });

  it("forwards watches of ordinary paths, and of the container itself", async () => {
    const seen: string[] = [];
    await platform.watchFile(CONTAINER, (c) => seen.push(c.path));
    await platform.watchFile("/demo/a.md", (c) => seen.push(c.path));
    memory.triggerFileChange(CONTAINER);
    memory.triggerFileChange("/demo/a.md");
    expect(seen).toEqual([CONTAINER, "/demo/a.md"]);
  });
});

describe("saving a part", () => {
  const EDITED = `<w:document xmlns:w="urn:w"><w:body>Edited</w:body></w:document>`;

  it("changes that part only; every other entry stays byte for byte", async () => {
    const before = disk();
    await platform.readFile(part("word/styles.xml")); // warm the cache: the save must not rely on it
    await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    const after = disk();
    const old = readZip(before);
    const now = readZip(after);
    expect(dec(now.bytes("word/styles.xml"))).toBe(EDITED);
    expect(now.entries.map((e) => e.name)).toEqual(old.entries.map((e) => e.name));
    for (const entry of old.entries) {
      if (entry.name === "word/styles.xml") continue;
      const next = now.info(entry.name);
      expect(next?.crc32).toBe(entry.crc32);
      expect(next?.size).toBe(entry.size);
      expect(next?.compressedSize).toBe(entry.compressedSize);
      if (!entry.isDirectory) expect(now.bytes(entry.name)).toEqual(old.bytes(entry.name));
    }
    // The raw bytes before the replaced entry are identical (everything ahead of it in the file).
    const untouchedBefore = old.entries
      .slice(
        0,
        old.entries.findIndex((e) => e.name === "word/styles.xml"),
      )
      .reduce((sum, e) => sum + e.compressedSize, 0);
    let common = 0;
    while (common < before.length && before[common] === after[common]) common++;
    expect(common).toBeGreaterThanOrEqual(untouchedBefore);
  });

  it("writes the part with its own encoding, BOM and line endings", async () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("<a>\r\n</a>\r\n")]);
    setup(docx({ "word/document.xml": original }));
    const { text, format } = await platform.readFile(part("word/document.xml"));
    await platform.writeFile(part("word/document.xml"), text.replace("<a>", "<a b='1'>"), format);
    expect(Array.from(readZip(disk()).bytes("word/document.xml"))).toEqual(
      Array.from(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("<a b='1'>\r\n</a>\r\n")])),
    );
  });

  it("returns the part's token, which a later stat and read agree with", async () => {
    const result = await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    expect((await platform.statFile(part("word/styles.xml")))?.modifiedMs).toBe(result.modifiedMs);
    expect((await platform.readFile(part("word/styles.xml"))).modifiedMs).toBe(result.modifiedMs);
    expect((await platform.readFile(part("word/styles.xml"))).text).toBe(EDITED);
  });

  it("changes the container's real modification time (that is how a Formatting view goes stale)", async () => {
    const before = (await platform.statFile(CONTAINER))?.modifiedMs;
    await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    expect((await platform.statFile(CONTAINER))?.modifiedMs).not.toBe(before);
  });

  it("reads the file fresh: another program's change to another part survives", async () => {
    await platform.readFile(part("word/document.xml")); // cached
    memory.seedBinary(CONTAINER, docx({ "word/document.xml": "<changed-outside/>" }));
    await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    const now = readZip(disk());
    expect(dec(now.bytes("word/document.xml"))).toBe("<changed-outside/>");
    expect(dec(now.bytes("word/styles.xml"))).toBe(EDITED);
  });

  it("takes a backup once, and never overwrites it", async () => {
    const original = disk();
    await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    expect(memory.binaryFiles.get(`${CONTAINER}.bak`)).toEqual(original);
    await platform.writeFile(part("word/styles.xml"), "<second/>", LF);
    expect(memory.binaryFiles.get(`${CONTAINER}.bak`)).toEqual(original);
  });

  it("keeps an existing .bak from an earlier session", async () => {
    memory.seedBinary(`${CONTAINER}.bak`, [9, 9, 9]);
    await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    expect(Array.from(memory.binaryFiles.get(`${CONTAINER}.bak`) ?? [])).toEqual([9, 9, 9]);
    expect(dec(readZip(disk()).bytes("word/styles.xml"))).toBe(EDITED);
  });

  it("does not save when the backup fails for any other reason", async () => {
    const original = disk();
    memory.failNextBinaryWrite = new Error("disk full");
    await expect(platform.writeFile(part("word/styles.xml"), EDITED, LF)).rejects.toThrow(
      /back up.*disk full/,
    );
    expect(disk()).toEqual(original);
    // And the next attempt tries the backup again.
    await platform.writeFile(part("word/styles.xml"), EDITED, LF);
    expect(memory.binaryFiles.has(`${CONTAINER}.bak`)).toBe(true);
  });

  it("refuses ill-formed XML, naming the part and position, and writes nothing", async () => {
    const original = disk();
    const error = await platform
      .writeFile(part("word/document.xml"), "<a>\n  <b></a>", LF)
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("word/document.xml");
    expect(message).toMatch(/line 2/);
    expect(message).toMatch(/column \d+/);
    expect(disk()).toEqual(original);
    expect(memory.binaryFiles.has(`${CONTAINER}.bak`)).toBe(false);
    await expect(platform.writeFile(part("_rels/.rels"), "<a>", LF)).rejects.toThrow(
      /_rels\/.rels/,
    );
    await expect(platform.writeFile(part("word/document.xml"), "", LF)).rejects.toThrow(
      /well-formed/,
    );
    expect(disk()).toEqual(original);
  });

  it("does not demand well-formedness of non-XML parts", async () => {
    setup(docx({ "word/notes.txt": "plain" }));
    await platform.writeFile(part("word/notes.txt"), "<not xml", LF);
    expect(dec(readZip(disk()).bytes("word/notes.txt"))).toBe("<not xml");
  });

  it("refuses binary parts, directories and parts that do not exist", async () => {
    const original = disk();
    await expect(platform.writeFile(part("word/media/image1.png"), "x", LF)).rejects.toThrow(
      /binary part/,
    );
    await expect(platform.writeFile(part("word/nope.xml"), "<a/>", LF)).rejects.toThrow(/no part/);
    expect(disk()).toEqual(original);
  });

  it("refuses when the container is missing or not an archive", async () => {
    await expect(platform.writeFile("/demo/none.docx!/a.xml", "<a/>", LF)).rejects.toThrow(
      /Could not read/,
    );
    memory.seedBinary("/demo/bad.docx", enc("nope"));
    await expect(platform.writeFile("/demo/bad.docx!/a.xml", "<a/>", LF)).rejects.toThrow(
      /not a readable archive/,
    );
  });

  it("leaves the file untouched when the write itself fails", async () => {
    const original = disk();
    await platform.writeFile(part("word/styles.xml"), EDITED, LF); // takes the backup
    const saved = disk();
    memory.failNextBinaryWrite = new Error("access denied");
    await expect(platform.writeFile(part("word/document.xml"), "<a/>", LF)).rejects.toThrow(
      /access denied/,
    );
    expect(disk()).toEqual(saved);
    expect(original).not.toEqual(saved);
  });

  it("does not overwrite a file that changed after it was read", async () => {
    const real = memory.readBinaryFile.bind(memory);
    vi.spyOn(memory, "readBinaryFile").mockImplementation(async (path) => {
      const result = await real(path);
      memory.seedBinary(CONTAINER, docx({ "word/document.xml": "<other-program/>" }));
      return result;
    });
    await expect(platform.writeFile(part("word/styles.xml"), EDITED, LF)).rejects.toThrow(
      /changed on disk/,
    );
    expect(dec(readZip(disk()).bytes("word/document.xml"))).toBe("<other-program/>");
  });

  it("lands both of two concurrent saves of different parts", async () => {
    await Promise.all([
      platform.writeFile(part("word/document.xml"), "<doc>one</doc>", LF),
      platform.writeFile(part("word/styles.xml"), "<styles>two</styles>", LF),
      platform.writeFile(part("_rels/.rels"), "<rels>three</rels>", LF),
    ]);
    const now = readZip(disk());
    expect(dec(now.bytes("word/document.xml"))).toBe("<doc>one</doc>");
    expect(dec(now.bytes("word/styles.xml"))).toBe("<styles>two</styles>");
    expect(dec(now.bytes("_rels/.rels"))).toBe("<rels>three</rels>");
    expect(Array.from(now.bytes("word/media/image1.png"))).toEqual(Array.from(PNG));
  });

  it("keeps saving after a failed save", async () => {
    await expect(platform.writeFile(part("word/document.xml"), "<a>", LF)).rejects.toThrow();
    await platform.writeFile(part("word/document.xml"), "<a/>", LF);
    expect(dec(readZip(disk()).bytes("word/document.xml"))).toBe("<a/>");
  });
});

describe("the self-check", () => {
  it.each(["noop", "other", "reorder"] as const)(
    "blocks a faulty replace (%s) before writing",
    async (mode) => {
      const original = disk();
      fault.mode = mode;
      await expect(platform.writeFile(part("word/document.xml"), "<new/>", LF)).rejects.toThrow(
        /Self-check failed/,
      );
      expect(disk()).toEqual(original);
      expect(memory.binaryFiles.has(`${CONTAINER}.bak`)).toBe(false);
      fault.mode = null;
      await platform.writeFile(part("word/document.xml"), "<new/>", LF);
      expect(dec(readZip(disk()).bytes("word/document.xml"))).toBe("<new/>");
    },
  );
});

describe("the container root and ordinary files", () => {
  it("refuses to be saved over", async () => {
    const original = disk();
    await expect(platform.writeFile(CONTAINER, "text", LF)).rejects.toThrow(
      "This file is shown as a read-only view and cannot be saved over the original. Use Save as… to keep a text copy.",
    );
    expect(disk()).toEqual(original);
  });

  it("forwards writes of ordinary files and of paths that merely contain !/", async () => {
    await platform.writeFile("/demo/a.md", "# x", LF);
    expect(memory.files.get("/demo/a.md")?.text).toBe("# x");
    await platform.writeFile("/demo/weird!/b.md", "y", LF);
    expect(memory.files.get("/demo/weird!/b.md")?.text).toBe("y");
  });

  it("forwards everything else to the inner platform", async () => {
    await platform.setWindowTitle("T");
    expect(memory.windowTitle).toBe("T");
    expect(platform.assetUrl("/a b")).toBe(memory.assetUrl("/a b"));
    await platform.writeSettings("{}");
    expect(await platform.readSettings()).toBe("{}");
    await platform.writeBinaryFile("/demo/x.bin", Uint8Array.of(1), { overwrite: false });
    await platform.copyFile("/demo/x.bin", "/demo/y.bin", { overwrite: false });
    expect(memory.binaryFiles.has("/demo/y.bin")).toBe(true);
    expect(await platform.fileExists("/demo/y.bin")).toBe(true);
  });
});

describe("part version tokens", () => {
  const token = async (name: string) => (await platform.statFile(part(name)))?.modifiedMs;

  it("saving part A leaves part B's token alone and changes A's", async () => {
    const [a0, b0] = [await token("word/document.xml"), await token("word/styles.xml")];
    await platform.writeFile(part("word/document.xml"), "<doc>new</doc>", LF);
    expect(await token("word/styles.xml")).toBe(b0);
    expect(await token("word/document.xml")).not.toBe(a0);
    expect(await token("word/media/image1.png")).toBe(b0);
  });

  it("an outside program changing B changes only B's token", async () => {
    const before = {
      doc: await token("word/document.xml"),
      styles: await token("word/styles.xml"),
      rels: await token("_rels/.rels"),
    };
    memory.seedBinary(CONTAINER, docx({ "word/styles.xml": "<styles>outside</styles>" }));
    expect(await token("word/document.xml")).toBe(before.doc);
    expect(await token("_rels/.rels")).toBe(before.rels);
    const styles = await token("word/styles.xml");
    expect(styles).not.toBe(before.styles);
    expect(styles).toBe((await memory.statFile(CONTAINER))?.modifiedMs);
  });

  it("a part saved with identical content keeps its token", async () => {
    const before = await token("word/document.xml");
    await platform.writeFile(part("word/document.xml"), DOC, LF);
    expect(await token("word/document.xml")).toBe(before);
  });

  it("a removed part has no stat and fails to read; the others keep their tokens", async () => {
    const styles = await token("word/styles.xml");
    const entries = readZip(disk());
    const rest: Record<string, Uint8Array> = {};
    for (const e of entries.entries) {
      if (!e.isDirectory && e.name !== "word/document.xml") rest[e.name] = entries.bytes(e.name);
    }
    memory.seedBinary(CONTAINER, zipSync(rest));
    expect(await platform.statFile(part("word/document.xml"))).toBeNull();
    await expect(platform.readFile(part("word/document.xml"))).rejects.toThrow(/no part/);
    expect(await token("word/styles.xml")).toBe(styles);
  });

  it("a replaced container: unchanged parts keep their tokens, new and changed ones get the new time", async () => {
    const before = {
      doc: await token("word/document.xml"),
      styles: await token("word/styles.xml"),
    };
    memory.seedBinary(
      CONTAINER,
      docx({ "word/styles.xml": "<styles>replaced</styles>", "word/extra.xml": "<extra/>" }),
    );
    const now = (await memory.statFile(CONTAINER))?.modifiedMs;
    expect(await token("word/document.xml")).toBe(before.doc);
    expect(await token("word/styles.xml")).toBe(now);
    expect(await token("word/extra.xml")).toBe(now);
  });

  it("a part that reappears with the same content after removal gets a new token", async () => {
    const original = disk();
    const doc0 = await token("word/document.xml");
    const old = readZip(original);
    const rest: Record<string, Uint8Array> = {};
    for (const e of old.entries) {
      if (!e.isDirectory && e.name !== "word/document.xml") rest[e.name] = old.bytes(e.name);
    }
    memory.seedBinary(CONTAINER, zipSync(rest));
    await token("word/styles.xml");
    memory.seedBinary(CONTAINER, original);
    expect(await token("word/document.xml")).not.toBe(doc0);
  });
});

describe("saving under concurrency and interference", () => {
  /** Wraps `inner` so that every string argument is passed through `map` first. */
  function mapPaths(inner: MemoryPlatform, map: (path: string) => string): Platform {
    return new Proxy(inner, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- forwarding as is
          value.apply(
            target,
            args.map((a) => (typeof a === "string" ? map(a) : a)),
          );
      },
    });
  }

  function over(inner: Platform): ContainerPlatform {
    const registry = new FormatRegistry();
    registry.register(fakeDocx);
    return new ContainerPlatform(inner, registry);
  }

  it("serialises saves of one container reached by two spellings of its Windows path", async () => {
    // Windows paths are case-insensitive and accept either slash: one file, three spellings.
    const fold = (p: string) => (/^[a-z]:/i.test(p) ? p.toLowerCase().replaceAll("/", "\\") : p);
    memory.seedBinary("c:\\docs\\report.docx", docx());
    const shared = over(mapPaths(memory, fold));
    await Promise.all([
      shared.writeFile("C:\\Docs\\report.docx!/word/document.xml", "<doc>one</doc>", LF),
      shared.writeFile("c:\\docs\\REPORT.docx!/word/styles.xml", "<styles>two</styles>", LF),
      shared.writeFile("C:/Docs/report.docx!/_rels/.rels", "<rels>three</rels>", LF),
    ]);
    const now = readZip(disk("c:\\docs\\report.docx"));
    expect(dec(now.bytes("word/document.xml"))).toBe("<doc>one</doc>");
    expect(dec(now.bytes("word/styles.xml"))).toBe("<styles>two</styles>");
    expect(dec(now.bytes("_rels/.rels"))).toBe("<rels>three</rels>");
  });

  /** A platform whose clock never moves (FAT's 2-second times, or a program restoring times). */
  function frozenClock(): Platform {
    return new Proxy(memory, {
      get(target, prop) {
        if (prop === "statFile") {
          return async (path: string) => ((await target.statFile(path)) ? { modifiedMs: 1000 } : null);
        }
        if (prop === "readBinaryFile") {
          return async (path: string) => ({ ...(await target.readBinaryFile(path)), modifiedMs: 1000 });
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  it("does not overwrite a container replaced during the save when its time did not change", async () => {
    const coarse = over(frozenClock());
    const real = memory.readBinaryFile.bind(memory);
    let interfere = true;
    vi.spyOn(memory, "readBinaryFile").mockImplementation(async (path) => {
      const result = await real(path);
      if (interfere) {
        interfere = false;
        memory.seedBinary(CONTAINER, docx({ "word/document.xml": "<other-program/>" }));
      }
      return result;
    });
    await expect(coarse.writeFile(part("word/styles.xml"), "<s>mine</s>", LF)).rejects.toThrow(
      /changed on disk/,
    );
    expect(dec(readZip(disk()).bytes("word/document.xml"))).toBe("<other-program/>");
    expect(dec(readZip(disk()).bytes("word/styles.xml"))).toBe(STYLES);
  });

  it("does not recreate a container deleted during the save", async () => {
    const real = memory.readBinaryFile.bind(memory);
    vi.spyOn(memory, "readBinaryFile").mockImplementationOnce(async (path) => {
      const result = await real(path);
      memory.binaryFiles.delete(CONTAINER);
      return result;
    });
    await expect(platform.writeFile(part("word/styles.xml"), "<s/>", LF)).rejects.toThrow(
      /changed on disk/,
    );
    expect(memory.binaryFiles.has(CONTAINER)).toBe(false);
  });

  it("a failed write leaves the file whole, and the next save starts from the file on disk", async () => {
    await platform.writeFile(part("word/styles.xml"), "<s>first</s>", LF); // takes the backup
    const saved = disk();
    memory.failNextBinaryWrite = new Error("disk full");
    await expect(platform.writeFile(part("word/document.xml"), "<d>lost</d>", LF)).rejects.toThrow(
      /disk full/,
    );
    expect(disk()).toEqual(saved);
    const { modifiedMs } = await platform.writeFile(part("word/document.xml"), "<d>kept</d>", LF);
    const now = readZip(disk());
    expect(dec(now.bytes("word/document.xml"))).toBe("<d>kept</d>");
    expect(dec(now.bytes("word/styles.xml"))).toBe("<s>first</s>");
    expect((await platform.statFile(part("word/document.xml")))?.modifiedMs).toBe(modifiedMs);
    // The backup is still the very first version.
    expect(dec(readZip(disk(`${CONTAINER}.bak`)).bytes("word/styles.xml"))).toBe(STYLES);
  });

  it("refuses text that cannot be encoded exactly, and writes nothing", async () => {
    const original = disk();
    await expect(platform.writeFile(part("word/styles.xml"), "<s>\uD800</s>", LF)).rejects.toThrow(
      /unpaired surrogate.*Nothing was saved/,
    );
    expect(disk()).toEqual(original);
  });
});
