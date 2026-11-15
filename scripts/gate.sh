#!/bin/bash
# The project's gate: lint, typecheck, unit tests, and (with `e2e`) the browser tests.
# Stops at the FIRST failure, prints the relevant lines, and exits non-zero. It only prints
# GATE PASSED when every step succeeded, so `scripts/gate.sh && git push` is safe.
#
# Why a script and not `npm run lint && ... | grep`: piping a check through grep or head hides its
# exit status, and a push then goes ahead on a red build. This script never pipes the check itself.
#
# Usage:  scripts/gate.sh          lint, typecheck, unit tests
#         scripts/gate.sh e2e      the same plus the Playwright browser tests (builds first)
# Several copies of the suite can run at once: give each its own port, E2E_PORT=4205 scripts/gate.sh e2e
cd "$(git rev-parse --show-toplevel)" || exit 1

run() {
  local name="$1"; shift
  local out code
  out=$("$@" 2>&1); code=$?
  if [ $code -ne 0 ]; then
    echo "GATE FAILED: $name"
    echo "$out" | grep -E "error|FAIL|✖|AssertionError|Expected|Received|TS[0-9]+" | head -15
    exit 1
  fi
  echo "ok: $name $(echo "$out" | grep -E 'Tests |passed' | tail -1)"
}

run lint npm run lint
run typecheck npm run typecheck
run unit npm test
if [ "$1" = "e2e" ]; then run e2e npm run test:e2e; fi
echo GATE PASSED
