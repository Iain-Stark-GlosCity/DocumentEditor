<!-- Formatting view of a Word document: generated and read-only. Full legend: docs/docx-view.md -->
<!-- Markdown shows headings, lists, **bold**, *italic*, ~~strike~~, [links](url), footnotes [^1] and simple tables. -->
<!-- Tags show the rest: <span font=".." size=".." colour="..">, <u>, <sup>, <sub>, <ins>, <del>, <field>, <drawing>. -->
<!-- A "p" comment ends each paragraph that has a style or direct formatting. Lengths are in points (pt). -->
<!-- Visible tokens: <tab/> <br/> <nbsp/> <sp/> (spaces at either end). A "raw" comment is XML shown as it is. -->
<!-- Styles are named where used; their resolved definitions are in the Styles section at the end. -->

<!-- properties title="Quarterly report" creator="Jane Smith" description="A sample with most kinds of formatting" last-modified-by="Jane Smith" revision=3 created=2024-05-01T10:00:00Z modified=2024-05-01T10:00:00Z -->

<!-- settings show-background track-revisions default-tab=36pt even-and-odd-headers=off compatibility-mode=15 -->

<!-- section 1 of 1 header-default=word/header1.xml header-first=word/header2.xml footer-default=word/footer1.xml page="595.3pt x 841.9pt A4 portrait" margins="72pt 72pt 72pt 72pt" header-distance=35.4pt footer-distance=35.4pt page-numbers=default title-page grid="linePitch=360" -->

Quarterly report <!-- p style=Title -->

# Introduction <!-- p style="Heading 1" -->

Sales rose **12%** in the quarter<span style="Footnote Reference">[^1]</span>, led by *new markets*. <span colour="C00000">Red text</span>, <span highlight="yellow">highlighted</span>, <span font="Courier New" size="9pt">Courier 9pt</span>, <u type="double" colour="0000FF">double underline</u>, H<sub>2</sub>O and E=mc<sup>2</sup>, ~~struck~~, <span small-caps>small caps</span>.

Literal characters: 2 \* 3 = 6, file_name, \<tag>, \[x\], \# not a heading, a<tab/>tab, a line<br/>break and a non-breaking<nbsp/>space. <!-- p keep-next spacing-before=12pt spacing-after=6pt line-spacing=1.5 indent-left=36pt hanging=18pt align=justify -->

<comment id="0">Revenue was 4.2 million.</comment><comment-ref id="0"/> See [<span style="Hyperlink">the full report</span>](https://example.com/report) and [<span style="Hyperlink">the results</span>](#results).

<ins id="1" author="Ravi Patel" date="2024-05-02T09:00:00Z">Inserted words</ins> and <del id="2" author="Ravi Patel" date="2024-05-02T09:05:00Z">deleted words</del>.

## Steps <!-- p style="Heading 2" -->

1. Gather the data <!-- p style="List Paragraph" list=2 level=1 -->

   a) From sales <!-- p style="List Paragraph" list=2 level=2 numbering=a) -->

      i. Weekly figures <!-- p style="List Paragraph" list=2 level=3 numbering=i. -->

   b) From finance <!-- p style="List Paragraph" list=2 level=2 numbering=b) -->

2. Write the report <!-- p style="List Paragraph" list=2 level=1 -->

- Risks <!-- p style="List Paragraph" list=3 level=1 -->

  - Supply <!-- p style="List Paragraph" list=3 level=2 -->

A note in a custom style. <!-- p style=Note -->

## Results<bookmark name="results"/> <!-- p style="Heading 2" -->

<!-- table width=450pt borders="single 0.5pt auto" borders-inside="single 0.5pt auto" grid="150pt 150pt 150pt" header=repeat cell-widths="150pt 150pt 150pt" -->
| Region | Q1 | Q2 |
| --- | --- | --- |
| North | 1.2 | 1.4 |
| South | 0.9 | 1.1 |

<!-- p empty -->

<table width="auto" borders="single 0.5pt auto" borders-inside="single 0.5pt auto" grid="150.45pt 150.45pt 150.45pt">
  <tr>
    <td colspan="2" shading="D9E2F3">**Merged across**</td>
    <td rowspan="2" valign="centre">Merged down</td>
  </tr>
  <tr>
    <td>A</td>
    <td>B</td>
    <!-- merged into the cell above -->
  </tr>
</table>

<drawing kind="picture" name="Logo" title="Logo" width="72pt" height="36pt" placement="inline">![The company logo](word/media/image1.png)</drawing> Figure 1: the logo.

<br type="page"/>

# Conclusion <!-- p style="Heading 1" -->

A quotation from the board. <!-- p style=IntenseQuote -->

<!-- ==== Footnotes ==== -->

<!-- footnote -1 type=separator (Word's separator line, not a note) -->
<span style="Footnote Reference"><note-number/></span><separator/> <!-- p spacing-after=0pt line-spacing=1 -->

<!-- footnote 0 type=continuationSeparator (Word's separator line, not a note) -->
<span style="Footnote Reference"><note-number/></span><continuation-separator/> <!-- p spacing-after=0pt line-spacing=1 -->

[^1]: <span style="Footnote Reference"><note-number/></span>Source: internal sales data, unaudited.

<!-- ==== Endnotes ==== -->

<!-- endnote -1 type=separator (Word's separator line, not a note) -->
<span style="Endnote Reference"><note-number/></span><separator/> <!-- p spacing-after=0pt line-spacing=1 -->

<!-- endnote 0 type=continuationSeparator (Word's separator line, not a note) -->
<span style="Endnote Reference"><note-number/></span><continuation-separator/> <!-- p spacing-after=0pt line-spacing=1 -->

<!-- ==== Comments ==== -->

<!-- comment id=0 author="Ravi Patel" initials=RP date=2024-05-01T10:00:00.000Z on="Revenue was 4.2 million." -->

Is this figure final?

<!-- ==== Headers and footers ==== -->

<!-- word/header1.xml: section 1 header default -->

Quarterly report<tab/>Page <field code="PAGE"></field>

<!-- word/header2.xml: section 1 header first -->

Confidential

<!-- word/footer1.xml: section 1 footer default -->

Acme Ltd <!-- p align=centre -->

<!-- ==== Styles ==== -->

<!-- styles used but not defined in styles.xml: IntenseQuote -->

<!-- style "Normal" id=Normal type=paragraph default q-format -->

<!-- style "Normal Table" id=TableNormal type=table default ui-priority=99 semi-hidden unhide-when-used -->
<!--   defines table: indent=0pt cell-margin-top=0pt cell-margin-left=5.4pt cell-margin-bottom=0pt cell-margin-right=5.4pt -->

<!-- style "Title" id=Title type=paragraph based-on=Normal next=Normal q-format -->
<!--   defines text: size=28pt -->

<!-- style "Heading 1" id=Heading1 type=paragraph based-on=Normal next=Normal q-format -->
<!--   defines text: colour=2E74B5 size=16pt -->

<!-- style "Heading 2" id=Heading2 type=paragraph based-on=Normal next=Normal q-format -->
<!--   defines text: colour=2E74B5 size=13pt -->

<!-- style "List Paragraph" id=ListParagraph type=paragraph based-on=Normal q-format -->

<!-- style "Hyperlink" id=Hyperlink type=character based-on=DefaultParagraphFont ui-priority=99 unhide-when-used -->
<!--   defines text: colour=0563C1 underline=single -->

<!-- style "Footnote Reference" id=FootnoteReference type=character based-on=DefaultParagraphFont ui-priority=99 semi-hidden unhide-when-used -->
<!--   defines text: vertical=superscript -->

<!-- style "Endnote Reference" id=EndnoteReference type=character based-on=DefaultParagraphFont ui-priority=99 semi-hidden unhide-when-used -->
<!--   defines text: vertical=superscript -->

<!-- style "Note" id=Note type=paragraph based-on=Normal next=Normal q-format -->
<!--   defines paragraph: spacing-before=6pt spacing-after=6pt indent-left=36pt | text: italic colour=595959 size=10pt -->

<!-- ==== Lists ==== -->

<!-- list 2 definition=2 type=hybridMultilevel -->
<!--   level 1 format=decimal text=%1. start=1 start-override=1 align=left -->
<!--   level 2 format=lowerLetter text=%2) start=1 start-override=1 align=left -->
<!--   level 3 format=lowerRoman text=%3. start=1 start-override=1 align=left -->

<!-- list 3 definition=3 type=hybridMultilevel -->
<!--   level 1 format=bullet text=• start=1 start-override=1 align=left -->
<!--   level 2 format=bullet text=◦ start=1 start-override=1 align=left -->

<!-- ==== Other parts ==== -->

<!-- theme word/theme/theme1.xml: headings-font="Calibri Light" body-font="Calibri" dk1=000000 lt1=FFFFFF dk2=44546A lt2=E7E6E6 accent1=4472C4 accent2=ED7D31 accent3=A5A5A5 accent4=FFC000 accent5=5B9BD5 accent6=70AD47 hlink=0563C1 folHlink=954F72 -->

<!-- not shown in this view (open them in the Parts pane): word/fontTable.xml -->
