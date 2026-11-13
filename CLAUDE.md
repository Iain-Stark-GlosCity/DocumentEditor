# DocumentEditor

A Windows 11 desktop document editor. First goal: the best Markdown editor it can be.
Other formats arrive later as extra format providers.

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
