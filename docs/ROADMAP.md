# Roadmap

Ordered by what to do next. Nothing here is started unless `STATUS.md` says so.

## Current milestone (started 15 Nov 2026)

Done: steps 1 to 5 below (resolver in `src/formats/docx/explain.ts`, Explain pane Ctrl+Alt+E via
`BinaryView.explain`, inspector rules in `inspect/rules-paragraphs.ts`, the "Remove this paragraph's
own indent" repair, which edits the open XML part so it is undoable and saves through the verified
path), and DOCX decode, inspect and explain run in a Web Worker (`worker-client.ts`, with an
in-thread fallback). Next: more repairs and real-document testing.

**Effective paragraph formatting: "why does this paragraph look like that?"**

Word's real problem is that what you see comes from layers: document defaults, style chain,
numbering level, direct formatting, table style. The inspector currently reports local oddities;
this milestone resolves the whole stack.

1. A resolver in `src/formats/docx/` that computes the effective value of a paragraph property
   (indentation first, then spacing, alignment, line spacing) and records which layer each came
   from, with honest uncertainty where precedence is ambiguous. Show values in points and cm.
2. An "Explain this paragraph" panel: select a line in the Formatting view and see the layered
   result and the winning source (with Reveal in XML for each layer).
3. Resolver-powered findings (for example "indent comes from the list level, not the paragraph").
4. One narrow, guarded repair (for example clear direct indent) shown as a diff preview and saved
   through the existing verify + backup pipeline.
5. Move DOCX decode and inspect into a Web Worker.

Ask the user for a real problem paragraph (Word's Paragraph dialog values, style, list or not) to
build a synthetic fixture from.

## After that

- Real-document testing round: fix inspector false positives found on user files.
- Binary part preview and extract (images, fonts) in the Parts pane.
- More repairs, each narrow, previewed, verified and backed up.
- Format candidates: ODT and EPUB reuse the container machinery; XLSX/PPTX read-only views;
  an editable grid for CSV as a pilot for a structured (non-text) provider kind.
- Installer: code signing, file associations, auto-update.
- Performance: long-line typing, trimming the render worker bundle.

## Parked

- AI sign-in and assistants acting on files (see `STATUS.md`).
- Open-sourcing and licence choice.
