# The Formatting view of a Word document

Opening a `.docx` (or `.docm`, `.dotx`, `.dotm`) shows its **Formatting view**: a generated,
read-only text that breaks the document down so that you can see all of its formatting, the way
Markdown shows `**bold**` and `# heading`. Nothing in the file is changed. To see the raw XML of any
part of the file, open it from the Parts pane.

This page is the full legend. The first six lines of every view are a short version of it.

## Design rules

1. **Markdown for what Markdown says.** Headings, lists, bold, italic, strikethrough, links,
   images, footnotes, block quotes and simple tables are written as Markdown, so the document's text
   reads as the body.
2. **A small HTML-like vocabulary for the rest.** Character formatting Markdown cannot express is
   an inline tag such as `<span font="Arial" size="12pt">…</span>`. Paragraph formatting is one
   trailing comment per paragraph: `<!-- p style="Heading 1" align=centre -->`. Tags and comments
   highlight as HTML in a Markdown editor and are dimmed in the view, so they read as annotations.
3. **Direct formatting where it is applied; styles by name.** A paragraph or a run says which style
   it uses and which formatting was applied to it directly. What a style means is listed once, in
   the **Styles** section at the end, fully resolved.
4. **Nothing is hidden.** Markup the view does not interpret is shown as a placeholder with its
   path and its XML: `<!-- raw path="/w:document/w:body/w:p[12]/w:r[3]/w:foo" <w:foo …/> -->`.
   Long XML is cut at 600 characters with a note of its full length. Parts the view does not show at
   all are listed at the end under **Other parts**.
5. **Unambiguous.** Characters in the document's own text that would read as Markdown or HTML are
   escaped with a backslash. White space that would otherwise be invisible or collapsed is a named
   token.
6. **Deterministic and line-oriented.** The same file always gives the same text. Each paragraph is
   one line, and blocks are separated by one blank line.

## Layout of a view

```text
<!-- legend (six lines) -->

<!-- properties title=… creator=… -->          from docProps/core.xml
<!-- application pages=… words=… -->           from docProps/app.xml
<!-- custom-properties … -->                    from docProps/custom.xml
<!-- settings track-revisions … -->            settings that change meaning

<!-- section 1 of 2 page="595.3pt x 841.9pt A4 portrait" margins=… header-default=… -->
…the body, paragraph by paragraph…
<!-- section 2 of 2 … -->
…

<!-- ==== Footnotes ==== -->      <!-- ==== Endnotes ==== -->
<!-- ==== Comments ==== -->
<!-- ==== Headers and footers ==== -->
<!-- ==== Styles ==== -->
<!-- ==== Lists ==== -->
<!-- ==== Other parts ==== -->     the theme, and every part not shown above
```

Each section line comes before the first paragraph of its section (in the file, Word stores a
section's properties after its last paragraph; that paragraph's comment says `section-ends`).

## Units

All lengths are in **points** (`pt`), whatever unit the file uses: 1 pt = 20 twips = 2 half-points
= 8 eighth-points = 12,700 EMU. Table widths given as a share of the page are percentages (`50%`).
Line spacing that is a multiple is a plain number (`line-spacing=1.15`); fixed spacing says so
(`line-spacing="exactly 12pt"`, `"at-least 12pt"`). Colours are hexadecimal RGB as in Word.

## Paragraphs

```markdown
# Introduction <!-- p style="Heading 1" -->

Body text in the default style, with no direct formatting, has no comment.

Indented and justified. <!-- p indent-left=36pt hanging=18pt spacing-after=6pt align=justify keep-next -->

<!-- p empty -->
```

- **Headings.** A paragraph whose style (following `basedOn`) has an outline level, or is named
  `heading 1`…`heading 9`, is a Markdown heading. A direct outline level does the same. Levels 7
  to 9 are written as `######` with `heading-level=` in the comment.
- **Block quotes.** A paragraph whose style name contains "Quote" starts with `> `.
- **The comment** lists, in this order: `style=` (only when not the default paragraph style), the
  list (`list=`, `level=`, `numbering=`), then every direct property in file order, then the
  paragraph mark's own formatting (`mark=…`) and revisions (`mark-ins=…`, `mark-del=…`), then a
  formatting change (`changed-by=… was=…`).
- **Empty paragraphs** are `<!-- p empty … -->` so they are not lost among the blank lines.
- Style names written all in lower case in the file (as Word writes its built-in ones) are shown
  title-cased, as Word's own interface shows them: `heading 1` is `Heading 1`.

Paragraph properties: `align` (`left`, `centre`, `right`, `justify`, `distribute`…),
`indent-left`, `indent-right`, `indent-start`, `indent-end`, `first-line`, `hanging`,
`spacing-before`, `spacing-after` (or `auto`), `line-spacing`, `keep-next`, `keep-lines`,
`page-break-before`, `widow-control` (or `widow-control=off`), `outline-level` (1 to 9 as in
Word's interface, or `body`), `border-top`/`-bottom`/`-left`/`-right`/`-between`/`-bar` (or
`borders` when all four sides agree), `shading`, `tabs="left 36pt, right dot 450pt"`,
`contextual-spacing`, `no-hyphenation`, `rtl`, `frame=…`, `text-direction`, and the rest under
their own names. A property the view has no name for appears as its XML name with its values:
`w:foo="val=1"`.

## Lists

```markdown
1. Gather the data <!-- p list=2 level=1 -->

   a) From sales <!-- p list=2 level=2 numbering=a) -->

      i. Weekly figures <!-- p list=2 level=3 numbering=i. -->

- Risks <!-- p style="List Bullet" list=3 level=1 -->
```

Numbering is computed as Word draws it: counters per list definition, `start` and
`startOverride`, levels that restart, legal numbering, and numbering that comes from the
paragraph style. Bullets are `-`. A single-level decimal label (`3.` or `3)`) is a Markdown
ordered marker; any other label (`a)`, `1.2.`, `(iv)`, `Article 3`) is written as it is drawn and
repeated in the comment as `numbering=`, which tells it apart from the same characters typed as
text. Nested levels are indented so that Markdown sees the nesting. A heading that is numbered
keeps `#` and gives its number in the comment.

The **Lists** section at the end gives each list in use: its definition, and for every level the
format, the label text (`%1.%2.`), the start, overrides, alignment, indents and the number's own
formatting. A bullet from a symbol font is shown by its code, such as `U+F0B7`.

## Text and character formatting

| In the view | Meaning |
| --- | --- |
| `**bold**`, `*italic*`, `~~strike~~` | Bold, italic, single strikethrough applied directly |
| `<b>`, `<i>`, `<s>` | The same, where Markdown emphasis would not parse (inside a word next to punctuation) |
| `<u>`, `<u type="double" colour="0000FF">` | Underline: single, or another kind and colour |
| `<sup>`, `<sub>` | Superscript, subscript |
| `<span …>` | Every other run property, listed below |
| `<span style="Strong">` | A character style |
| `<format-change author=".." date=".." was="italic">` | A tracked formatting change, with the formatting before it |

Span attributes: `font` (with `font-hansi`, `font-east-asia`, `font-cs` and `font-hint` where they
differ from `font`; theme fonts as `+body (Calibri)` and `+headings (Calibri Light)`), `size`,
`size-cs` (where it differs), `colour` (theme colours as `2F5496 (accent1, shade BF)`),
`highlight`, `shading`, `bold=off` and `italic=off` (switched off against the style), `bold-cs`,
`italic-cs`, `double-strike`, `caps`, `small-caps`, `hidden`, `web-hidden`, `emboss`, `engrave`,
`outline`, `shadow`, `letter-spacing`, `scale` (`80%`), `kern="from 14pt"`, `raise` (negative
lowers), `lang`, `lang-east-asia`, `lang-cs`, `border`, `emphasis-mark`, `fit-text`, `animation`,
`no-proof`, `rtl`, `complex-script`, `snap-to-grid`, `vertical=baseline`. Text effects from newer
versions of Word (`w14:glow`, `w14:textOutline` and so on) appear under their XML names with their
values.

Runs with the same formatting are merged, and tags are nested so that, for example, a bold word
inside a red phrase is `<span colour="C00000">red **and bold**</span>`. The bold `w:bCs` that Word
writes beside every `w:b` is folded into `bold` when it agrees.

### Escaping

The document's own text is escaped where it would otherwise read as notation:

- always: `\`, `` ` ``, `*`, `[`, `]`, `<`, `~`;
- `_` where it could start or end emphasis (`snake_case` stays as it is);
- `#` at the start of the text or after a space;
- `&` where it would read as an entity (`&amp;`);
- at the start of a paragraph: `>`, `-`, `+`, `=`, and a number followed by `.` or `)`;
- in a pipe table: `|`.

### Visible tokens

| Token | Meaning |
| --- | --- |
| `<tab/>` | Tab character |
| `<br/>` | Line break (also `w:cr`) |
| `<br type="page"/>`, `<br type="column"/>`, `<br clear="all"/>` | Page and column breaks, text wrapping break |
| `<nbsp/>` | Non-breaking space |
| `<sp/>`, `<sp n="3"/>` | Spaces at the start or end of a paragraph, which Markdown would drop |
| `<shy/>`, `<nbhy/>` | Optional (soft) hyphen, non-breaking hyphen |
| `<sym font="Wingdings" char="F0FC"/>` | A symbol character from a font |
| `<ptab align="right" relative-to="margin" leader="dot"/>` | Absolute position tab |
| `<char code="200B"/>` | Any other invisible or control character |
| `<page-number/>`, `<date-part kind="yearLong"/>` | Old-style page number and date characters |
| `<note-number/>`, `<separator/>`, `<continuation-separator/>` | Inside notes: the note's number, Word's separator lines |
| `<comment-mark/>` | Inside a comment: its reference mark |

Spaces inside a paragraph are kept as they are; the editor shows them.

## Links, bookmarks and fields

```markdown
See [the report](https://example.com/report "Tooltip") and [the results](#results).

## Results<bookmark name="results"/> <!-- p style="Heading 2" -->

Page <field code="PAGE">3</field> of <field code="NUMPAGES">12</field>
```

- External links come from the document's relationships; a link to a bookmark is `#name`. A link
  whose relationship is missing says so: `[text](<rId9 (missing relationship)>)`.
- Bookmarks: `<bookmark name=".."/>` for an empty one, otherwise `<bookmark-start name=".."/>` …
  `<bookmark-end name=".."/>` (they may span paragraphs).
- Fields, simple and complex alike, are `<field code="…">cached result</field>`, so you see both
  the instruction and what Word last showed. A field that spans paragraphs (a table of contents)
  opens in one paragraph and closes in a later one. Fields inside a field's instruction are shown
  in braces, as Word's "Toggle field codes" does: `IF { MERGEFIELD Gender } = "F" "Ms" "Mr"`.
  `locked`, `dirty` and form field data (`form-field=…`) are attributes of the field.

## Tables

A table is a Markdown **pipe table** only when that is faithful: no merged cells, no nested
tables, one paragraph per cell with no paragraph formatting, no cell formatting other than its
width, the same number of cells in every row, and a first row that is a header (a repeated header
row, `header=repeat`, or the table style's first-row formatting, `header=style`). The table's
properties come first in a comment:

```markdown
<!-- table style="Table Grid" width=450pt borders="single 0.5pt auto" grid="150pt 150pt 150pt" header=repeat -->
| Region | Q1 | Q2 |
| --- | --- | --- |
| North | 1.2 | 1.4 |
```

Every other table is an **HTML table** with the properties as attributes, one cell per line, and
paragraphs in a cell separated by `<p/>`:

```html
<table style="Grid Table 4" width="100%" look="first-row banded-rows" grid="100pt 100pt 100pt">
  <tr header>
    <td colspan="2" width="200pt">Wide</td>
    <td rowspan="3" shading="FFFF00">Tall</td>
  </tr>
  <tr>
    <td>a</td>
    <td>b</td>
    <!-- merged into the cell above -->
  </tr>
</table>
```

`gridSpan` becomes `colspan`; a `vMerge` run becomes `rowspan` on its first cell, and each cell it
covers is a `merged into the cell above` comment (with its text, if it has any). Nested tables are
indented inside their cell. Table attributes: `style`, `width`, `align`, `indent`, `layout`,
`borders`/`border-*`, `borders-inside`, `shading`, `cell-margin-*`, `cell-spacing`, `look`, `grid`,
`float`, `caption`, `description`. Rows: `header`, `cant-split`, `height`, `grid-before`,
`grid-after`, `row-inserted`, `row-deleted`. Cells: `width`, `valign`, `shading`, `border-*`,
`no-wrap`, `text-direction`, `cell-inserted`. Content controls around rows or cells are noted in a
comment. Tables nested more than 40 deep are shown as a placeholder.

## Pictures, shapes and equations

```markdown
<drawing kind="picture" name="Logo" width="72pt" height="36pt" placement="inline">![The company logo](word/media/image1.png)</drawing>
<drawing kind="picture" name="Picture 7" width="50pt" height="25pt" placement="anchored" horizontal="page right" vertical="page +20pt" wrap="none" behind-text>![Watermark](word/media/image1.png)</drawing>
<drawing kind="text box" name="Text Box 1" … geometry="rect">Boxed text <p/> Second paragraph</drawing>
```

- Pictures (DrawingML): name, title, alt text (as the Markdown image's text), size, inline or
  anchored with position, wrapping, `behind-text`, and the part the picture is in.
- Text boxes and shapes: a summary (kind, name, size, geometry) with the text inside; a shape with
  no text, a group, a canvas or SmartArt also gets its XML as a raw placeholder. Charts and
  SmartArt name their part.
- VML (`w:pict`, older files and the fallback of newer ones) and embedded objects (`w:object`):
  `<vml …>` with the shape, its style, image or text box content, followed by the raw XML.
- `mc:AlternateContent`: a comment says which branch is shown (the first `mc:Choice`, which every
  current Word uses) and what the other branches hold, then the chosen branch is rendered.
- Equations (Office Math): `<math>` with a linear approximation such as `(-b±√(b^2-4ac))/2a`,
  followed by the raw OMML.

## Tracked changes, comments and notes

| In the view | Meaning |
| --- | --- |
| `<ins id author date>…</ins>` | Inserted text |
| `<del id author date>…</del>` | Deleted text (Word's `w:delText`) |
| `<move-from …>`, `<move-to …>` | Moved text, inside `<move-from-range name="move1">` … `</move-from-range>` and the matching `move-to-range` |
| `<format-change … was="…">` | Run formatting changed (`w:rPrChange`) |
| `changed-by=… was=…` in a `p` comment | Paragraph formatting changed (`w:pPrChange`); tables, rows, cells and sections likewise |
| `mark-ins=…` in a `p` comment | The paragraph mark itself was inserted (or `mark-del`) |
| `<comment id="0">…</comment><comment-ref id="0"/>` | The range a comment is anchored to, and its reference mark |
| `[^1]`, `[^e1]` | Footnote and endnote references |

The **Comments** section gives each comment as a header line (author, initials, date, the text it
is anchored to, `reply-to` and `resolved` from `commentsExtended.xml`) followed by its paragraphs.
The **Footnotes** and **Endnotes** sections use Markdown footnotes, `[^1]: text`, with further
paragraphs indented; Word's separator "notes" are labelled as such.

## Content controls, smart tags and custom XML

- Inline: `<sdt type="date" alias="Signed on" tag="signDate" placeholder-showing date-format="dd/MM/yyyy">…</sdt>`.
- Around blocks: `<!-- sdt type=building-block gallery="Table of Contents" -->` … `<!-- /sdt -->`.
- Types: `text`, `rich-text`, `date`, `drop-down` and `combo-box` (with `options`), `checkbox`
  (with `checked`), `picture`, `building-block`, `citation`, `bibliography`, `equation`, `group`,
  `repeating-section`. Also `id`, `lock`, `placeholder`, `binding` (the data binding's XPath),
  `temporary`, `appearance`, `colour`.
- Smart tags: `<smart-tag element="City" uri="…" prop-country="UK">London</smart-tag>`.
- Custom XML: `<custom-xml element="…" attr-name="…">`.
- Also: `<permission-start id editor group/>`, `<ruby guide="…">`, `<dir val="rtl">`,
  `<subdocument target="…"/>`.

## Sections, headers and footers

```markdown
<!-- section 1 of 2 header-default=word/header1.xml footer-default=word/footer1.xml page="595.3pt x 841.9pt A4 portrait" margins="72pt 72pt 72pt 72pt" header-distance=35.4pt footer-distance=35.4pt columns=2 column-gap=36pt title-page starts=nextPage -->
```

`page` gives the size, the paper name when it is a standard one, and the orientation. `margins` is
top, right, bottom, left. Also `gutter`, `columns`, `column-gap`, `column-widths`,
`column-separator`, `starts` (`nextPage`, `continuous`, `evenPage`, `oddPage`), `title-page`,
`page-numbers`, `vertical-align`, `line-numbers`, `page-border-*`, `grid`, `rtl`, and each header
and footer reference by type (`default`, `first`, `even`).

The **Headers and footers** section shows each header and footer part once, saying which sections
use it for which type, followed by its content.

## Styles

```markdown
<!-- style "Heading 1" id=Heading1 type=paragraph based-on=Normal next=Normal linked="Heading 1 Char" ui-priority=9 q-format -->
<!--   defines paragraph: keep-next keep-lines spacing-before=12pt spacing-after=0pt outline-level=1 | text: font="+headings (Calibri Light)" colour="2F5496 (accent1, shade BF)" size=16pt -->
<!--   resolved paragraph: spacing-before=12pt spacing-after=0pt line-spacing=1.08 keep-next keep-lines outline-level=1 | text: font="+headings (Calibri Light)" size=16pt lang=en-GB … -->
<!--   when firstRow: text: bold colour=FFFFFF | cell: shading=000000 -->
```

Every style the document uses is listed, with the styles they are based on and linked to, and the
default styles. `defines` is what the style itself sets; `resolved` is the result of following the
`basedOn` chain down to the document defaults (shown first, as `document defaults`). Table styles
also list their conditional formatting (`when firstRow`, `when band1Horz`…). Styles used but
missing from `styles.xml` are named. Word's list of latent styles is counted, not listed.

The resolution follows `basedOn` and the document defaults. It does not apply Word's rule that
some on/off properties (bold, italic, caps…) toggle rather than override when a character style
meets a paragraph style; the direct and style formatting are both shown, so the combination can
still be read.

## Document properties and settings

`properties` is everything in `docProps/core.xml` (title, subject, creator, keywords,
description, last-modified-by, revision, created, modified…); `application` is
`docProps/app.xml` (application, pages, words, characters, company, template…);
`custom-properties` is `docProps/custom.xml`.

`settings` lists the settings that change what the document means or how it shows:
`track-revisions`, `protection` (and whether it is enforced), `write-protection`,
`even-and-odd-headers`, `mirror-margins`, `default-tab`, `update-fields-on-open`,
`auto-hyphenation`, `zoom`, `view`, `compatibility-mode`, `template`, `mail-merge`, footnote and
endnote settings, `remove-personal-information` and others. Settings with no effect on content
(revision save ids, proofing state and the like) are named in one line, not described.

## What is deliberately left out

These carry no formatting and would bury the content, so they are not shown (they are still in the
parts, which the Parts pane opens as XML):

- revision save ids (`w:rsid*` attributes) and paragraph and text ids (`w14:paraId`,
  `w14:textId`);
- `w:proofErr` (spelling and grammar marks) and `w:lastRenderedPageBreak` (where Word last broke
  the page, a layout cache);
- the hyperlink `w:history` flag;
- the theme beyond its colours and fonts, the font table and web settings (listed under **Other
  parts**).

## Limits

- A main document part over 30 MB is not rendered; the view says so and the parts can still be
  opened one by one.
- The view never fails as a whole: a part or block that cannot be read becomes
  `<!-- error path=… message -->` followed by its raw XML, and the rest of the view carries on.
  Damaged XML is read as far as it goes, and the view says that it was damaged.
