import { describe, expect, it } from "vitest";
import {
  altTextFor,
  baseName,
  dirName,
  extensionForMime,
  imageFolderFor,
  isAbsolutePath,
  isImageMime,
  isImagePath,
  isInside,
  joinPath,
  linkPathFor,
  numberedName,
  parsePath,
  pastedImageName,
  placeWithoutCollision,
  planFileImport,
  relativePath,
  samePath,
  sanitiseFileName,
} from "./images";

describe("paths", () => {
  it("splits POSIX, drive, UNC and verbatim paths", () => {
    expect(parsePath("/a/b/c.md")).toMatchObject({ root: "/", segments: ["a", "b", "c.md"] });
    expect(parsePath("C:\\Work\\c.md")).toMatchObject({ root: "C:\\", segments: ["Work", "c.md"] });
    expect(parsePath("C:/Work//c.md")).toMatchObject({ root: "C:/", segments: ["Work", "c.md"] });
    expect(parsePath("\\\\srv\\share\\d\\c.md")).toMatchObject({
      root: "\\\\srv\\share\\",
      segments: ["d", "c.md"],
    });
    expect(parsePath("\\\\?\\C:\\d\\c.md")).toMatchObject({
      root: "\\\\?\\C:\\",
      segments: ["d", "c.md"],
    });
    expect(parsePath("\\\\?\\UNC\\srv\\share\\c.md").segments).toEqual(["c.md"]);
  });

  it("finds absolute paths", () => {
    expect(isAbsolutePath("/a")).toBe(true);
    expect(isAbsolutePath("C:\\a")).toBe(true);
    expect(isAbsolutePath("\\\\srv\\share\\a")).toBe(true);
    expect(isAbsolutePath("assets")).toBe(false);
    expect(isAbsolutePath("C:a")).toBe(false);
    expect(isAbsolutePath("./a")).toBe(false);
  });

  it("takes names and folders", () => {
    expect(baseName("C:\\Work\\notes\\a.md")).toBe("a.md");
    expect(dirName("C:\\Work\\notes\\a.md")).toBe("C:\\Work\\notes");
    expect(dirName("C:\\a.md")).toBe("C:\\");
    expect(dirName("/a.md")).toBe("/");
    expect(dirName("/x/y/a.md")).toBe("/x/y");
    expect(dirName("\\\\srv\\share\\d\\a.md")).toBe("\\\\srv\\share\\d");
    expect(dirName("C:/Work/a.md")).toBe("C:/Work");
  });

  it("joins in the folder's own style and resolves dots", () => {
    expect(joinPath("C:\\Work", "assets", "a.png")).toBe("C:\\Work\\assets\\a.png");
    expect(joinPath("C:\\Work\\", "assets/sub")).toBe("C:\\Work\\assets\\sub");
    expect(joinPath("/x/y", "..", "z")).toBe("/x/z");
    expect(joinPath("C:\\Work", "..", "..", "..", "x")).toBe("C:\\x");
    expect(joinPath("C:\\", "a.png")).toBe("C:\\a.png");
    expect(joinPath("\\\\srv\\share\\d", "a.png")).toBe("\\\\srv\\share\\d\\a.png");
  });

  it("compares paths the way Windows does", () => {
    expect(samePath("C:\\Work\\A.png", "c:/work/a.PNG")).toBe(true);
    expect(samePath("/x/A.png", "/x/a.png")).toBe(false);
    expect(samePath("C:\\a", "D:\\a")).toBe(false);
    expect(samePath("\\\\srv\\share\\a", "\\\\SRV\\SHARE\\a")).toBe(true);
  });

  it("knows what lies inside a folder", () => {
    expect(isInside("C:\\Work", "C:\\work\\img\\a.png")).toBe(true);
    expect(isInside("C:\\Work", "C:\\Work")).toBe(false);
    expect(isInside("C:\\Work", "C:\\Workshop\\a.png")).toBe(false);
    expect(isInside("C:\\Work", "D:\\Work\\a.png")).toBe(false);
    expect(isInside("/a/b", "/a/b/c/d.png")).toBe(true);
    expect(isInside("/a/b", "/a/c/d.png")).toBe(false);
    expect(isInside("\\\\srv\\share\\d", "\\\\srv\\share\\d\\x\\a.png")).toBe(true);
    expect(isInside("\\\\srv\\share\\d", "\\\\srv\\other\\d\\x\\a.png")).toBe(false);
  });
});

describe("relativePath", () => {
  it("goes down, across and up", () => {
    expect(relativePath("/a/b", "/a/b/assets/x.png")).toBe("./assets/x.png");
    expect(relativePath("/a/b", "/a/b/x.png")).toBe("./x.png");
    expect(relativePath("/a/b", "/a/c/x.png")).toBe("../c/x.png");
    expect(relativePath("/a/b/c", "/a/x.png")).toBe("../../x.png");
    expect(relativePath("/a/b", "/a/b")).toBe(".");
  });

  it("works on Windows drive paths with backslashes and mixed case", () => {
    expect(relativePath("C:\\Docs\\Notes", "C:\\Docs\\Notes\\assets\\a b.png")).toBe(
      "./assets/a b.png",
    );
    expect(relativePath("C:\\Docs\\Notes", "c:\\docs\\images\\a.png")).toBe("../images/a.png");
    expect(relativePath("C:/Docs/Notes", "C:\\Docs\\a.png")).toBe("../a.png");
  });

  it("works on UNC paths and gives up across drives or shares", () => {
    expect(relativePath("\\\\srv\\share\\d", "\\\\srv\\share\\d\\assets\\a.png")).toBe(
      "./assets/a.png",
    );
    expect(relativePath("\\\\srv\\share\\d", "\\\\srv\\share\\e\\a.png")).toBe("../e/a.png");
    expect(relativePath("\\\\srv\\share\\d", "\\\\srv\\other\\d\\a.png")).toBeNull();
    expect(relativePath("C:\\Docs", "D:\\Pictures\\a.png")).toBeNull();
  });

  it("links with an absolute POSIX path when no relative route exists", () => {
    expect(linkPathFor("C:\\Docs\\a.md", "D:\\Pictures\\a.png")).toBe("D:/Pictures/a.png");
    expect(linkPathFor("C:\\Docs\\a.md", "C:\\Docs\\assets\\a.png")).toBe("./assets/a.png");
    expect(linkPathFor("/d/a.md", "/d/x/y/a.png")).toBe("./x/y/a.png");
  });
});

describe("sanitiseFileName", () => {
  it("keeps good names", () => {
    expect(sanitiseFileName("photo 1.PNG")).toBe("photo 1.PNG");
  });

  it("replaces illegal characters", () => {
    expect(sanitiseFileName('a<b>c:d"e|f?g*h.png')).toBe("a-b-c-d-e-f-g-h.png");
    expect(sanitiseFileName("tab\there.png")).toBe("tab-here.png");
  });

  it("strips folders", () => {
    expect(sanitiseFileName("x\\y\\z.png")).toBe("z.png");
    expect(sanitiseFileName("x/y/z.png")).toBe("z.png");
  });

  it("prefixes reserved device names, with or without an extension", () => {
    expect(sanitiseFileName("CON.png")).toBe("_CON.png");
    expect(sanitiseFileName("nul")).toBe("_nul");
    expect(sanitiseFileName("com1.gif")).toBe("_com1.gif");
    expect(sanitiseFileName("LPT9.png")).toBe("_LPT9.png");
    expect(sanitiseFileName("console.png")).toBe("console.png");
  });

  it("removes trailing dots and spaces and leading spaces", () => {
    expect(sanitiseFileName("a. .")).toBe("a");
    expect(sanitiseFileName("  a.png")).toBe("a.png");
    expect(sanitiseFileName("a .png")).toBe("a.png");
  });

  it("never returns an empty name", () => {
    expect(sanitiseFileName("")).toBe("image");
    expect(sanitiseFileName("...")).toBe("image");
    expect(sanitiseFileName("   ")).toBe("image");
  });

  it("limits the length but keeps the extension", () => {
    const out = sanitiseFileName("x".repeat(300) + ".png");
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".png")).toBe(true);
    expect(sanitiseFileName("y".repeat(300)).length).toBe(100);
    expect(sanitiseFileName("a." + "e".repeat(40)).length).toBeLessThanOrEqual(100);
  });

  it("treats a leading dot as part of the name", () => {
    expect(sanitiseFileName(".png")).toBe(".png");
  });
});

describe("names", () => {
  it("names pasted bitmaps from local time", () => {
    expect(pastedImageName(new Date(2026, 0, 5, 9, 7, 3))).toBe("image-20260105-090703.png");
    expect(pastedImageName(new Date(2026, 11, 31, 23, 59, 59), "jpg")).toBe(
      "image-20261231-235959.jpg",
    );
  });

  it("numbers collisions", () => {
    expect(numberedName("a.png", 0)).toBe("a.png");
    expect(numberedName("a.png", 2)).toBe("a-2.png");
    expect(numberedName("a.b.png", 1)).toBe("a.b-1.png");
    expect(numberedName("noext", 3)).toBe("noext-3");
  });

  it("recognises images", () => {
    expect(isImagePath("C:\\x\\a.JPG")).toBe(true);
    expect(isImagePath("a.md")).toBe(false);
    expect(isImagePath("png")).toBe(false);
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("text/plain")).toBe(false);
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
    expect(extensionForMime("image/odd")).toBe("png");
  });

  it("makes alt text from the file name", () => {
    expect(altTextFor("My Photo.final.PNG")).toBe("My Photo.final");
    expect(altTextFor("noext")).toBe("noext");
  });
});

describe("imageFolderFor", () => {
  it("puts images in `assets` beside the document by default", () => {
    expect(imageFolderFor("C:\\Docs\\doc.md", "assets")).toBe("C:\\Docs\\assets");
    expect(imageFolderFor("/d/doc.md", "assets")).toBe("/d/assets");
  });

  it("supports the same folder", () => {
    expect(imageFolderFor("C:\\Docs\\doc.md", ".")).toBe("C:\\Docs");
    expect(imageFolderFor("C:\\Docs\\doc.md", "")).toBe("C:\\Docs");
    expect(imageFolderFor("/doc.md", ".")).toBe("/");
  });

  it("expands ${documentName}", () => {
    expect(imageFolderFor("C:\\Docs\\My Notes.md", "${documentName}.assets")).toBe(
      "C:\\Docs\\My Notes.assets",
    );
    expect(imageFolderFor("/d/a.b.md", "img/${documentName}")).toBe("/d/img/a.b");
  });

  it("supports parent and absolute folders", () => {
    expect(imageFolderFor("C:\\Docs\\n\\doc.md", "../shared")).toBe("C:\\Docs\\shared");
    expect(imageFolderFor("C:\\Docs\\doc.md", "D:\\Pics")).toBe("D:\\Pics");
    expect(imageFolderFor("/d/doc.md", "/pics/x")).toBe("/pics/x");
  });

  it("works on UNC documents", () => {
    expect(imageFolderFor("\\\\srv\\share\\d\\doc.md", "assets")).toBe("\\\\srv\\share\\d\\assets");
  });
});

describe("planFileImport", () => {
  it("links a file inside the document's tree in place", () => {
    expect(planFileImport("C:\\Docs\\a.md", "C:\\Docs\\img\\p.png", "assets")).toEqual({
      kind: "in-place",
      path: "C:\\Docs\\img\\p.png",
    });
    expect(planFileImport("C:\\Docs\\a.md", "c:\\docs\\p.png", "assets").kind).toBe("in-place");
  });

  it("imports other files, sanitising the name", () => {
    expect(planFileImport("C:\\Docs\\a.md", "D:\\Pics\\CON.png", "assets")).toEqual({
      kind: "import",
      folder: "C:\\Docs\\assets",
      name: "_CON.png",
    });
    expect(planFileImport("/d/a.md", "/other/x y.png", "${documentName}.assets")).toEqual({
      kind: "import",
      folder: "/d/a.assets",
      name: "x y.png",
    });
  });

  it("imports a sibling folder's file (outside the tree)", () => {
    expect(planFileImport("/d/n/a.md", "/d/p.png", "assets").kind).toBe("import");
  });
});

describe("placeWithoutCollision", () => {
  const taken = (names: string[]) => async (path: string) =>
    names.includes(path) ? ("exists" as const) : ("placed" as const);

  it("uses the name when free", async () => {
    expect(await placeWithoutCollision("/d/assets", "a.png", taken([]))).toEqual({
      path: "/d/assets/a.png",
      created: true,
    });
  });

  it("numbers past taken names", async () => {
    const result = await placeWithoutCollision(
      "/d/assets",
      "a.png",
      taken(["/d/assets/a.png", "/d/assets/a-1.png"]),
    );
    expect(result).toEqual({ path: "/d/assets/a-2.png", created: true });
  });

  it("reuses the file when the source is already there, even if spelt differently", async () => {
    let attempts = 0;
    const result = await placeWithoutCollision(
      "C:\\Docs\\assets",
      "a.png",
      async () => {
        attempts++;
        return "exists";
      },
      "c:/docs/ASSETS/a.png",
    );
    expect(result).toEqual({ path: "C:\\Docs\\assets\\a.png", created: false });
    expect(attempts).toBe(0);
  });

  it("does not reuse a different file with the same name", async () => {
    const result = await placeWithoutCollision(
      "/d/assets",
      "a.png",
      taken(["/d/assets/a.png"]),
      "/elsewhere/a.png",
    );
    expect(result.path).toBe("/d/assets/a-1.png");
  });

  it("gives up eventually and passes failures on", async () => {
    await expect(
      placeWithoutCollision("/d", "a.png", taken(["/d/a.png"]), undefined, 1),
    ).rejects.toThrow(/free name/);
    await expect(
      placeWithoutCollision("/d", "a.png", async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
  });
});
