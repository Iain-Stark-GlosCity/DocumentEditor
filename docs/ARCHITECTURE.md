# Architecture

How DocumentEditor is put together and why. Read `CLAUDE.md` first for the rules that must not be
broken; this document explains the design behind them. For where the project stands see
`STATUS.md`, for what comes next `ROADMAP.md`, and for how it has been built `AGENT-PLAYBOOK.md`.

## What it is

A Windows 11 desktop document editor. It started as "the best Markdown editor it can be" and has
grown into a workbench with pluggable **formats**: Markdown, plain text, JSON, YAML, XML, HTML,
CSV/TSV and DOCX. DOCX is not edited in a word-processor surface. It is **broken down**: a
generated read-only Formatting view shows all of its formatting (like Markdown shows `**bold**`),
every XML part of the file can be opened and edited as text, and an integrity inspector checks the
structure. The idea is to understand and repair what Word actually stores.

Stack: Tauri 2 (Rust shell, WebView2) + React + TypeScript + Vite + CodeMirror 6. Built and
released by GitHub Actions. Windows 11 is the target; the Linux dev container cannot build the
Tauri crate (no WebKitGTK), so CI is the check for the Rust side.

## Layers and rules (summary of CLAUDE.md)

```
src/core/       pure TypeScript: documents, registry, commands, settings, findings, source maps,
                container paths, zip archive, text codec. No React, no Tauri.
src/platform/   the only place that touches the OS: Platform interface, TauriPlatform,
                MemoryPlatform (tests and the browser-only build), ContainerPlatform (decorator).
src/formats/    one folder per format, reached only through the FormatProvider interface.
src/render/     unified (remark/rehype) pipeline, sanitiser, KaTeX/Mermaid/highlight helpers.
src/workbench/  React UI and the Workbench controller; features are plug-ins (see below).
src/styles/     CSS variables for light and dark; forced-colors safe.
src-tauri/      Rust: atomic file IO, encoding detection, watcher, recovery, binary reading.
```

The rules that shape everything: the file on disk is the source of truth (never reformat user
text; the editor buffer is always `\n`); only `src/platform/` imports Tauri; `src/core/` has no
React/Tauri; format code lives in `src/formats/<id>/` and the workbench never imports a format or
knows one by name (a format reaches the app only through the registry); preview HTML is always
sanitised; heavy libraries load with `import()`; every user action is a registered command.

## The central interfaces

### FormatProvider (`src/core/format.ts`)

A format declares what it can do; the workbench follows whatever the active document's format
declares. Fields: `id`, `name`, `fileExtensions`, `viewModes` (`source`/`live`/`split`),
`readOnly` (generated views), `binary` (a text view of a binary file, see containers), `spellcheck`,
`settings` (setting keys whose values are baked into the editor extensions, so the workbench
rebuilds them when those change), `editorExtensions(context)`, `locate(text, locator)`,
`render` (preview HTML), `outline(state)`, `commands` (format commands, each with `enabled`,
`active`, and a `run(view, host)` where `host` can read/write settings and notify), `toolbar` (the
ribbon), `longLineCommand`, `exporters`, `imageSyntax`/`linkSyntax`.

`FormatRegistry` (`src/core/registry.ts`): the first format that claims an extension wins;
`defaultProvider()` is what a new document starts as (Markdown), `fallbackProvider()` is what a
file nobody claims opens as (plain text), `resolve(path)` = claimed-or-fallback. Never rely on
registration order for either. `src/create-registry.ts` is the single place that decides which
formats ship; the main thread and the render worker both call it.

### Platform (`src/platform/platform.ts`)

Everything the app needs from the OS: `readFile`/`writeFile` (text, `\n` in the buffer, the
file's real encoding/BOM/EOL preserved through `FileFormat`), `readBinaryFile`/`writeBinaryFile`
(atomic, with `overwrite`), `copyFile`, `statFile`, `watchFile`, dialogs, drag and drop, recovery
snapshots, settings, `openExternal`, `assetUrl`, and an optional `containers` access. Three
implementations: `TauriPlatform` (Rust commands), `MemoryPlatform` (tests and the browser-only
build, with seeding helpers), and `ContainerPlatform` wrapping either.

### Workbench and features (`src/workbench/`)

`Workbench` (workbench.ts) is a plain-TypeScript controller: platform, registry, documents store,
buffers (one CodeMirror `EditorState` per document), commands, settings, file operations, events,
notifications, quick-pick. React (`App.tsx` and friends) only renders it.

A **feature** (`features/*.ts(x)`, listed once in `features/index.ts`) contributes any of:
`commands`, `editorExtensions`, `reconfigureOn` (settings that rebuild extensions), `statusItems`,
`menuItems` (with `checked`, `radio`, `submenu`), a `sidePane` (left or right, resizable), `overlays`,
and `activate`. Adding a feature touches one new file and one line in `features/index.ts`.
Current features: file/edit/view/tab commands, theme, editor appearance, find (floating widget),
spellcheck, word count, outline, split preview, ribbon, format switcher, read-only handling,
autosave, crash recovery, external-change detection, problems (lint) and status, long-line help,
Parts pane, Integrity pane and status item, Reveal in XML, pane focus cycling, window title.

Format commands are registered as workbench commands, enabled only while a document of that format
is active, and a key bound by two formats (for example Shift-Alt-F for JSON and XML) resolves to
the enabled one. Disabled commands do not swallow their keys.

## Documents, saving and safety

- A document has a path (or none for untitled), a format id, the last text read/written
  (`savedText`), and dirty state derived from the editor buffer. Read-only formats can never be dirty.
- Save is atomic (temp file then rename, in Rust). A stale-save guard compares modification times;
  external changes reload clean documents silently and ask about dirty ones.
- Crash recovery snapshots dirty buffers every few seconds (including the format id) and offers
  restore at startup. Autosave never touches untitled documents or container parts.
- Settings are one typed schema (`src/core/settings.ts`); adding a setting is one line. They persist
  to a JSON file in the app config dir.

## Container files (DOCX and friends)

A zip-based file is treated as a **folder of parts**, not edited through a rich surface.

- **Virtual paths** (`src/core/container-path.ts`): a part opens at
  `C:\docs\report.docx!/word/document.xml` and the rest of the app treats it as an ordinary file
  (title `report.docx › document.xml`).
- **`ContainerPlatform`** (`src/platform/containers.ts`) wraps the real platform so that
  `readFile/statFile/writeFile/watchFile` work for part paths, and for a container root whose
  format has a `binary` view it returns the generated view text (and a source map).
- **Zip layer** (`src/core/archive.ts`, uses `fflate` only for deflate/inflate): reads entries with
  CRC/size checks and zip-bomb guards, and `replace(name, bytes)` returns a new archive in which
  every other entry's local record is copied **byte for byte** and only the central directory is
  rebuilt. It refuses layouts it cannot reproduce exactly (zip64 for patching, junk, data before the
  first entry, gaps). Independently verified against archives written by Python's `zipfile`.
- **Save pipeline for a part** (the heart of the safety story): read the container fresh from disk
  (never a cache), encode the text, refuse ill-formed XML for `.xml`/`.rels` parts (names the line
  and column), patch the archive, **self-check** the patched archive entry by entry against the
  original (names, order, sizes, CRCs, the new part's bytes) and refuse to write on any difference,
  re-check that the file's modification time did not change meanwhile, take a one-off `.bak` copy the
  first time per session (never overwriting an existing `.bak`), then atomic write. Writes per
  container are serialised.
- **Part version tokens**: saving one part changes the container's real modification time, which
  would make every other open part look "changed on disk". So a part's `modifiedMs` is a token that
  only changes when that part's own content (CRC/size) changes.
- **Read-only generated views**: a format with `binary: { archive: "zip", decode, inspect? }` and
  `readOnly: true` (DOCX today). Saving over the original from the view is refused; Save As writes a
  text copy and the format switcher re-resolves the document to an editable format.
- **Source maps and locators**: `decode` may return `{ text, sourceMap }`. A map entry ties a line
  range of the view to `{ part, locator }`. A locator is an XPath-like path of qualified names **as
  written in the part**, with a 1-based position among same-named siblings (omitted when the element
  is the only one of its name): `/w:document/w:body/w:p[12]`. The XML format's `locate(text,
  locator)` finds it again in raw or tidied text. "Reveal in source XML" (Ctrl+Alt+X) and every
  integrity finding use this one mechanism through `Workbench.revealPart(path, locator)`.
- **Findings** (`src/core/findings.ts`): `{ id, rule, severity, family, title, why, locations,
  facts }`. A privacy-safe report (`formatFindingsReport`) contains rule codes, severities, counts and
  locations only, never titles, explanations, string facts or document text.

### DOCX specifics (`src/formats/docx/`)

- `xml.ts`: own tolerant, order-preserving XML scanner (never throws, keeps source offsets,
  canonicalises namespaces, keeps each element's written name for locators).
- `view.ts`, `render.ts`, `inline.ts`, `props.ts`, `styles.ts`, `numbering.ts`, ...: the Formatting
  view generator. Notation documented in `docs/docx-view.md`. Direct formatting is shown where
  applied; styles by name, with implied styles (a hyperlink style on a link, and so on) omitted but
  listed in the Styles section; a resolved-styles appendix; anything not understood becomes a visible
  `<!-- raw ... -->` placeholder with its XML, so nothing is hidden.
- `inspect/`: the integrity inspector, about 60 rules in families package, styles, numbering,
  sections, formatting, revisions/comments/notes. Catalogue in `docs/docx-integrity.md`. Pure,
  conservative (clean documents produce notes only), stable ids, never throws.
- The Integrity pane (`features/integrity.tsx`, `integrity-controller.ts`) runs the inspector in the
  background shortly after a container opens (setting `integrity.autoCheck`) and again after saves
  or disk changes; the status bar shows the summary.

## Formats at a glance

| id | extensions | modes | notable |
|---|---|---|---|
| markdown | md, markdown, mdown, mkd | source, live, split | live-preview mode, smart typing, tables, ribbon, image paste/drop, outline, math/Mermaid/highlight in preview |
| text | txt, text, log (and the fallback) | source | |
| json | json, jsonc, geojson | source | lint (comments/trailing commas are warnings in `.json`), whitespace-only Format/Minify, ribbon |
| yaml | yaml, yml | source | lint via the `yaml` package |
| xml | xml, rels, xsd, xsl, xslt | source | well-formedness lint, whitespace-only Tidy, `locate`, long-line help |
| html | html, htm | source, split | simplified sanitised preview, outline |
| csv | csv, tsv | source, split | column colouring, table preview, delimiter cycling |
| docx | docx, docm, dotx, dotm | source (read-only) | Formatting view, Parts pane, Reveal in XML, integrity inspector, outline |

## Preview pipeline

Rendering runs in a Web Worker (`src/workbench/preview/render.worker.ts`), debounced, with stale
renders discarded and a fallback to in-thread rendering if the worker fails. The DOM is updated by
block diff so scroll position holds; `data-line` attributes give two-way scroll sync. All HTML is
sanitised (rule 5). Markdown uses remark/rehype with an allow-list schema; HTML uses a stricter
one; CSV builds its table safe by construction (every piece of cell text escaped). Do not weaken
the CSP (`script-src 'self'`) for any feature.

## Testing architecture

- **Unit** (vitest, jsdom): co-located `*.test.ts(x)`, plus `tests/` for cross-cutting ones (CommonMark
  and GFM spec conformance with an explicit known-failures list, performance bounds, live settings).
  Tests that need a fixed set of formats build their own registry, never `createRegistry()`.
- **Browser** (Playwright against the production build served by `vite preview`, `npm run
  test:e2e`, `E2E_PORT` for parallel runs): `tests/e2e/fixtures.ts` gives `app`, `openFile`,
  `setDocument`. The browser-only build exposes `window.__demoPlatform` (the inner MemoryPlatform) and
  `window.__demoRegistry` so tests can seed files and binary files; the desktop app never sets them.
  Every test asserts there are no console errors or CSP violations.
- **Rust**: pure modules are unit-tested with `cargo test` in CI and standalone; `cargo check
  --target x86_64-pc-windows-msvc` works in the Linux container as a type check.
- **CI** (`.github/workflows/ci.yml`): job `frontend` (lint, typecheck, unit, Playwright) and job
  `windows` (`cargo test`, `tauri build`, uploads the NSIS installer as an artifact).
- `scripts/gate.sh [e2e]` is the local equivalent and must print GATE PASSED before any push.
