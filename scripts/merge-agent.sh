#!/bin/bash
# Merges a sub-agent's worktree branch into the current branch.
#
# Usage:  scripts/merge-agent.sh <agent-id> "<merge commit title>"
#   <agent-id> is the id in the worktree path .claude/worktrees/agent-<agent-id>; the branch is
#   worktree-agent-<agent-id>.
#
# Conflicts in the shared registration files (create-registry.ts, features/index.ts, main.tsx CSS
# imports, settings schema lines, package.json dependency lists) are almost always two lines added
# side by side, so this script resolves them by KEEPING BOTH SIDES, prints every resolved hunk so
# you can review it, and then completes the merge commit. That is NOT safe for logic conflicts:
# review the printed hunks, and run scripts/gate.sh afterwards. package-lock.json must never be
# merged textually: when it conflicts, run
#     git checkout --ours package-lock.json && npm install --no-audit --no-fund
# and then commit.
#
# Optional: MERGE_TRAILER="Co-Authored-By: ..." adds a trailer line to the merge commit.
cd "$(git rev-parse --show-toplevel)" || exit 1
BRANCH="worktree-agent-$1"
MSG="$2"
[ -n "$MERGE_TRAILER" ] && MSG="$MSG

$MERGE_TRAILER"

git merge --no-ff "$BRANCH" -m "$MSG" >/dev/null 2>&1
UNRESOLVED=$(git diff --name-only --diff-filter=U)
if [ -n "$UNRESOLVED" ]; then
  echo "CONFLICTS: $UNRESOLVED"
  python3 - $UNRESOLVED <<'PY'
import re, sys
pattern = re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', re.S)
for path in sys.argv[1:]:
    text = open(path).read()
    for m in pattern.finditer(text):
        print(f"--- {path}\nOURS:\n{m.group(1)}THEIRS:\n{m.group(2)}")
    open(path, 'w').write(pattern.sub(lambda m: m.group(1) + m.group(2), text))
PY
  echo "(auto-resolved keeping both sides; REVIEW the hunks above)"
  if [ -f .git/MERGE_HEAD ]; then
    git add -A && git commit -q --no-edit && echo "(merge commit completed)"
  fi
fi
if [ -f .git/MERGE_HEAD ]; then echo "MERGE STILL OPEN: resolve and commit before pushing"; exit 1; fi
