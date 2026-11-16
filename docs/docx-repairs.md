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

| id | file | what it does |
|---|---|---|
| `docx.accept-tracked-changes` | tracked-changes.ts | Accepts insertions, deletions, moves, formatting changes and table-row changes in every story part |
| `docx.reject-tracked-changes` | tracked-changes.ts | The reverse; restores old properties |
| `docx.remove-comments` | comments.ts | Removes all comments, their anchors and their entries in the comment extension parts |
| `docx.remove-resolved-comments` | comments.ts | Only resolved comments, with their replies |
| `docx.scrub-properties` | privacy.ts | Empties creator, last-modified-by, company and manager (the reference example) |
| `docx.anonymise-authors` | privacy.ts | Revision and comment authors become `Author N`; people.xml is anonymised |
| `docx.remove-rsids` | privacy.ts | Removes editing-session ids |
| `docx.remove-custom-properties` | privacy.ts | Removes custom properties; empties the template and hyperlink base |
| `docx.clear-descriptive-properties` | privacy.ts | Empties title, subject, keywords, description, category, content status |

Left alone on purpose, and listed to the user as such: paragraph-mark deletions and insertions
(they merge paragraphs), cell-level revisions, numbering-change records and numbering insertion
markers on reject, removed content or table rows that hold a footnote, endnote or comment reference
(the note would be left behind, unreferenced, with its text), content in `mc:AlternateContent`
copies that would diverge, change records in styles.xml and numbering.xml (reported, not
changed), and the thumbnail image (parts cannot be deleted). A part with a
DOCTYPE is never edited (Word never writes one, and its entities could hold names the scanner does
not expand); it is reported as unreadable.

What the privacy clean-ups do not reach, and say so: the attached template's path in
`word/_rels/settings.xml.rels` (it can contain a user name; relationships are not changed),
`dc:creator` and `cp:lastModifiedBy` after "Anonymise authors" (the "Remove names" clean-up does
those). Not reported, and not touched by any clean-up: names written in the text of the document or
of comments, `customXml/` items (for example SharePoint metadata), `docMetadata/LabelInfo.xml`,
document variables in settings.xml, and core properties stored outside `docProps/core.xml`.
"Anonymise authors" covers every XML part with a `w:author` attribute (styles and numbering too);
"Clear title…" also empties the copy of the title Word writes in app.xml (`TitlesOfParts`).

Unverified against real Word: that emptied comment parts and the anonymised `people.xml` open
cleanly. Test a cleaned file in Word before relying on them.
