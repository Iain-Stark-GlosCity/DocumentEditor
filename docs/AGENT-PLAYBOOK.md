# Agent playbook

How this project has been built: a strong model as architect and orchestrator, cheaper models as
coders in git worktrees. Follow this when continuing.

## Roles

- **Architect/orchestrator** (the main session): designs interfaces, writes the brief, reviews and
  merges. Keep it for broad decisions, not routine edits.
- **Coders** (Haiku/Sonnet for well-specified tasks, Opus for hard parts such as the zip patcher or
  the inspector rules): each gets an isolated worktree, a precise brief, and the rules from
  `CLAUDE.md`.

## A good brief

State the goal, the files to touch, the interfaces to honour, the tests expected (unit plus e2e) and
what not to do (do not change `core` APIs, do not import Tauri outside `src/platform/`, do not
reformat user text). Ask for the gate to pass before handing back.

## Gate and merge

- `scripts/gate.sh` runs lint, typecheck and unit tests (`scripts/gate.sh e2e` adds Playwright). It
  prints GATE PASSED only on success. Never push without it.
- `scripts/merge-agent.sh <agent-id> "<title>"` merges `worktree-agent-<id>` with `--no-ff`,
  keeps both sides of conflicting hunks (and prints them for review) and completes the commit.
  For `package-lock.json` conflicts: `git checkout --ours package-lock.json && npm install
  --no-audit --no-fund`.
- Sub-agents often cannot commit (the permission classifier refuses). The orchestrator reviews the
  changed files and commits. Do not ask agents to work around it.
- If an agent hits a usage limit, resume it with SendMessage rather than starting over.

## Lessons learned

- Never pipe a check into `grep` inside an `&&` chain: it hides the failing exit code.
- Tests that need a fixed set of formats must build their own registry.
- Test in a real browser: it found worker bundling bugs, Escape handling and key clashes that unit
  tests could not.
- Check `git status` for an open merge before pushing.
- The Rust side cannot compile here; keep it small and pure, and let Windows CI check it.
- Hand-built XML element objects in tests need every field of the type (for example `rawName`).

## Container-file safety rules (never relax)

1. Read the container fresh from disk before every save; never patch a cached copy.
2. Patch surgically: untouched entries copied byte for byte; refuse layouts that cannot be
   reproduced exactly.
3. Self-check the patched archive against the original before writing.
4. Refuse ill-formed XML for XML parts.
5. Check the modification time again before the atomic write; take a one-off `.bak` first.
6. Generated views are read-only; never write one over the original file.
7. Privacy-safe reports contain rule codes, counts and locations only, never document text.
