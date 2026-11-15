/**
 * What a repair is, inside the DOCX format. A repair reads the package through `RepairContext`
 * (parsed parts, cached), decides whether it applies (`offer`), and builds a plan with
 * `PartEditor`s (`plan`). It never writes anything and never throws on odd input: a case it cannot
 * do safely is left alone and listed in `skipped`.
 */
import type { Package } from "../package";
import type { PartEditor } from "./splice";

export interface RepairContext {
  pkg: Package;
  /** The names of all parts in the package, in archive order. */
  names: string[];
  /** The part's text as read from the file (BOM removed, line endings as written), or undefined. */
  text(part: string): string | undefined;
  /** An editor for one part (the same editor each time for the same part), or null if it is missing or unreadable. */
  editor(part: string): PartEditor | null;
  /** The main document part and the parts of the main story that hold content (headers, notes, …). */
  stories(): string[];
}

export interface RepairResult {
  /** Lines for the confirmation: what changes, in plain words, never document text. */
  details: string[];
  /** Things found but left alone, and why. */
  skipped: string[];
}

export interface RepairDef {
  id: string;
  /** Sentence case. */
  title: string;
  /** A short summary of what applies in this file (counts, never document text), or null if the repair does not apply. */
  offer(ctx: RepairContext): string | null;
  /** Makes the edits with `ctx.editor(part)` for each part touched; the framework collects them. */
  plan(ctx: RepairContext): RepairResult;
}
