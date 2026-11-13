import { describe, expect, it } from "vitest";
import type { FileData } from "../platform/platform";
import { createDocumentsStore } from "./documents";

const data = (text: string): FileData => ({
  text,
  format: { encoding: "utf-16le", bom: true, eol: "lf", mixedEol: false },
  modifiedMs: 100,
});

describe("documents store", () => {
  it("opens untitled documents with numbered titles and the default format", () => {
    const store = createDocumentsStore();
    const a = store.getState().openUntitled("markdown");
    const b = store.getState().openUntitled("markdown");
    const { documents, activeId } = store.getState();
    expect(documents.map((d) => d.title)).toEqual(["Untitled-1", "Untitled-2"]);
    expect(documents[0]?.path).toBeNull();
    expect(documents[0]?.format).toEqual({ encoding: "utf-8", bom: false, eol: "crlf", mixedEol: false });
    expect(activeId).toBe(b);
    expect(a).not.toBe(b);
  });

  it("opens a file keeping its format, and activates an already open path", () => {
    const store = createDocumentsStore();
    const id = store.getState().openFromFile("C:\\notes\\a.md", data("hello"), "markdown");
    const doc = store.getState().documents[0];
    expect(doc).toMatchObject({ id, title: "a.md", savedText: "hello", modifiedMs: 100, providerId: "markdown" });
    expect(doc?.format.encoding).toBe("utf-16le");

    store.getState().openUntitled("markdown");
    const again = store.getState().openFromFile("c:\\NOTES\\A.md", data("other"), "markdown");
    expect(again).toBe(id);
    expect(store.getState().documents).toHaveLength(2);
    expect(store.getState().activeId).toBe(id);
  });

  it("markSaved updates path, text, time and title", () => {
    const store = createDocumentsStore();
    const id = store.getState().openUntitled("markdown");
    store.getState().markSaved(id, "/x/notes.md", "saved", 555);
    expect(store.getState().documents[0]).toMatchObject({
      path: "/x/notes.md",
      savedText: "saved",
      modifiedMs: 555,
      title: "notes.md",
    });
  });

  it("close picks a neighbour as active, or null when empty", () => {
    const store = createDocumentsStore();
    const a = store.getState().openUntitled("markdown");
    const b = store.getState().openUntitled("markdown");
    const c = store.getState().openUntitled("markdown");
    store.getState().setActive(b);
    store.getState().close(b);
    expect(store.getState().activeId).toBe(c);
    store.getState().close(c);
    expect(store.getState().activeId).toBe(a);
    store.getState().close(a);
    expect(store.getState().activeId).toBeNull();
    expect(store.getState().documents).toEqual([]);
  });

  it("closing an inactive document keeps the active one; setActive ignores unknown ids", () => {
    const store = createDocumentsStore();
    const a = store.getState().openUntitled("markdown");
    const b = store.getState().openUntitled("markdown");
    store.getState().close(a);
    expect(store.getState().activeId).toBe(b);
    store.getState().setActive("nope");
    expect(store.getState().activeId).toBe(b);
  });
});
