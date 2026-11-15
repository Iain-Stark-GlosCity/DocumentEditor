import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { buildAnnotations } from "./annotations";
import { decodePart } from "./decode";
import type { DecodedView } from "../../core/format";
import { docxProvider } from "./index";

// The real zip reader is another piece of work; a Map stands in for an archive. The fake's
// "archive" bytes are the JSON of a name -> text map.
vi.mock("../../core/archive", () => {
  class ArchiveError extends Error {}
  return {
    ArchiveError,
    readZip(bytes: Uint8Array) {
      let files: Map<string, Uint8Array>;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<
          string,
          string | number[]
        >;
        files = new Map(
          Object.entries(parsed).map(([k, v]) => [
            k,
            typeof v === "string" ? new TextEncoder().encode(v) : Uint8Array.from(v),
          ]),
        );
      } catch {
        throw new ArchiveError("not a zip");
      }
      const info = (name: string) => {
        const data = files.get(name);
        return data
          ? { name, size: data.length, compressedSize: data.length, crc32: 0, isDirectory: false }
          : undefined;
      };
      return {
        entries: [...files.keys()].map((n) => info(n)!),
        has: (name: string) => files.has(name),
        info,
        bytes(name: string) {
          const data = files.get(name);
          if (!data) throw new ArchiveError(`no ${name}`);
          return data;
        },
        replace: () => {
          throw new Error("unused");
        },
      };
    },
  };
});

const zip = (files: Record<string, string | number[]>) =>
  new TextEncoder().encode(JSON.stringify(files));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe("docxProvider", () => {
  it("declares a read-only binary zip format for Word files", () => {
    expect(docxProvider.id).toBe("docx");
    expect(docxProvider.name).toBe("Word document");
    expect(docxProvider.fileExtensions).toEqual(["docx", "docm", "dotx", "dotm"]);
    expect(docxProvider.viewModes).toEqual(["source"]);
    expect(docxProvider.readOnly).toBe(true);
    expect(docxProvider.spellcheck).toBe(false);
    expect(docxProvider.binary?.archive).toBe("zip");
  });

  it("decodes a document into the Formatting view", async () => {
    const bytes = zip({
      "word/document.xml": `<w:document ${W}><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
    });
    const { text } = (await docxProvider.binary!.decode(bytes, {
      path: "C:\\a.docx",
    })) as DecodedView;
    expect(text).toContain("\n**Hello**\n");
  });

  it("reads parts written in UTF-16 or with a BOM", async () => {
    const utf16 = [
      0xff,
      0xfe,
      ...[
        ...`<w:document ${W}><w:body><w:p><w:r><w:t>Wide é</w:t></w:r></w:p></w:body></w:document>`,
      ].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]),
    ];
    const { text } = (await docxProvider.binary!.decode(zip({ "word/document.xml": utf16 }), {
      path: "a.docx",
    })) as DecodedView;
    expect(text).toContain("\nWide é\n");
    expect(decodePart(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(decodePart(Uint8Array.from([0xfe, 0xff, 0, 0x41]))).toBe("A");
  });

  it("refuses a file that is not a Word document, and passes on zip errors", async () => {
    await expect(
      docxProvider.binary!.decode(zip({ "xl/workbook.xml": "<x/>" }), { path: "a.docx" }),
    ).rejects.toThrow("This file does not look like a Word document: it has no word/document.xml");
    await expect(
      docxProvider.binary!.decode(Uint8Array.from([1, 2, 3]), { path: "a.docx" }),
    ).rejects.toThrow("not a zip");
  });

  it("highlights as Markdown and marks the notation as annotations", () => {
    const doc = [
      "<!-- ==== Styles ==== -->",
      '<!-- style "Normal" id=Normal -->',
      '# Title <!-- p style="Heading 1" -->',
      'Some <span colour="C00000">red</span><tab/>text \\<span> <!-- raw path="/x" <w:x/> -->',
    ].join("\n");
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: docxProvider.editorExtensions({
          mode: "source",
          path: null,
          setting: (_k, f) => f,
        }),
      }),
    });
    const classes: string[] = [];
    buildAnnotations(view).between(0, doc.length, (from, to, deco) => {
      const spec = deco.spec as { class?: string };
      classes.push(`${spec.class}:${doc.slice(from, to === from ? doc.indexOf("\n", from) : to)}`);
    });
    expect(classes).toEqual([
      "cm-docx-banner:<!-- ==== Styles ==== -->",
      'cm-docx-meta:<!-- style "Normal" id=Normal -->',
      'cm-docx-pcomment:<!-- p style="Heading 1" -->',
      'cm-docx-tag:<span colour="C00000">',
      "cm-docx-tag:</span>",
      "cm-docx-token:<tab/>",
      'cm-docx-raw:<!-- raw path="/x" <w:x/> -->',
    ]);
    view.destroy();
    parent.remove();
  });
});
