/**
 * Helpers for the export tests: run the converter, open the result the way the app's own DOCX
 * support does, and look inside.
 */
import { unzipSync } from "fflate";
import type { ExportContext } from "../../../core/format";
import { decodeDocx } from "../../docx/decode";
import { descendants, parseXml, type XElement } from "../../docx/xml";
import { markdownToDocx } from "./index";

export function contextWith(
  assets: Record<string, Uint8Array> = {},
  overrides: Partial<ExportContext> = {},
): ExportContext {
  return {
    path: "/docs/report.md",
    title: "report",
    resolveAsset: () => "",
    readAsset: async (reference) => assets[reference] ?? null,
    ...overrides,
  };
}

export async function exportMarkdown(
  markdown: string,
  assets: Record<string, Uint8Array> = {},
  overrides: Partial<ExportContext> = {},
): Promise<Uint8Array> {
  return markdownToDocx(markdown, contextWith(assets, overrides));
}

/** Every part of the package as text (pictures as Latin-1, which is enough to compare bytes). */
export function partsOf(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    out[name] = /\.(xml|rels)$/.test(name)
      ? new TextDecoder().decode(data)
      : Array.from(data, (b) => String.fromCharCode(b)).join("");
  }
  return out;
}

export function xmlRoot(text: string | undefined): XElement {
  const root = parseXml(text ?? "").root;
  if (!root) throw new Error("no root element");
  return root;
}

/** The body of the Formatting view: between the section line and the first appendix. */
export async function viewBody(bytes: Uint8Array): Promise<string> {
  const { text } = await decodeDocx(bytes, { path: "/docs/report.docx" });
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("<!-- section "));
  let end = lines.findIndex((l, i) => i > start && l.startsWith("<!-- ===="));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

export async function fullView(bytes: Uint8Array): Promise<string> {
  return (await decodeDocx(bytes, { path: "/docs/report.docx" })).text;
}

/** Body paragraphs of document.xml (not those in table cells). */
export function bodyParagraphs(bytes: Uint8Array): XElement[] {
  const body = descendants(xmlRoot(partsOf(bytes)["word/document.xml"]), "w:body")[0]!;
  return body.children.filter((c): c is XElement => typeof c !== "string" && c.name === "w:p");
}

/** The text of a paragraph or run as Word would show it: tabs and breaks as characters. */
export function wordText(el: XElement): string {
  let out = "";
  for (const r of el.name === "w:r" ? [el] : descendants(el, "w:r")) {
    for (const c of r.children) {
      if (typeof c === "string") continue;
      if (c.name === "w:t") out += c.children.filter((x) => typeof x === "string").join("");
      else if (c.name === "w:tab") out += "\t";
      else if (c.name === "w:br") out += "\n";
    }
  }
  return out;
}

export function styleOf(p: XElement): string | undefined {
  return descendants(p, "w:pStyle")[0]?.attrs["w:val"];
}
