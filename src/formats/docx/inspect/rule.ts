import type { InspectContext } from "./context";

/**
 * One integrity rule. `run` reads the package through the context and reports findings with
 * `ctx.report`. A rule may report several rule codes; `codes` lists them (the catalogue in
 * docs/docx-integrity.md has one entry per code). A rule that throws is reported as
 * `inspect.rule-failed` and the other rules still run.
 */
export interface Rule {
  name: string;
  codes: string[];
  run(ctx: InspectContext): void;
}
