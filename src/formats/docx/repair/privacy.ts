/**
 * Repairs that remove personal details from a document before it is shared.
 */
import { child, descendants, textOf, type XElement } from "../xml";
import type { RepairContext, RepairDef } from "./types";

/**
 * The document properties that name people or organisations: where the text of each is, by part.
 * (`dc:creator` and `cp:lastModifiedBy` in core.xml; `Company` and `Manager` in app.xml.)
 */
const PROPERTY_FIELDS: { part: string; names: string[]; label: string }[] = [
  {
    part: "docProps/core.xml",
    names: ["dc:creator", "cp:lastModifiedBy"],
    label: "core properties",
  },
  { part: "docProps/app.xml", names: ["ep:Company", "ep:Manager"], label: "extended properties" },
];

/** The property elements that hold text, in a part. */
function filled(ctx: RepairContext, part: string, names: string[]): XElement[] {
  const editor = ctx.editor(part);
  const root = editor?.doc.root;
  if (!editor || !root) return [];
  const out: XElement[] = [];
  for (const name of names) {
    for (const el of [child(root, name), ...descendants(root, name)]) {
      if (el && el.parent && textOf(el).trim() !== "" && !out.includes(el)) out.push(el);
    }
  }
  return out;
}

export const scrubProperties: RepairDef = {
  id: "docx.scrub-properties",
  title: "Remove names from the document properties",
  offer(ctx) {
    let count = 0;
    for (const f of PROPERTY_FIELDS) count += filled(ctx, f.part, f.names).length;
    return count === 0
      ? null
      : `${count} ${count === 1 ? "name or organisation" : "names or organisations"} in the properties`;
  },
  plan(ctx) {
    const details: string[] = [];
    for (const f of PROPERTY_FIELDS) {
      const els = filled(ctx, f.part, f.names);
      const editor = ctx.editor(f.part);
      if (!editor) continue;
      for (const el of els) editor.setInner(el, "");
      if (els.length > 0) {
        details.push(
          `${f.part}: empties ${els.length} ${els.length === 1 ? "field" : "fields"} (${f.label})`,
        );
      }
    }
    return { details, skipped: [] };
  },
};

export const privacyRepairs: RepairDef[] = [scrubProperties];
