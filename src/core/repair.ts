/**
 * Guided repairs and clean-ups for a container file (a Word document and the like): each is a
 * narrow, previewed change that is saved through the verified save path (one write, one backup).
 * A format offers them through `BinaryView.repairs`; the workbench lists them, shows what will
 * change, asks, and applies the plan with `ContainerAccess.replaceParts`.
 *
 * Plans are plain data and free of any document text, so they can be built in a worker.
 */

/** A repair that applies to this file now, as listed to the user. */
export interface RepairOffer {
  /** Stable id, for example `docx.accept-tracked-changes`. */
  id: string;
  /** Sentence case, for example `Accept all tracked changes`. */
  title: string;
  /** What it would touch in this file, for example `14 insertions and 9 deletions`. Never document text. */
  summary: string;
}

/** The new text of one part. It keeps the part's own line endings; the platform keeps its BOM and encoding. */
export interface PartEdit {
  part: string;
  text: string;
}

export interface RepairPlan {
  id: string;
  title: string;
  /** The parts to rewrite, in one save. Parts not listed are not touched. */
  changes: PartEdit[];
  /** Lines for the confirmation: what will change, part by part, in plain words. Never document text. */
  details: string[];
  /** Things it found but left alone, and why (for example a case it cannot do safely). */
  skipped: string[];
}

/** What a format offers for a container: which repairs apply, and the plan for one. */
export interface RepairProvider {
  offers(bytes: Uint8Array, context: { path: string }): Promise<RepairOffer[]>;
  /** The plan for one repair, or null if it no longer applies. Read-only: it never changes the file. */
  plan(bytes: Uint8Array, context: { path: string; id: string }): Promise<RepairPlan | null>;
}
