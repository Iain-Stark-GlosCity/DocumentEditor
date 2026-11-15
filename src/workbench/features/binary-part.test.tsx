import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCX, setupContainers, type Setup } from "../container-test-helpers";
import {
  MAX_PREVIEW_BYTES,
  MAX_REPLACEMENT_BYTES,
  describeKind,
  describeSize,
  extensionOf,
  showBinaryPart,
  sniffPicture,
} from "./binary-part";

const MEDIA = `${DOCX}!/word/media`;
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const TTF = Uint8Array.from([0, 1, 0, 0, 9, 9, 9, 9]);

const dialog = () => screen.getByRole("dialog");
const messages = (s: Setup) => s.workbench.ui.getState().notifications.map((n) => n.message);

async function open(s: Setup, part: string) {
  let shown = false;
  await act(async () => {
    shown = await showBinaryPart(s.workbench, DOCX, part);
  });
  return shown;
}

async function setup(parts: Record<string, Uint8Array> = { "image1.png": PNG }) {
  const s = await setupContainers();
  for (const [name, bytes] of Object.entries(parts))
    s.platform.seedBinary(`${MEDIA}/${name}`, bytes);
  return s;
}

/** A font API that the test controls: jsdom has none. */
function stubFonts() {
  const added = new Set<unknown>();
  const faces: { family: string; load: ReturnType<typeof vi.fn> }[] = [];
  let loadResult: Promise<void> = Promise.resolve();
  class FakeFontFace {
    family: string;
    load = vi.fn(() => loadResult);
    constructor(family: string) {
      this.family = family;
      faces.push(this);
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: (f: unknown) => added.add(f), delete: (f: unknown) => added.delete(f) },
  });
  return {
    added,
    faces,
    loadWith(promise: Promise<void>) {
      loadResult = promise;
    },
  };
}

afterEach(() => {
  // The viewer is shared state: close any dialog a test left open.
  const close = screen.queryByRole("button", { name: "Close" });
  if (close) fireEvent.click(close);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
  vi.restoreAllMocks();
});

describe("describing parts", () => {
  it("names the kind and size", () => {
    expect(extensionOf("a.PNG")).toBe("png");
    expect(extensionOf("noext")).toBe("");
    expect(describeSize(10)).toBe("10 bytes");
    expect(describeSize(2048)).toBe("2.0 KB");
    expect(describeSize(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(describeKind("a.png")).toBe("PNG picture");
    expect(describeKind("a.odttf")).toBe("Font");
    expect(describeKind("a.emf")).toBe("Windows metafile picture");
    expect(describeKind("a.bin")).toBe("Embedded object or binary data");
    expect(describeKind("a.xyz")).toBe("XYZ data");
    expect(describeKind("a")).toBe("Binary data");
  });
});

describe("the binary part dialog", () => {
  it("opens a labelled modal dialog with the picture, its kind, size and part name", async () => {
    const s = await setup();
    expect(await open(s, "word/media/image1.png")).toBe(true);
    const d = dialog();
    expect(d.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(d.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("image1.png");
    expect(d.textContent).toContain(`PNG picture, ${describeSize(PNG.length)}`);
    expect(d.textContent).toContain("word/media/image1.png");
    const img = screen.getByRole("img", { name: "Preview of image1.png" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });

  it("encodes the picture in full whatever its size", async () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    const s = await setup({ "big.png": big });
    await open(s, "word/media/big.png");
    const src = screen.getByRole("img").getAttribute("src") ?? "";
    const decoded = Uint8Array.from(atob(src.slice(src.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(big);
  });

  it("shows the picture's size in pixels once it has loaded, and not the next picture's", async () => {
    const s = await setup({ "image1.png": PNG, "image2.png": PNG });
    await open(s, "word/media/image1.png");
    const img = screen.getByRole("img");
    Object.defineProperty(img, "naturalWidth", { value: 40 });
    Object.defineProperty(img, "naturalHeight", { value: 30 });
    fireEvent.load(img);
    expect(dialog().textContent).toContain("40 × 30 pixels");
    await open(s, "word/media/image2.png");
    expect(dialog().textContent).not.toContain("pixels");
  });

  it("says so when a picture cannot be decoded", async () => {
    const s = await setup();
    await open(s, "word/media/image1.png");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(dialog().textContent).toContain("This picture could not be shown.");
  });

  it("does not preview a picture over the limit, and says why", async () => {
    const s = await setup({ "huge.png": new Uint8Array(MAX_PREVIEW_BYTES + 1) });
    await open(s, "word/media/huge.png");
    expect(screen.queryByRole("img")).toBeNull();
    expect(dialog().textContent).toContain("This picture is too large to preview here.");
    expect(dialog().textContent).toContain("save a copy");
  });

  it("says a part that is not a picture cannot be shown", async () => {
    const s = await setup({ "object1.bin": new Uint8Array([1, 2]) });
    await open(s, "word/media/object1.bin");
    expect(dialog().textContent).toContain("cannot be shown as text or as a picture");
  });

  it("notifies, and shows no dialog, when the part cannot be read", async () => {
    const s = await setup();
    expect(await open(s, "word/media/missing.png")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(messages(s).join("\n")).toMatch(/Could not read missing\.png: File not found/);
  });

  it("shows the newest request when an earlier read finishes late", async () => {
    const s = await setup({ "a.png": PNG, "b.png": PNG });
    const real = s.platform.readBinaryFile.bind(s.platform);
    let releaseFirst: () => void = () => undefined;
    const slow = new Promise<void>((r) => (releaseFirst = r));
    vi.spyOn(s.platform, "readBinaryFile").mockImplementation(async (path) => {
      if (path.endsWith("a.png")) await slow;
      return real(path);
    });
    let first: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      first = showBinaryPart(s.workbench, DOCX, "word/media/a.png");
      await showBinaryPart(s.workbench, DOCX, "word/media/b.png");
    });
    expect(screen.getByRole("heading", { name: "b.png" })).toBeTruthy();
    await act(async () => {
      releaseFirst();
      await first;
    });
    expect(screen.getByRole("heading", { name: "b.png" })).toBeTruthy();
  });

  describe("keyboard and focus", () => {
    it("moves focus in, traps Tab, closes on Escape and gives focus back", async () => {
      const s = await setup();
      const opener = document.createElement("button");
      opener.textContent = "Opener";
      document.body.append(opener);
      opener.focus();
      await open(s, "word/media/image1.png");
      const save = screen.getByRole("button", { name: "Save a copy…" });
      const close = screen.getByRole("button", { name: "Close" });
      expect(document.activeElement).toBe(save);

      close.focus();
      fireEvent.keyDown(close, { key: "Tab" });
      expect(document.activeElement).toBe(save);
      fireEvent.keyDown(save, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(close);

      // After a click on the text, focus is on the dialog itself: Tab must stay inside.
      dialog().focus();
      fireEvent.keyDown(dialog(), { key: "Tab" });
      expect(document.activeElement).toBe(save);
      dialog().focus();
      fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(close);

      fireEvent.keyDown(close, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    it("gives focus back to the original opener after moving between two parts", async () => {
      const s = await setup({ "a.png": PNG, "b.png": PNG });
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      await open(s, "word/media/a.png");
      await open(s, "word/media/b.png");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    it("does not let Escape reach shortcuts behind it", async () => {
      const s = await setup();
      await open(s, "word/media/image1.png");
      const outside = vi.fn();
      window.addEventListener("keydown", outside);
      fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Escape" });
      window.removeEventListener("keydown", outside);
      expect(outside).not.toHaveBeenCalled();
    });
  });

  describe("Save a copy", () => {
    it("writes the part's bytes where the person chooses, offering its own name", async () => {
      const s = await setup();
      const dialogSpy = vi.spyOn(s.platform, "showSaveDialog");
      s.platform.queueSaveDialog("C:\\out\\copy.png");
      await open(s, "word/media/image1.png");
      fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));
      await waitFor(() => expect(s.platform.binaryFiles.has("C:\\out\\copy.png")).toBe(true));
      expect(Array.from(s.platform.binaryFiles.get("C:\\out\\copy.png") ?? [])).toEqual(
        Array.from(PNG),
      );
      expect(messages(s)).toContain("Saved a copy of image1.png.");
      expect(dialogSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("writes nothing when the save dialog is cancelled", async () => {
      const s = await setup();
      s.platform.queueSaveDialog(null);
      await open(s, "word/media/image1.png");
      const before = s.platform.binaryFiles.size;
      fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));
      await act(async () => undefined);
      expect(s.platform.binaryFiles.size).toBe(before);
      expect(messages(s).join("\n")).not.toContain("Saved a copy");
    });

    it("notifies when the write fails", async () => {
      const s = await setup();
      s.platform.queueSaveDialog("C:\\out\\copy.png");
      s.platform.failNextBinaryWrite = new Error("disk full");
      await open(s, "word/media/image1.png");
      fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));
      await waitFor(() =>
        expect(messages(s).join("\n")).toContain("Could not save image1.png: disk full"),
      );
    });

    it("notifies when the save dialog itself fails", async () => {
      const s = await setup();
      vi.spyOn(s.platform, "showSaveDialog").mockRejectedValue(new Error("no dialog"));
      await open(s, "word/media/image1.png");
      fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));
      await waitFor(() =>
        expect(messages(s).join("\n")).toContain("Could not save image1.png: no dialog"),
      );
    });
  });

  describe("fonts", () => {
    it("says a font cannot be previewed when the browser has no font API or the bytes are not a font", async () => {
      const s = await setup({ "f.ttf": TTF, "g.ttf": new Uint8Array([1, 2, 3, 4, 5]) });
      await open(s, "word/media/f.ttf");
      await waitFor(() =>
        expect(dialog().textContent).toContain(
          "This font could not be read, so it cannot be previewed.",
        ),
      );
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("shows a sample in the loaded font, labelled for screen readers, and removes it on close", async () => {
      const fonts = stubFonts();
      const s = await setup({ "f.ttf": TTF });
      await open(s, "word/media/f.ttf");
      const sample = await screen.findByRole("img", { name: "Sample text in f.ttf" });
      expect(sample.getAttribute("style")).toMatch(/part-preview-\d+/);
      expect(fonts.added.size).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(fonts.added.size).toBe(0);
    });

    it("does not keep a font that finishes loading after the dialog was closed", async () => {
      const fonts = stubFonts();
      let finish: () => void = () => undefined;
      fonts.loadWith(new Promise<void>((r) => (finish = r)));
      const s = await setup({ "f.ttf": TTF });
      await open(s, "word/media/f.ttf");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await act(async () => {
        finish();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(fonts.faces).toHaveLength(1);
      expect(fonts.added.size).toBe(0);
    });

    it("does not show an earlier opening's font when the same part is opened again", async () => {
      const fonts = stubFonts();
      const s = await setup({ "f.ttf": TTF });
      await open(s, "word/media/f.ttf");
      await screen.findByRole("img", { name: "Sample text in f.ttf" });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      let finish: () => void = () => undefined;
      fonts.loadWith(new Promise<void>((r) => (finish = r)));
      await open(s, "word/media/f.ttf");
      // The second load is still running: the released family must not be shown.
      expect(screen.queryByRole("img", { name: "Sample text in f.ttf" })).toBeNull();
      await act(async () => {
        finish();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(await screen.findByRole("img", { name: "Sample text in f.ttf" })).toBeTruthy();
      expect(fonts.added.size).toBe(1);
    });
  });
});

describe("sniffPicture", () => {
  const ascii = (t: string) => Uint8Array.from([...t].map((c) => c.charCodeAt(0)));
  /** A BMP file header followed by a DIB header of the given size. */
  const bmp = (dibSize: number) => {
    const b = new Uint8Array(54);
    b.set(ascii("BM"));
    new DataView(b.buffer).setUint32(14, dibSize, true);
    return b;
  };
  it("names the supported picture types by their first bytes only", () => {
    expect(sniffPicture(PNG)).toBe("png");
    expect(sniffPicture(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("jpeg");
    expect(sniffPicture(ascii("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000"))).toBe("gif");
    expect(sniffPicture(ascii("GIF87a\u0001\u0000\u0001\u0000\u0000\u0000\u0000"))).toBe("gif");
    expect(sniffPicture(bmp(40))).toBe("bmp");
    expect(sniffPicture(bmp(124))).toBe("bmp");
    expect(sniffPicture(ascii("RIFF....WEBPVP8 "))).toBe("webp");
    expect(sniffPicture(ascii("RIFF....WEBPVP8L"))).toBe("webp");
    expect(sniffPicture(ascii("<svg xmlns='x'/>"))).toBeNull();
    expect(sniffPicture(new Uint8Array(3))).toBeNull();
    expect(sniffPicture(TTF)).toBeNull();
  });

  it("is strict about the signature and refuses truncated headers", () => {
    // PNG: all eight signature bytes, then the IHDR chunk that must come first.
    expect(sniffPicture(PNG.slice(0, 8))).toBeNull();
    expect(sniffPicture(PNG.slice(0, 32))).toBeNull();
    const badSignature = PNG.slice();
    badSignature[4] = 0x0a; // \r\n turned into \n\n: a PNG damaged by a text transfer
    expect(sniffPicture(badSignature)).toBeNull();
    // GIF: only the two real versions, with a full logical screen descriptor.
    expect(sniffPicture(ascii("GIF8xa..........."))).toBeNull();
    expect(sniffPicture(ascii("GIF89a"))).toBeNull();
    // BMP: any text starting "BM" is not a bitmap; the DIB header size must be a real one.
    expect(sniffPicture(ascii("BM" + "x".repeat(60)))).toBeNull();
    expect(sniffPicture(bmp(40).slice(0, 20))).toBeNull();
    // WEBP: a RIFF file of another kind, or one without a VP8 chunk, is not a WEBP picture.
    expect(sniffPicture(ascii("RIFF....WAVEfmt "))).toBeNull();
    expect(sniffPicture(ascii("RIFF....WEBPJUNK"))).toBeNull();
    expect(sniffPicture(ascii("RIFF....WEBP"))).toBeNull();
    // JPEG: the three-byte start alone is not a picture.
    expect(sniffPicture(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("Replace picture…", () => {
  const PICKED = "C:\\pics\\new.png";
  /** Another valid PNG: the same picture with a different last byte. */
  const OTHER = Uint8Array.from(PNG, (b, i) => (i === PNG.length - 1 ? b ^ 0xff : b));
  const partBytes = (s: Setup, name = "image1.png") =>
    Array.from(s.platform.binaryFiles.get(`${MEDIA}/${name}`) ?? []);
  const confirm = () => screen.findByRole("alertdialog", { name: "Replace image1.png?" });

  async function startReplace(s: Setup, picked: Uint8Array) {
    s.platform.seedBinary(PICKED, picked);
    s.platform.queueOpenDialog([PICKED]);
    await open(s, "word/media/image1.png");
    const button = screen.getByRole("button", { name: "Replace picture…" });
    button.focus();
    fireEvent.click(button);
    return button;
  }

  it("asks first with Cancel focused, then replaces, keeps focus, and refreshes the Parts pane", async () => {
    const s = await setup();
    const listedBefore = s.containers.listed.length;
    await startReplace(s, OTHER);
    const ask = await confirm();
    expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Cancel" }));
    expect(ask.textContent).toContain("This cannot be undone in the editor.");
    fireEvent.click(within(ask).getByRole("button", { name: "Replace picture" }));
    await waitFor(() => expect(partBytes(s)).toEqual(Array.from(OTHER)));
    await waitFor(() => expect(messages(s).join("\n")).toContain("Replaced image1.png."));
    // The viewer shows the new picture, and focus stays where the person left it.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Replace picture…" })),
    );
    // The Parts pane shows sizes, so it must list the parts again.
    await waitFor(() => expect(s.containers.listed.length).toBeGreaterThan(listedBefore));
  });

  it("writes nothing when cancelled and gives focus back to the button", async () => {
    const s = await setup();
    const button = await startReplace(s, OTHER);
    const ask = await confirm();
    fireEvent.keyDown(within(ask).getByRole("button", { name: "Cancel" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(partBytes(s)).toEqual(Array.from(PNG));
    expect(document.activeElement).toBe(button);
  });

  it("does not rewrite the file for the very same picture", async () => {
    const s = await setup();
    const write = vi.spyOn(s.platform, "writeBinaryFile");
    await startReplace(s, PNG.slice());
    await waitFor(() =>
      expect(messages(s).join("\n")).toContain(
        "That is the same picture as image1.png. Nothing was changed.",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a picture over the limit before asking, and says nothing was changed", async () => {
    const s = await setup();
    const huge = new Uint8Array(MAX_REPLACEMENT_BYTES + 1);
    huge.set(PNG);
    const write = vi.spyOn(s.platform, "writeBinaryFile");
    await startReplace(s, huge);
    await waitFor(() =>
      expect(messages(s).join("\n")).toContain(
        "That picture is too large (the limit is 50 MB). Nothing was changed.",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a picture of another type, naming both", async () => {
    const s = await setup();
    await startReplace(s, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]));
    await waitFor(() =>
      expect(messages(s).join("\n")).toContain(
        "That is a JPEG picture, but image1.png is a PNG. Convert it to PNG first; nothing was changed.",
      ),
    );
    expect(partBytes(s)).toEqual(Array.from(PNG));
  });

  it("says so, and changes nothing, when the save path refuses", async () => {
    const s = await setup();
    await startReplace(s, OTHER);
    const ask = await confirm();
    vi.spyOn(s.platform, "writeBinaryFile").mockRejectedValue(
      new Error(
        "report.docx changed on disk while saving word/media/image1.png. Nothing was saved.",
      ),
    );
    fireEvent.click(within(ask).getByRole("button", { name: "Replace picture" }));
    await waitFor(() =>
      expect(messages(s).join("\n")).toContain(
        "Could not replace image1.png: report.docx changed on disk while saving word/media/image1.png. Nothing was saved.",
      ),
    );
    expect(partBytes(s)).toEqual(Array.from(PNG));
  });

  it("is not offered for metafiles or SVG", async () => {
    const s = await setup({ "a.emf": Uint8Array.from([1, 0, 0, 0]), "b.svg": PNG });
    await open(s, "word/media/a.emf");
    expect(screen.queryByRole("button", { name: "Replace picture…" })).toBeNull();
    await open(s, "word/media/b.svg");
    expect(screen.queryByRole("button", { name: "Replace picture…" })).toBeNull();
  });
});
