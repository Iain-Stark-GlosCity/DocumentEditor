# Document integrity inspector: rule catalogue

The integrity inspector reads a Word package (`.docx`, `.docm`, `.dotx`, `.dotm`) and reports what
is wrong or suspicious in its structure, why it matters, and exactly where: each finding names the
part and an element path such as `/w:document/w:body/w:p[12]/w:pPr/w:pStyle`, which the XML view
of that part can jump to. It is **read-only**: it never changes the file.

## Honest limits

- It checks the package's structure against **rules we can state**: references that must resolve,
  markers that must pair up, settings that must agree. It is **not** validation against Microsoft's
  XML schemas, and it does not know every rule Word applies.
- **A clean report does not prove that Word will open the file**, or that it will look as intended.
  A finding means "look here", not "Word will fail".
- It is deliberately **conservative**. Real Word files are messy in many legal ways, and a false
  alarm costs trust, so each rule lists what it does _not_ flag. When in doubt a rule says nothing,
  or says it as `info`.
- It reads what Word reads: the main document, its headers, footers, footnotes, endnotes and
  comments, styles.xml, numbering.xml and settings.xml, found through the main document's
  relationships. It does not inspect the glossary document (building blocks), charts, embedded
  objects, custom XML or VBA projects beyond their package-level links.
- Content inside `mc:Fallback` is not counted (Word writes text boxes twice, once for new and once
  for old versions), and nor is the content of revision "old properties" elements such as
  `w:rPrChange`, which record what formatting used to be.

## Severities

| Severity  | Meaning                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------- |
| `error`   | Word is likely to complain, repair the file, or lose something: dangling references, missing parts. |
| `warning` | Suspicious, or likely to behave unexpectedly.                                                       |
| `info`    | Hygiene and awareness: counts, leftovers, settings worth knowing about.                             |

## How findings are shaped

- **Aggregated.** A problem that repeats is one finding: "42 paragraphs use the paragraph style
  Mystery, which is not defined", with the first five locations and the full count in `facts.count`.
- **Stable ids.** A finding's id is its rule code plus a hash of what makes it unique (a style id,
  a relationship id, a part name), so the same problem gives the same id on every run.
- **No document text.** Titles, explanations and facts name ids, counts, part names and style names
  only, never what the paragraphs say. The one exception is that the tracked-changes title names
  the authors; `facts` holds only their count.
- **Capped.** At most 300 findings are returned, the most serious first; the rest are summarised in
  one `inspect.truncated` finding.
- **Never throws.** A check that fails on a strange file becomes one `inspect.rule-failed` note and
  the other checks still run.

---

## Package

The zip of parts, the relationships between them (`_rels/*.rels`) and their content types
(`[Content_Types].xml`): the Open Packaging Conventions. This is what Word checks first.

### `package.unreadable`

- **Severity:** error
- **Checks:** the bytes can be read as a zip archive at all.
- **Why:** a Word document is a zip of XML parts; if it cannot be unzipped, nothing else can be
  checked and Word cannot open it.
- **Does not flag:** anything else; this is the only finding for such a file.
- **Example:** a file renamed from `.doc` (the old binary format) to `.docx`.

### `package.no-main-document`

- **Severity:** error
- **Checks:** `_rels/.rels` exists and has an `officeDocument` relationship that is not external.
- **Why:** Word finds the body by following that relationship. Without it Word cannot open the
  file, even when `word/document.xml` is present.
- **Does not flag:** a main document with an unusual name or location (any name is fine if the
  relationship points at it). A relationship whose target part is missing is reported by
  `package.relationship-target-missing` instead.
- **Example:** a tool rewrote `_rels/.rels` and kept only the document properties.

### `package.relationship-target-missing`

- **Severity:** error; warning for relationship types that usually point outside the package
  (hyperlink, attached template, subdocument, frame, mail merge source, OLE object).
- **Checks:** every internal relationship in every `.rels` part points at a part that exists
  (comparing names without regard to case, after decoding `%20` and the like).
- **Why:** whatever uses the relationship (an image, a header, the styles) is lost, and Word
  usually reports unreadable content and offers to repair the file.
- **Does not flag:** relationships with `TargetMode="External"`; targets that are only a fragment
  (`#bookmark`); header and footer relationships that a section uses (reported, more usefully, as
  `sections.header-footer-missing`).
- **Example:** `word/_rels/document.xml.rels` has `rId20 → media/image1.png` but the image was
  deleted from the zip.

### `package.duplicate-relationship-id`

- **Severity:** error
- **Checks:** relationship ids are unique within each `.rels` part.
- **Why:** Word reports the file as damaged, and which target a reference reaches is undefined.
- **Does not flag:** the same id in different `.rels` parts (ids are local to their part).
- **Example:** two `Relationship Id="rId3"` in `word/_rels/document.xml.rels`.

### `package.relationship-source-missing`

- **Severity:** info
- **Checks:** each `.rels` part belongs to a part that exists (`word/_rels/header9.xml.rels`
  needs `word/header9.xml`).
- **Why:** a relationships part for a deleted part is leftover clutter that nothing reads.
- **Does not flag:** `_rels/.rels` (the package's own relationships).
- **Example:** a tool deleted `word/header9.xml` but not its relationships.

### `package.content-types-missing`

- **Severity:** error
- **Checks:** `[Content_Types].xml` exists and parses.
- **Why:** every Office file must declare the content type of each part; Word refuses a package
  without the declarations.
- **Does not flag:** n/a.
- **Example:** a zip assembled by hand from a folder that omitted the file.

### `package.missing-content-type`

- **Severity:** error
- **Checks:** every part (other than `[Content_Types].xml`) has an `Override` for its name or a
  `Default` for its extension, both compared without regard to case.
- **Why:** Word reports a part without a content type as unreadable content.
- **Does not flag:** parts that are covered by a `Default` only (that is normal for images, `.rels`
  and plain `.xml` parts). It does not check that the declared content type is the right one.
- **Example:** an image `word/media/image1.emf` added with no `Default Extension="emf"`.

### `package.override-part-missing`

- **Severity:** warning
- **Checks:** every `Override` names a part that exists.
- **Why:** Word usually ignores it, but it means a part was removed by a tool that did not clean
  up, and strict package readers reject the file.
- **Does not flag:** `Default` entries for extensions no part uses (they are harmless and common).
- **Example:** `<Override PartName="/word/glossary/document.xml" …/>` with no glossary part.

### `package.unresolved-relationship-reference`

- **Severity:** error
- **Checks:** every attribute in the relationships namespace (`r:id`, `r:embed`, `r:link`,
  `r:pict`, `r:dm` and so on) in an XML part names a relationship of that same part. Includes the
  content of `mc:Fallback`.
- **Why:** images, links, charts and embedded objects reach their data through their own part's
  relationships. A missing id means Word cannot find the data and usually reports unreadable
  content.
- **Does not flag:** empty values; header and footer references in section properties (see
  `sections.header-footer-missing`).
- **Example:** `<a:blip r:embed="rId99"/>` where `document.xml.rels` has no `rId99`.

### `package.orphan-part`

- **Severity:** info
- **Checks:** every part is reachable by following relationships from `_rels/.rels`.
- **Why:** Word ignores unreachable parts and usually drops them when it saves, but they still
  travel with the file and may hold content you did not expect to share (an old image, deleted
  comments).
- **Does not flag:** `[Content_Types].xml` and `.rels` parts (they are the package's own
  bookkeeping); anything when the package has no relationships at all (that is
  `package.no-main-document`).
- **Example:** `word/media/old-logo.png` left behind after the logo was replaced.

### `package.part-name-case-collision`

- **Severity:** error
- **Checks:** no two part names are equal when compared without regard to case.
- **Why:** part names in an Office file ignore case, so the parts collide; Word reports the file as
  damaged and which part it reads is undefined.
- **Does not flag:** n/a.
- **Example:** both `word/media/image1.png` and `word/Media/image1.png`.

### `package.malformed-xml`

- **Severity:** error
- **Checks:** every `.xml`, `.rels` and `.vml` part is well-formed (the tolerant parser reports
  unclosed tags, stray end tags, unterminated tags and more than one root).
- **Why:** Word stops reading a part at the first XML error and reports the file as damaged; what
  follows may be lost in the repair. Other findings in the same part may be side effects.
- **Does not flag:** non-XML parts (images, fonts, binaries); XML that is well-formed but invalid
  against the schema.
- **Example:** a header part with a `<w:p>` that is never closed.

### `inspect.part-too-large`

- **Severity:** info
- **Checks:** reports parts over 64 million characters, which are not parsed.
- **Why:** nothing inside them was checked.
- **Does not flag:** n/a.
- **Example:** a document whose body is hundreds of megabytes of XML.

### `inspect.rule-failed`

- **Severity:** info
- **Checks:** reports a check that failed with an internal error on this file; its partial findings
  are dropped and the other checks still run.
- **Why:** the problems that check looks for (if any) are not listed.
- **Example:** an unexpected structure in a strange file.

### `inspect.truncated`

- **Severity:** info
- **Checks:** more than 300 findings; only the most serious 299 are listed.
- **Example:** a badly damaged file with thousands of broken references.

---

## Styles

Read from the main document's `styles` relationship (normally `word/styles.xml`) and the style
references (`w:pStyle`, `w:rStyle`, `w:tblStyle`, `w:numStyleLink`, `w:styleLink`) in the body,
headers, footers, notes, comments and numbering.

Word's **built-in style ids** (Normal, Title, Heading1–9, Quote, IntenseQuote, ListParagraph,
Hyperlink, FootnoteReference, DefaultParagraphFont, TableNormal, TableGrid, the GridTable and
ListTable families and others) are treated specially: a missing built-in is `info`, because Word
knows it by name and adds its definition back when the style is applied again.

### `styles.undefined-style`

- **Severity:** warning; info when the id is a Word built-in style id.
- **Checks:** every paragraph, character, table and numbering style reference names a style defined
  in styles.xml. One finding per missing style id and kind, with a count.
- **Why:** Word shows the text in the default style, the intended formatting is lost, and Word drops
  the reference when it saves.
- **Does not flag:** references inside revision "old properties" (`w:pPrChange` and friends), which
  may name styles that have since been deleted; documents without a styles part (see next rule).
- **Example:** 42 paragraphs use `w:pStyle w:val="LegalSmallPrint"`, which styles.xml does not
  define.

### `styles.styles-part-missing`

- **Severity:** warning
- **Checks:** a document that refers to styles has a styles part.
- **Why:** every styled paragraph falls back to Word's defaults.
- **Does not flag:** a minimal document with no styles part and no style references (that is
  legal and common in generated files).
- **Example:** `word/styles.xml` and its relationship deleted, with headings still using
  `Heading1`.

### `styles.based-on-missing`

- **Severity:** warning; info when the missing parent is a built-in style id.
- **Checks:** every `w:basedOn` names a defined style.
- **Why:** the style loses the formatting it inherits and is based on the defaults instead.
- **Does not flag:** a missing built-in parent such as Default Paragraph Font, which usually adds
  nothing (generators such as the `docx` package base character styles on it without defining it).
- **Example:** the custom style `Disclaimer` is based on `Ghost`, which does not exist.

### `styles.link-missing`

- **Severity:** info
- **Checks:** every `w:link` names a defined style.
- **Why:** Word ignores the link between a paragraph style and its character twin. Harmless, but a
  sign the style was copied from elsewhere.
- **Example:** `Heading2` is linked to `Heading2Kar`, which is not defined.

### `styles.next-missing`

- **Severity:** info
- **Checks:** every `w:next` names a defined style.
- **Why:** after Enter, Word keeps the same style instead of the intended next one.
- **Example:** `Note` names `BodyCopy` as its next style, which is not defined.

### `styles.based-on-cycle`

- **Severity:** warning
- **Checks:** following `w:basedOn` from any style ends, rather than coming back to a style already
  visited. One finding per loop, with a location for each `w:basedOn` in it.
- **Why:** in a loop no style has a starting point; Word breaks it somewhere of its own choosing,
  and the formatting may differ between Word versions and other programs. (The Formatting view's
  chain walker stops at a loop silently; this rule reports it.)
- **Does not flag:** long chains that end (see next rule).
- **Example:** `Heading1` is based on `Heading2`, which is based on `Heading1`.

### `styles.deep-based-on-chain`

- **Severity:** info
- **Checks:** basedOn chains more than 10 styles deep.
- **Why:** legal, but hard to reason about; a change near the top ripples unpredictably, and such
  chains usually come from styles copied between documents.
- **Does not flag:** ordinary hierarchies (Heading 2 based on Heading 1 based on Normal).
- **Example:** twelve custom styles each based on the previous one.

### `styles.duplicate-id`

- **Severity:** warning
- **Checks:** style ids are unique in styles.xml.
- **Why:** Word uses one definition and ignores the rest, so the formatting you see may not be the
  definition you edit.
- **Example:** two `w:style` elements with `w:styleId="Note"`.

### `styles.duplicate-name`

- **Severity:** warning
- **Checks:** no two styles with different ids have the same name (ignoring case).
- **Why:** Word picks styles by name in its galleries and when pasting; it may rename one on
  opening, and text can end up in the other.
- **Does not flag:** styles without a name; the same style defined twice (that is
  `styles.duplicate-id`).
- **Example:** styles `Note` and `Disclaimer` both called "Note".

### `styles.no-default-paragraph-style`

- **Severity:** info
- **Checks:** a non-empty styles part marks one paragraph style as the default (`w:default="1"`).
- **Why:** paragraphs with no style use the default; without one, programs disagree about how they
  look.
- **Does not flag:** an empty or missing styles part. This is `info` because Word copes; it is not
  certain that every program does.
- **Example:** `Normal` without `w:default="1"`.

### `styles.unused-styles`

- **Severity:** info
- **Checks:** counts styles that are neither the default for their type nor used by any reference,
  directly or through another used style's basedOn, link or next. Custom styles are listed first.
- **Why:** harmless, but many unused custom styles usually come from pasting and clutter the
  gallery.
- **Does not flag:** default styles; styles reached only through inheritance from used styles.
- **Example:** "21 styles are defined but not used".

---

## Numbering

Read from the main document's `numbering` relationship (normally `word/numbering.xml`) and every
`w:numPr` in content and in styles.

### `numbering.undefined-num`

- **Severity:** error
- **Checks:** every `w:numId` names a `w:num` in numbering.xml (or the document has a numbering
  part at all). One finding per missing numId.
- **Why:** the paragraphs lose their numbers or bullets and the list structure is lost.
- **Does not flag:** `w:numId w:val="0"`, which means "no numbering" (often used to switch off a
  style's numbering for one paragraph); `w:numPr` with only a level; numbering inside revision
  "old properties".
- **Example:** a pasted paragraph with `w:numId w:val="7"` and no list 7.

### `numbering.missing-abstract`

- **Severity:** error
- **Checks:** every `w:num` names an `w:abstractNum` that exists.
- **Why:** the list has no levels, formats or indents, and Word drops its numbering.
- **Example:** `<w:num w:numId="2"><w:abstractNumId w:val="9"/></w:num>` with no definition 9.

### `numbering.level-out-of-range`

- **Severity:** warning
- **Checks:** list levels (`w:ilvl` in paragraphs and styles, `w:lvl`/`w:lvlOverride` in
  numbering.xml) are whole numbers from 0 to 8.
- **Why:** Word lists have nine levels; anything else is shown at a level Word chooses, or without
  a number.
- **Example:** `<w:ilvl w:val="9"/>`.

### `numbering.proliferation`

- **Severity:** info
- **Checks:** more than **50** list instances (`w:num`).
- **Why the threshold:** Word adds an instance every time a list is restarted or pasted in. An
  ordinary long document has a few dozen. Past fifty they are usually the residue of years of copy
  and paste, and "continue numbering" and "restart at 1" start to pick surprising neighbours.
- **Does not flag:** many list definitions on their own, which are cheap; any number at or under 50.
- **Example:** "62 list instances and 2 list definitions".

### `numbering.unused-definitions`

- **Severity:** info
- **Checks:** list instances no paragraph or style uses, and list definitions no instance uses.
- **Why:** harmless clutter that makes numbering harder to repair by hand.
- **Does not flag:** list-style definitions (`w:styleLink`, `w:numStyleLink`), which are reached
  through numbering styles.
- **Example:** `w:num w:numId="1"` defined but never referred to.

### `numbering.restart-overrides`

- **Severity:** info
- **Checks:** lists `w:lvlOverride` elements with a `w:startOverride`, which force a level to start
  again at a fixed number.
- **Why:** this is how Word records "Restart at 1" and "Set numbering value"; if a list restarts
  unexpectedly, look here.
- **Example:** `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>`.

### `numbering.direct-differs-from-style`

- **Severity:** info
- **Checks:** a paragraph whose style puts it in one list (through the style's inherited `w:numPr`)
  but whose own `w:numPr` puts it in another.
- **Why:** direct numbering wins, so updating the style will not renumber these paragraphs.
- **Does not flag:** a direct `numId` of 0 (switching numbering off is deliberate); paragraphs whose
  style has no numbering.
- **Example:** a `ListNumber` paragraph (list 1 by style) with direct `w:numId w:val="2"`.

---

## Sections

Read from the section properties (`w:sectPr`) in the main document and from settings.xml.

### `sections.header-footer-missing`

- **Severity:** error
- **Checks:** every `w:headerReference` and `w:footerReference` names a relationship of the main
  document whose target part exists. One finding per relationship id, listing every section that
  uses it.
- **Why:** the header or footer is lost, and Word usually reports unreadable content.
- **Does not flag:** one header used by several sections (that is normal); sections that inherit
  their headers by having no references.
- **Example:** `<w:headerReference w:type="first" r:id="rId9"/>` where `word/header2.xml` was
  deleted.

### `sections.title-page-without-first-header`

- **Severity:** info
- **Checks:** a section with "Different first page" (`w:titlePg`) that has no first-page header or
  footer, either its own or inherited from an earlier section.
- **Why:** the first page has a blank header and footer. Often that is the intention (a title
  page), so this is awareness only.
- **Example:** `w:titlePg` with only `w:type="default"` references.

### `sections.even-headers-unused`

- **Severity:** info
- **Checks:** even-page header or footer references while settings.xml does not switch on
  `w:evenAndOddHeaders`.
- **Why:** they are never shown, though they stay in the file.
- **Example:** `w:type="even"` references and no `w:evenAndOddHeaders` in settings.

### `sections.even-headers-missing`

- **Severity:** info
- **Checks:** `w:evenAndOddHeaders` on, but no section has an even-page header or footer.
- **Why:** every even page has a blank header and footer.
- **Example:** `<w:evenAndOddHeaders/>` in settings.xml and only default headers.

### `sections.page-setup-differs`

- **Severity:** info
- **Checks:** page width, height, orientation and the four margins of each section against the
  first section.
- **Why:** sections may differ on purpose (a landscape page for a wide table); if not intended, the
  odd page is in its own section.
- **Does not flag:** header and footer distances, gutters, columns; a missing `w:orient` compared
  with `portrait` (they mean the same).
- **Example:** section 2 is 16838 × 11906 landscape.

### `sections.page-numbering-restart`

- **Severity:** info
- **Checks:** `w:pgNumType` with a `w:start` value.
- **Why:** page numbers restart there; if they jump back or repeat, this is where.
- **Does not flag:** `w:pgNumType` that only sets a number format.
- **Example:** `<w:pgNumType w:start="1"/>` in section 2.

### `sections.missing-final-sectpr`

- **Severity:** warning
- **Checks:** the body has its own `w:sectPr` (the last section's properties).
- **Why:** without it, the last section uses defaults that differ between programs and countries
  (A4 or Letter), and its headers and footers are lost.
- **Example:** a generated document whose body ends with a paragraph and no `w:sectPr`.

---

## Ghost formatting

Text you cannot see, markers that do not pair up, and paragraphs buried in direct formatting.

### `formatting.hidden-text`

- **Severity:** info
- **Checks:** counts runs and paragraph marks with direct `w:vanish` (on), in all content parts.
- **Why:** hidden text is not shown or printed unless formatting marks are on, but it is in the
  file and is shared with it.
- **Does not flag:** hidden text applied through a style (often deliberate, for example hidden
  index entries); `w:vanish w:val="0"`.
- **Example:** a run with `<w:vanish/>`.

### `formatting.invisible-text`

- **Severity:** warning
- **Checks:** runs with visible text whose explicit colour equals their own explicit shading fill;
  or explicit white (`FFFFFF`) text in the main body with no shading or highlight on the run, its
  paragraph, its paragraph or character style.
- **Why:** readers cannot see the text, but it can be copied, searched and read aloud, which is
  sometimes used to hide text on purpose.
- **Does not flag (deliberately conservative):** theme colours; text in tables, text boxes,
  drawings or `mc:AlternateContent`; white text in headers, footers and notes; any white text in a
  document that has a page background colour, a picture behind the text, or VML shapes; runs
  with highlight; deleted text.
- **Example:** `<w:color w:val="FFFFFF"/>` on a plain paragraph of body text.

### `formatting.tiny-text`

- **Severity:** info
- **Checks:** runs with visible text and a direct size under 3 pt (`w:sz` below 6 half-points).
- **Why:** unreadable on screen and in print; sometimes a spacing trick, sometimes a way to hide
  text.
- **Does not flag:** small paragraph marks (a common spacing trick); sizes from styles.
- **Example:** `<w:sz w:val="2"/>` (1 pt).

### `formatting.unbalanced-field`

- **Severity:** warning
- **Checks:** in each content part, complex field markers (`w:fldChar`) in document order: every
  `begin` has an `end`, every `separate` and `end` has a `begin`, and no field has two separators.
  Nested fields are handled.
- **Why:** Word may show the field code instead of its result, swallow the following text, or
  repair the document.
- **Does not flag:** simple fields (`w:fldSimple`); fields without a separator (legal).
- **Example:** a REF field whose `end` marker was deleted.

### `formatting.duplicate-bookmark-name`

- **Severity:** warning
- **Checks:** bookmark names are unique across the document's content parts, ignoring case.
- **Why:** Word keeps one and drops the others, so links and cross-references may go to the wrong
  place.
- **Does not flag:** hidden bookmarks whose names start with `_` (`_Toc…`, `_Ref…`, `_GoBack`),
  which Word manages itself; the copies of a bookmark in `mc:Fallback`.
- **Example:** two bookmarks called "Results" and "results".

### `formatting.duplicate-bookmark-id`

- **Severity:** warning
- **Checks:** bookmark start ids are unique within each content part.
- **Why:** starts and ends pair by id; Word drops or shortens one of the bookmarks.
- **Does not flag:** the same id in different parts; ids shared with comments or revisions (they
  are separate kinds).
- **Example:** two `w:bookmarkStart w:id="3"` in the body.

### `formatting.unclosed-bookmark`

- **Severity:** warning
- **Checks:** every `w:bookmarkStart` has a `w:bookmarkEnd` with the same id in the same part.
- **Why:** Word drops the bookmark, and cross-references and links to it break.
- **Does not flag:** an end without a start (Word ignores it silently).
- **Example:** the `w:bookmarkEnd w:id="3"` was deleted.

### `formatting.duplicate-sdt-id`

- **Severity:** warning
- **Checks:** content control ids (`w:sdtPr/w:id`) are unique within each content part.
- **Why:** forms, macros and data binding find controls by id; Word renumbers duplicates silently,
  which can break whatever relied on them.
- **Does not flag:** the same id in different parts (headers often repeat controls).
- **Example:** a content control copied and pasted, keeping `w:id w:val="-1234567"`.

### `formatting.direct-formatting-hotspots`

- **Severity:** info
- **Checks:** in the main body, paragraphs whose direct paragraph properties plus distinct direct
  run properties reach **12**; lists the top five.
- **Why:** direct formatting sits on top of the style and wins, so changing the style no longer
  changes these paragraphs.
- **Does not flag:** style, numbering and section references; language, proofing and revision
  bookkeeping (`w:lang`, `w:noProof`, `w:rPrChange`); the complex-script twins of bold, italic and
  size (counted once); font hints.
- **Example:** a centred, shaded, indented paragraph in bold italic underlined Arial capitals.

### `formatting.indent-overrides-list`

- **Severity:** info
- **Checks:** in the main body, list paragraphs (the list comes from the paragraph or its style)
  whose own `w:ind` sets a left (or start) indent, or a first-line or hanging indent, that differs
  from the value the list level itself sets. Hanging and first line are compared as one signed
  value, so a direct `w:firstLine="0"` over a level's hanging indent is a difference. Paragraphs
  are resolved with the same layers as Explain this paragraph.
- **Why:** the list level decides where the number and text sit; a direct indent moves one item
  out of line with the rest, usually from nudging it by hand.
- **Does not flag:** a direct indent equal to the level's; list paragraphs with no indent of their
  own; a value the level does not set (nothing is overridden); a list whose level is not defined
  (reported by the numbering rules).
- **Example:** one bullet in a list with `w:ind w:left="1440"` where the level says 720.

### `formatting.extreme-indent`

- **Severity:** warning
- **Checks:** in the main body, outside tables and text boxes, paragraphs whose effective left or
  right indent is negative, or whose left plus right indent reaches 80% of the text width of the
  paragraph's own section (page width minus margins and gutter; the narrowest column when the
  section has several).
- **Why:** the text is pushed into the margin or squeezed into a narrow column.
- **Does not flag:** paragraphs in tables (cell widths are not resolved) or text boxes; a side
  stated in character units (Word uses those instead of the twips); the width test for a section
  that states no page width (a negative indent is still reported). A hanging indent alone is not
  flagged, since only the left and right indents are summed.
- **Example:** a paragraph with `w:ind w:left="9000"` on an A4 page with 1-inch margins.

---

## Revisions

### `revisions.tracked-changes`

- **Severity:** info
- **Checks:** counts tracked changes in content parts by kind: insertions (`w:ins`, `w:cellIns`),
  deletions (`w:del`, `w:cellDel`), moves (`w:moveFrom`, `w:moveTo`), formatting changes
  (`w:rPrChange`, `w:pPrChange`, `w:sectPrChange`, table changes, `w:numberingChange`) and cell
  merges.
- **Why:** they stay in the file until accepted or rejected, and anyone who opens it can see the
  deleted text and who changed what.
- **Privacy:** the title names up to three authors; `facts.authors` holds only the count.
- **Example:** "2 tracked changes by A Reviewer, B Editor".

### `revisions.tracking-on`

- **Severity:** info
- **Checks:** `w:trackRevisions` is on in settings.xml.
- **Why:** every edit will be recorded with the editor's name and time.
- **Example:** `<w:trackRevisions/>`.

### `revisions.duplicate-id`

- **Severity:** warning
- **Checks:** tracked-change ids (on the elements counted above) are unique within each part.
- **Why:** accepting or rejecting one change may act on another, and other programs may merge or
  drop them.
- **Does not flag:** the ids of move range markers, which pair a start with its end; the same id in
  different parts.
- **Example:** two `w:ins w:id="101"`.

### `revisions.unbalanced-move-range`

- **Severity:** warning
- **Checks:** every move range start has an end with the same id in the same part (and the
  reverse), and every named move source (`w:moveFromRangeStart w:name`) has a destination of the
  same name, and the reverse.
- **Why:** Word cannot show the move as a move, and accepting it may duplicate or lose the text.
- **Example:** a `w:moveFromRangeStart` whose `w:moveFromRangeEnd` is missing.

---

## Comments and notes

### `notes.comment-missing`

- **Severity:** error
- **Checks:** every `w:commentReference` and `w:commentRangeStart` names a comment in
  comments.xml (or there is a comments part at all).
- **Why:** Word reports unreadable content and removes the markers in its repair.
- **Example:** `<w:commentReference w:id="5"/>` with no comment 5.

### `notes.comment-range-unclosed`

- **Severity:** warning
- **Checks:** every `w:commentRangeStart` has a `w:commentRangeEnd` with the same id in the same
  part.
- **Why:** Word cannot tell which text the comment is about, and anchors it to a point or drops it.
- **Does not flag:** comments with a reference but no range (legal: a comment on a point).
- **Example:** the `w:commentRangeEnd` was deleted.

### `notes.comment-unreferenced`

- **Severity:** info
- **Checks:** comments in comments.xml that no content part refers to.
- **Why:** Word never shows them, but their text and authors stay in the file.
- **Example:** comment 3 exists, but nothing in the text refers to it.

### `notes.note-missing`

- **Severity:** error
- **Checks:** every `w:footnoteReference` and `w:endnoteReference` names a note in footnotes.xml or
  endnotes.xml.
- **Why:** Word reports unreadable content; the mark is removed or shows an empty note.
- **Example:** `<w:footnoteReference w:id="9"/>` with no footnote 9.

### `notes.note-unreferenced`

- **Severity:** info
- **Checks:** footnotes and endnotes that no content part refers to.
- **Why:** never shown, but their text is still in the file.
- **Does not flag:** separator, continuation separator and continuation notice notes, which
  settings.xml refers to rather than the text.
- **Example:** footnote 2 exists, but nothing refers to it.

---

## Not implemented (yet), and why

- **Schema validation** (element order, allowed children, attribute values): needs the schemas and
  is a different kind of tool; out of scope.
- **Style type mismatches** (a paragraph referring to a character style): Word tolerates many of
  these and the rules for linked styles make them easy to get wrong; left out to avoid false alarms.
- **Comment replies and extended comment parts** (`commentsExtended.xml`, `commentsIds.xml`):
  their consistency rules are not well documented.
- **Font, theme and settings consistency** (fonts used but not in the font table, theme colours
  missing): Word substitutes silently, so the findings would be noise.
- **Revision ids across parts, and bookmark and content control ids across parts**: Word itself is
  not consistent about whether these are unique per part or per document, so they are checked per
  part only.
- **Repairs**: the inspector is read-only by design.
