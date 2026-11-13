# DocumentEditor

A Windows 11 desktop document editor, starting with Markdown. Tauri 2 (Rust) shell, React +
TypeScript + Vite front end, CodeMirror 6 editor. See `CLAUDE.md` for the architecture rules.

## Run

```sh
npm install
npm run dev              # front end in a plain browser, with an in-memory sample file
npm run tauri -- dev     # the desktop app (needs the Tauri prerequisites and Rust)
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
`cargo test --manifest-path src-tauri/Cargo.toml` for the Rust side.

## CI

`.github/workflows/ci.yml` runs on every push and pull request. The `frontend` job lints,
typechecks and tests on Ubuntu. The `windows` job runs the Rust tests, builds the NSIS installer
with `npm run tauri -- build` and uploads it as the `DocumentEditor-windows-installer` artifact.
