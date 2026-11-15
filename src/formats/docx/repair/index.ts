/**
 * The DOCX repairs: the registry, the context they read from, and the entry points the worker
 * calls. Each repair lives in its own file and is listed once here. Pure: no DOM, no Node APIs.
 */
import { readZip } from "../../../core/archive";
import type { PartEdit, RepairOffer, RepairPlan } from "../../../core/repair";
import { decodePart } from "../decode";
import { Package, type PartSource } from "../package";
import { commentRepairs } from "./comments";
import { privacyRepairs } from "./privacy";
import { PartEditor } from "./splice";
import { trackedChangeRepairs } from "./tracked-changes";
import type { RepairContext, RepairDef } from "./types";

export type { RepairContext, RepairDef, RepairResult } from "./types";
export { PartEditor, applyEdits, innerRange } from "./splice";

/** Every repair, in the order they are offered. */
export const REPAIRS: readonly RepairDef[] = [
  ...trackedChangeRepairs,
  ...commentRepairs,
  ...privacyRepairs,
];

/** A context over a package, plus the means to collect what the repairs edited. */
export function makeContext(source: PartSource): RepairContext & { changes(): PartEdit[] } {
  const pkg = new Package(source);
  const editors = new Map<string, PartEditor | null>();
  const names = (() => {
    try {
      return source.names();
    } catch {
      return [];
    }
  })();
  return {
    pkg,
    names,
    text: (part) => {
      try {
        return source.text(part);
      } catch {
        return undefined;
      }
    },
    editor(part) {
      if (editors.has(part)) return editors.get(part) ?? null;
      const doc = names.includes(part) ? pkg.xml(part) : null;
      // A part with parse problems is not edited: ranges in damaged XML cannot be trusted.
      const editor =
        doc && doc.root && doc.problems.length === 0 ? new PartEditor(part, doc) : null;
      editors.set(part, editor);
      return editor;
    },
    stories() {
      const main = pkg.mainPart;
      const out = [main];
      for (const type of ["header", "footer", "footnotes", "endnotes", "comments"]) {
        for (const rel of pkg.relsOf(main).values()) {
          if (rel.type === type && !rel.external && names.includes(rel.target))
            out.push(rel.target);
        }
      }
      return [...new Set(out)];
    },
    changes() {
      const out: PartEdit[] = [];
      for (const editor of editors.values()) {
        if (editor && editor.count > 0) out.push({ part: editor.part, text: editor.result() });
      }
      return out;
    },
  };
}

function sourceOf(bytes: Uint8Array): PartSource {
  const zip = readZip(bytes);
  const names = zip.entries.filter((e) => !e.isDirectory).map((e) => e.name);
  return {
    names: () => names,
    text(name) {
      const info = zip.info(name);
      if (!info || info.isDirectory) return undefined;
      try {
        return decodePart(zip.bytes(name));
      } catch {
        return undefined;
      }
    },
  };
}

/** The repairs that apply to a package. Never throws: an unreadable file offers nothing. */
export function offersFor(
  source: PartSource,
  repairs: readonly RepairDef[] = REPAIRS,
): RepairOffer[] {
  const ctx = makeContext(source);
  const out: RepairOffer[] = [];
  for (const repair of repairs) {
    try {
      const summary = repair.offer(ctx);
      if (summary !== null) out.push({ id: repair.id, title: repair.title, summary });
    } catch {
      // A repair that fails to decide is not offered.
    }
  }
  return out;
}

/** The plan for one repair, or null if it does not apply or fails. Never throws. */
export function planFor(
  source: PartSource,
  id: string,
  repairs: readonly RepairDef[] = REPAIRS,
): RepairPlan | null {
  const repair = repairs.find((r) => r.id === id);
  if (!repair) return null;
  try {
    const ctx = makeContext(source);
    if (repair.offer(ctx) === null) return null;
    const result = repair.plan(ctx);
    const changes = ctx.changes();
    if (changes.length === 0) return null;
    return { id, title: repair.title, changes, details: result.details, skipped: result.skipped };
  } catch {
    return null;
  }
}

export async function docxRepairOffers(bytes: Uint8Array): Promise<RepairOffer[]> {
  try {
    return offersFor(sourceOf(bytes));
  } catch {
    return [];
  }
}

export async function docxRepairPlan(bytes: Uint8Array, id: string): Promise<RepairPlan | null> {
  try {
    return planFor(sourceOf(bytes), id);
  } catch {
    return null;
  }
}
