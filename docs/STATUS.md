# Status

Snapshot of where the project stands (15 Nov 2026). Update this file whenever a milestone lands.

## Build state

- Branch `claude/vigilant-noether-u945vp`; last CI run (43) passed on Windows, producing the NSIS
  installer artifact `DocumentEditor-windows-installer`.
- About 2,120 unit tests (one skipped) across ~100 files, 44 Playwright browser tests.
- The installer is **unsigned**: Windows Smart App Control blocks it on some machines until the
  user opts out or the app is code-signed.

## What works

- Markdown: source, live preview and split modes; tables; smart editing commands; ribbon; image
  paste/drop; outline; sanitised preview with math, Mermaid and highlighting loaded on demand.
- Plain text, JSON (lint, Format/Minify), YAML, XML (lint, Tidy, locate), HTML (sanitised preview),
  CSV/TSV (column colours, table preview).
- DOCX: read-only Formatting view, Parts pane, edit any XML part with a safe save (verified, backed
  up, atomic), Reveal in source XML, integrity inspector (about 60 rules, runs automatically).
- Explain this paragraph (Ctrl+Alt+E): effective indent, spacing and alignment of the paragraph at
  the cursor, the layer that decided each value, what it overrode, and a jump to that layer's XML.
  Covers document defaults, list level, style chain and direct formatting; table styles and
  character-unit indents are noted, not resolved. List-from-style precedence is flagged uncertain.
  Three repairs: remove the paragraph's own indent, spacing or alignment
  (an edit in the XML tab, undoable, saved through the verified path).
- Two resolver-based integrity rules: `formatting.indent-overrides-list` (info) and
  `formatting.extreme-indent` (warning).
- Find widget, command palette, autosave, crash recovery with format kept, external-change
  detection, themes, zen mode, spellcheck, word count, split-pane layouts.

## Verified and unverified

Verified here (Linux container, browser tests, Python zip tools): archive round trips, patching,
integrity findings click-through, every unit and e2e test.

**Not yet verified on a real Windows machine with real Word files** (the user is testing):
real `.docx` round trip opened in Word afterwards, crash recovery keeping the format,
tsconfig.json lint warnings, drag and drop from Explorer, screenshot paste, external file
changes, spellcheck underlines.

Three integrity rules are flagged as uncertain until checked against real documents:
`styles.duplicate-name`, `revisions.duplicate-id`, `formatting.invisible-text`.

## Known rough edges

- Typing can lag on very long single lines (the XML/JSON Tidy offer mitigates it).
- Binary parts: pictures are previewed (up to 8 MB) and any binary part can be saved as a copy; fonts and
  metafiles (EMF/WMF) are described but not previewed.
- The render worker bundle includes every format's editor code.
- Tab traps focus in code formats (Escape then Tab leaves the editor).
- `text-stats` has a timing-based test (1 MB in 2 s) that can be flaky on slow machines.
- DOCX decode, inspect and explain run in a Web Worker; the zip is still read fully in memory.
- Markdown editing and live preview have areas that need human testing.

## Parked decisions

- **AI sign-in (Claude / ChatGPT).** Anthropic forbids third-party apps from handling claude.ai
  logins (using the user's own signed-in Claude Code, or API keys, is fine). OpenAI offers
  "Sign in with ChatGPT" for open-source or locally hosted apps. Plan was Phase 1 a terminal pane for
  both tools; Phase 2 native ChatGPT only if the project is open-sourced. Parked by the user.
- **Open-source or licence** decision, and **code signing** and installer file associations.
- **Office-suite direction** (XLSX/PPTX views, an editable CSV grid) is an idea, not a commitment.
