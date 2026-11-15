# Word repairs and clean-ups

Guided, narrow changes to a Word file, offered from File > Clean up this file…. Each one lists what
it will change, asks, and saves in one verified write (one backup, only the listed parts touched).
They are level 1 of "editing Word documents": no page-style editing, only precise, checkable steps.

## How it fits together

- `src/core/repair.ts`: the shared types (`RepairOffer`, `RepairPlan`, `PartEdit`, `RepairProvider`).
  A format offers them through `BinaryView.repairs`; the DOCX provider routes them through the
  worker (`repairOffers`, `repairPlan` in `docx-ops.ts`).
- `src/formats/docx/repair/`: the repairs. `index.ts` is the registry (`REPAIRS`) and the context;
  `splice.ts` has `PartEditor` (precise text edits from element offsets); `tracked-changes.ts`,
  `comments.ts` and `privacy.ts` each export a list of `RepairDef`s.
- `src/workbench/features/clean-up.ts`: the command. It reads the file, lists offers, shows the plan
  in a confirmation (Cancel focused), then calls `ContainerAccess.replaceParts(container, changes,
  { basis })`. `basis` is the exact bytes the plan was built from: if the file changed since, nothing
  is written.
- `src/platform/containers.ts`: `replaceParts` rewrites several text parts in one save through the
  same checks as saving one part (fresh read, well-formed XML, self-check of every other entry,
  changed-on-disk re-check, one-off `.bak`, atomic write). Only existing text parts can be rewritten.

## The contract for a repair (`RepairDef`)

1. `offer(ctx)` returns a short summary (counts only, never document text) or null if it does not
   apply. It is cheap and never throws.
2. `plan(ctx)` makes its edits with `ctx.editor(part)` (a `PartEditor`: `replace`, `remove`,
   `setInner`, `splice`) and returns `{ details, skipped }`. The framework collects the edited parts.
3. Edits are surgical: only the exact ranges of the original text change. Never re-serialise a part:
   namespaces, attribute order, whitespace and line endings stay as written.
4. A case it cannot do safely is left alone and listed in `skipped` with a plain reason. Do not guess.
5. Idempotent: after applying a plan, `offer` returns null (or a smaller count).
6. Pure and tolerant: no DOM, no Node APIs, never throws on damaged input (a part with XML problems
   is not edited: `ctx.editor` returns null for it).
7. `details` and `summary` hold counts, part names and plain words. Never names, text or other
   document content (the privacy rule that applies to findings reports applies here too).
8. Every repair has tests: a clean file offers nothing; the plan on a hand-built package; the result
   is well-formed XML; untouched text is byte-identical; idempotence; odd inputs.

## Defined repairs

See the source files. `docx.scrub-properties` (privacy.ts) is the reference example.
