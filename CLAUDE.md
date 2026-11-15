# DocumentEditor

A Windows 11 desktop document editor. First goal: the best Markdown editor it can be.
Other formats arrive later as extra format providers.

## Where to start

Read these before changing anything substantial:

- `docs/ARCHITECTURE.md` how the pieces fit (interfaces, containers, safe save, testing).
- `docs/STATUS.md` what works, what is unverified, known rough edges, parked decisions.
- `docs/ROADMAP.md` what to do next.
- `docs/AGENT-PLAYBOOK.md` how work is delegated to sub-agents, merged and gated.
- `docs/docx-view.md` and `docs/docx-integrity.md` the DOCX Formatting view and the inspector rules.

Scripts: `scripts/gate.sh [e2e]` (lint, typecheck, tests; must print GATE PASSED before any push) and
`scripts/merge-agent.sh <agent-id> "<title>"`. Never pipe a check into `grep` in an `&&` chain.

Container files (DOCX and other zips): never patch a cached copy, never re-zip (untouched entries
are copied byte for byte), self-check before writing, refuse ill-formed XML, keep the one-off
`.bak`, and never write a generated read-only view over the original. Details in the playbook.

## Stack

- Shell: Tauri 2 (Rust) in `src-tauri/`. Target is Windows 11 (WebView2). Built on GitHub Actions.
- Front end: React + TypeScript + Vite in `src/`. Package manager: npm.
- Editor: CodeMirror 6. Rendering/export: unified (remark + rehype).
- State: zustand. Tests: vitest (+ jsdom). Lint: eslint + prettier.

## Rules that must not be broken

1. **The file on disk is the source of truth.** Never reformat or re-serialise the user's text.
   Encoding, BOM and line endings are detected on open and written back unchanged on save.
   The editor buffer always uses `\n`; conversion happens only at the platform boundary.
2. **Only `src/platform/` may import `@tauri-apps/*`.** Everything else talks to the `Platform`
   interface (`src/platform/platform.ts`). Tests use `MemoryPlatform`.
3. **`src/core/` imports no React and no Tauri.** It is plain TypeScript and fully unit tested.
4. **Format-specific code lives in `src/formats/<id>/`** and reaches the app only through the
   `FormatProvider` interface (`src/core/format.ts`). The workbench never imports from a format
   folder directly, only from the registry.
5. Rendered preview HTML is always sanitised. No remote scripts. Strict CSP.
6. Heavy libraries (KaTeX, Mermaid, Shiki) are loaded with dynamic `import()` only when needed.
7. Every user action is a registered command (id, title, default keybinding) so the command
   palette and keybinding editor see it.

## Layout

```
src/
  core/         document model, FormatProvider, registry, commands, settings (no React/Tauri)
  platform/     Platform interface, TauriPlatform, MemoryPlatform (the only Tauri caller)
  formats/
    markdown/   the Markdown provider: editor extensions, commands, outline
  render/       unified pipeline: Markdown -> sanitised HTML with source line positions
  workbench/    React UI: tabs, panes, status bar, command palette, dialogs
  styles/       theme tokens (CSS variables), light and dark
src-tauri/      Rust: file IO (atomic save, encoding detection), watcher, recovery, windowing
tests/          fixtures and cross-cutting tests (round-trip, spec conformance)
```

## Scripts (keep these names; CI depends on them)

`npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run tauri -- build`.

## Conventions

- TypeScript strict. No `any` without a comment saying why.
- Co-locate unit tests as `*.test.ts(x)` next to the code.
- British English in user-facing text. Sentence case for labels.
- Accessibility is a requirement: full keyboard operation, visible focus, ARIA roles on custom
  widgets, respects high contrast and reduced motion.
- The Rust side cannot be compiled in the Linux dev container (no WebKitGTK). Windows CI is the
  check for Rust code, so keep Rust small, simple and unit tested with `cargo test` where the
  logic is pure (put pure logic in modules that do not depend on `tauri`).

## Adding a format

A format is a folder under `src/formats/<id>/` that exports a `TextFormatProvider` (see
`src/core/format.ts`). Copy `src/formats/plain-text/` for the smallest example and
`src/formats/csv/` or `src/formats/html/` for one with a preview.

- Register it with one import and one line in `src/create-registry.ts`. The first format that
  claims an extension wins. `markdown` is the default for new documents and `text` is the fallback
  for files nobody claims; never rely on registration order for either.
- Load a CodeMirror language through `lazyLanguage` (`src/formats/shared/lazy-language.ts`) and
  anything heavy through `import()`, so it stays out of the startup bundle. Note the render worker
  builds the same registry, so a format's editor code also lands in the worker bundle.
- Set `spellcheck: false` for data and code. Give it `outline`, `render`, `commands` and `toolbar`
  only if it has them; the workbench follows whatever the active document's format declares.
- Preview HTML is always sanitised (rule 5). Either run it through the shared sanitiser or build it
  so it is safe by construction (escape every piece of user text) and test that.
- Tests: unit tests beside the code, and a browser test in `tests/e2e/<id>.spec.ts` that opens a
  file with `openFile` from `tests/e2e/fixtures.ts`. Tests that need a fixed set of formats must
  build their own registry, not use `createRegistry()`, so adding a format cannot break them.
- Browser tests run against the production build: `E2E_PORT=<port> npm run test:e2e`. Use your own
  port when several copies of the suite run at once.

