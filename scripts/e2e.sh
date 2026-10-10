#!/usr/bin/env bash
# Entry point for the e2e npm scripts: `scripts/e2e.sh run|setup|seed|clean [args]`.
# Needs a built tree (npm run build) and a system Chrome. State lives in ~/.config/agent-gateway/e2e.
set -euo pipefail
cd "$(dirname "$0")/.."
cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  run) exec node --max-old-space-size=2048 node_modules/tsx/dist/cli.mjs e2e/run.ts "$@" ;;
  setup) exec node --max-old-space-size=2048 node_modules/tsx/dist/cli.mjs e2e/setup/setup.ts "$@" ;;
  seed) exec node --max-old-space-size=2048 node_modules/tsx/dist/cli.mjs e2e/fixtures/seed.ts "$@" ;;
  clean) exec node --max-old-space-size=2048 node_modules/tsx/dist/cli.mjs e2e/fixtures/clean.ts "$@" ;;
  *) echo "usage: scripts/e2e.sh run|setup|seed|clean [args]" >&2; exit 2 ;;
esac
