#!/usr/bin/env bash
# MCP conformance over stdio, local Streamable HTTP, then OAuth on a --public-url gateway: `scripts/conformance.sh`. Needs a built tree (npm run build).
# Starts the gateway under the MCP Inspector CLI with a fake Foundry module attached to the
# link, then runs tools/list and one tools/call that round-trips through the link.
# Uses a temp HOME, a temp database and a non-default link port; ~/.foundry-agent-gateway
# is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

INSPECTOR_VERSION="2.10.1"
LINK_PORT="${CONFORMANCE_LINK_PORT:-17420}"
HTTP_PORT="${CONFORMANCE_HTTP_PORT:-17421}"
[ -f gateway/dist/bin/cli.js ] || { echo "conformance: run npm run build first" >&2; exit 2; }

REAL_HOME="$HOME"
work="$(mktemp -d)"
module_pid=""
gateway_pid=""
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for f in pair.log module.log gateway.log; do
      [ -s "$work/$f" ] && { echo "--- conformance: $f ---" >&2; cat "$work/$f" >&2; }
    done
  fi
  if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi
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
"${tsx[@]}" serve "$LINK_PORT" "$token" "$ready" "$work/consent-code" 2>"$work/module.log" &
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

# --- local HTTP mode: the real gateway with --http, driven by the inspector over the URL ---
rm -f "$ready"
mkfifo "$work/stdin"
exec 3<>"$work/stdin" # holds the gateway's stdin open; it exits when the script does
node gateway/dist/bin/cli.js --http --http-port "$HTTP_PORT" --link-port "$LINK_PORT" --db "$db" \
  <"$work/stdin" >/dev/null 2>"$work/gateway.log" &
gateway_pid=$!
http_token=""
for _ in $(seq 1 300); do
  http_token="$(sed -n 's/^HTTP bearer token[^:]*: \([0-9a-f]\{64\}\)$/\1/p' "$work/gateway.log" | head -n1)"
  [ -n "$http_token" ] && grep -q "MCP HTTP at" "$work/gateway.log" && break
  kill -0 "$gateway_pid" 2>/dev/null || { echo "conformance: http gateway exited early" >&2; exit 1; }
  sleep 0.1
done
[ -n "$http_token" ] || { echo "conformance: http gateway never printed its token" >&2; exit 1; }
# the fake module reconnects to the new primary and announces its tools
for _ in $(seq 1 150); do [ -e "$ready" ] && break; sleep 0.1; done
[ -e "$ready" ] || { echo "conformance: fake module never reconnected for http" >&2; exit 1; }
url="http://127.0.0.1:$HTTP_PORT/mcp"
# shellcheck source=scripts/lib/inspector-retry.sh disable=SC1091
. scripts/lib/inspector-retry.sh
inspect_http() {
  retry_429 "$work/gateway.log" npx -y "@modelcontextprotocol/inspector@$INSPECTOR_VERSION" --cli "$url" --transport http \
    --header "Authorization: Bearer $http_token" "$@"
}
hlist="$(inspect_http --method tools/list)"
grep -q '"demo-echo"' <<<"$hlist" || { echo "conformance: http tools/list missing demo-echo" >&2; exit 1; }
hcall="$(inspect_http --method tools/call --tool-name demo-echo --tool-arg value=conformance)"
grep -q 'echo:conformance' <<<"$hcall" || { echo "conformance: http tools/call did not round-trip" >&2; exit 1; }

# --- OAuth mode: the gateway with --public-url; consent code goes to the fake module ---
kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; gateway_pid=""
exec 3>&-
OAUTH_PORT="${CONFORMANCE_OAUTH_PORT:-$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
public="http://127.0.0.1:$OAUTH_PORT"
rm -f "$ready" "$work/consent-code"
mkfifo "$work/stdin-oauth"
exec 4<>"$work/stdin-oauth"
node gateway/dist/bin/cli.js --public-url "$public" --http-port "$OAUTH_PORT" --link-port "$LINK_PORT" --db "$db" \
  <"$work/stdin-oauth" >/dev/null 2>"$work/gateway.log" &
gateway_pid=$!
for _ in $(seq 1 300); do
  grep -q "MCP HTTP at" "$work/gateway.log" && break
  kill -0 "$gateway_pid" 2>/dev/null || { echo "conformance: oauth gateway exited early" >&2; exit 1; }
  sleep 0.1
done
grep -q "MCP HTTP at" "$work/gateway.log" || { echo "conformance: oauth gateway never started" >&2; exit 1; }
for _ in $(seq 1 150); do [ -e "$ready" ] && break; sleep 0.1; done
[ -e "$ready" ] || { echo "conformance: fake module never reconnected for oauth" >&2; exit 1; }

# a static bearer is refused on an OAuth-mode gateway
static_status="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$public/mcp" \
  -H "Authorization: Bearer $http_token" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
[ "$static_status" = "401" ] || { echo "conformance: static bearer got $static_status, want 401" >&2; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$public/mcp" -H 'content-type: application/json' -d '{}')" = "401" ] \
  || { echo "conformance: unauthenticated request was not 401" >&2; exit 1; }

access="$(node gateway/test/conformance/oauth-flow.mjs "$public/mcp" "$work/consent-code" conf gm)" \
  || { echo "conformance: oauth flow failed" >&2; exit 1; }
[ -n "$access" ] || { echo "conformance: oauth flow returned no token" >&2; exit 1; }
inspect_oauth() {
  retry_429 "$work/gateway.log" npx -y "@modelcontextprotocol/inspector@$INSPECTOR_VERSION" --cli "$public/mcp" --transport http \
    --header "Authorization: Bearer $access" "$@"
}
olist="$(inspect_oauth --method tools/list)"
grep -q '"demo-echo"' <<<"$olist" || { echo "conformance: oauth tools/list missing demo-echo" >&2; exit 1; }
ocall="$(inspect_oauth --method tools/call --tool-name demo-echo --tool-arg value=conformance)"
grep -q 'echo:conformance' <<<"$ocall" || { echo "conformance: oauth tools/call did not round-trip" >&2; exit 1; }

[ ! -e "$HOME/.foundry-agent-gateway" ] || { echo "conformance: default store was created" >&2; exit 1; }
echo "conformance: ok (inspector $INSPECTOR_VERSION, stdio, http, oauth)"
