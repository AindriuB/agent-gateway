#!/usr/bin/env bash
# MCP conformance over stdio: `scripts/conformance.sh`. Needs a built tree (npm run build).
# Starts the gateway under the MCP Inspector CLI with a fake Foundry module attached to the
# link, then runs tools/list and one tools/call that round-trips through the link.
# Uses a temp HOME, a temp database and a non-default link port; ~/.foundry-agent-gateway
# is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

INSPECTOR_VERSION="2.10.1"
LINK_PORT="${CONFORMANCE_LINK_PORT:-17420}"
[ -f gateway/dist/bin/cli.js ] || { echo "conformance: run npm run build first" >&2; exit 2; }

REAL_HOME="$HOME"
work="$(mktemp -d)"
module_pid=""
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for f in pair.log module.log gateway.log; do
      [ -s "$work/$f" ] && { echo "--- conformance: $f ---" >&2; cat "$work/$f" >&2; }
    done
  fi
  if [ -n "$module_pid" ]; then kill "$module_pid" 2>/dev/null || true; wait "$module_pid" 2>/dev/null || true; fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

export HOME="$work/home"
mkdir -p "$HOME"
# npx keeps using the real npm cache; only the gateway and inspector state move to the temp HOME.
export npm_config_cache="${npm_config_cache:-$REAL_HOME/.npm}"

tsx=(node --import tsx gateway/test/conformance/fake-module.ts)
db="$work/gateway.db"
token="$work/token"
ready="$work/ready"

"${tsx[@]}" pair "$db" "$LINK_PORT" "$token" 2>"$work/pair.log"
"${tsx[@]}" serve "$LINK_PORT" "$token" "$ready" 2>"$work/module.log" &
module_pid=$!

# The inspector hands the server only a minimal environment, so port and database go as -e.
inspect() {
  rm -f "$ready" # a stale file from the previous gateway must not release the wrapper
  npx -y "@modelcontextprotocol/inspector@$INSPECTOR_VERSION" --cli \
    node gateway/test/conformance/gateway-wrapper.mjs gateway/dist/bin/cli.js "$@" \
    -e "AGENT_GATEWAY_LINK_PORT=$LINK_PORT" -e "AGENT_GATEWAY_DB=$db" \
    -e "CONFORMANCE_READY_FILE=$ready" 2>"$work/gateway.log"
}

# gateway-wrapper.mjs holds the request until the fake module has announced its tools.
list="$(inspect --method tools/list)"
grep -q '"demo-echo"' <<<"$list" || { echo "conformance: tools/list missing demo-echo" >&2; exit 1; }
for t in events_poll events_history; do
  grep -q "\"$t\"" <<<"$list" || { echo "conformance: tools/list missing $t" >&2; exit 1; }
done
grep -q '"actor_summary"' <<<"$list" || { echo "conformance: tools/list missing core tools" >&2; exit 1; }

call="$(inspect --method tools/call --tool-name demo-echo --tool-arg value=conformance)"
grep -q 'echo:conformance' <<<"$call" || { echo "conformance: tools/call did not round-trip" >&2; exit 1; }

[ ! -e "$HOME/.foundry-agent-gateway" ] || { echo "conformance: default store was created" >&2; exit 1; }
echo "conformance: ok (inspector $INSPECTOR_VERSION, stdio)"
