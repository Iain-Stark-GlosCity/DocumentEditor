import { describe, expect, it } from "vitest";
import {
  containerTitle,
  isContainerPartPath,
  joinContainerPath,
  splitContainerPath,
} from "./container-path";

describe("container paths", () => {
  it("joins and splits a Windows container path", () => {
    const path = joinContainerPath("C:\\docs\\report.docx", "word/document.xml");
    expect(path).toBe("C:\\docs\\report.docx!/word/document.xml");
    expect(splitContainerPath(path)).toEqual({
      container: "C:\\docs\\report.docx",
      part: "word/document.xml",
    });
  });

  it("works for POSIX paths and ignores a leading slash on the part", () => {
    const path = joinContainerPath("/home/a/report.docx", "/word/styles.xml");
    expect(path).toBe("/home/a/report.docx!/word/styles.xml");
    expect(splitContainerPath(path)?.part).toBe("word/styles.xml");
  });

  it("keeps a part name that has dots, and a dot-first name", () => {
    expect(splitContainerPath("a.docx!/_rels/.rels")?.part).toBe("_rels/.rels");
    expect(splitContainerPath("a.docx!/word/_rels/document.xml.rels")?.part).toBe(
      "word/_rels/document.xml.rels",
    );
  });

  it("returns null for an ordinary path, a bare separator, a folder or an empty part", () => {
    expect(splitContainerPath("C:\\docs\\report.docx")).toBeNull();
    expect(splitContainerPath("!/word/document.xml")).toBeNull();
    expect(splitContainerPath("a.docx!/")).toBeNull();
    expect(splitContainerPath("a.docx!/word/")).toBeNull();
    expect(isContainerPartPath("a.docx")).toBe(false);
    expect(isContainerPartPath("a.docx!/x.xml")).toBe(true);
  });

  it("titles a part with its container so different containers cannot be confused", () => {
    expect(containerTitle("C:\\docs\\report.docx!/word/document.xml")).toBe(
      "report.docx \u203a document.xml",
    );
    expect(containerTitle("C:\\docs\\notes.md")).toBe("notes.md");
  });
});
