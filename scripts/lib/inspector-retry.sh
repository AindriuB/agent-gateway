# shellcheck shell=bash
# Sourced by scripts/conformance.sh. Retries a command only when the gateway refused it with
# its per-client 429 ("too many requests"); any other failure is returned at once.
# Usage: retry_429 <log> <cmd...>  - stdout passes through, stderr is appended to <log>.
retry_429() {
  local log="$1"; shift
  local max=4 backoff="${CONFORMANCE_429_BACKOFF:-1.1}" attempt=1 status out err
  err="$(mktemp)"
  while :; do
    status=0
    out="$("$@" 2>"$err")" || status=$?
    if [ "$status" -ne 0 ] && [ "$attempt" -lt "$max" ] \
      && { grep -q 'too many requests' "$err" || grep -q 'too many requests' <<<"$out"; }; then
      local msg="conformance: 429 from gateway, retrying in ${backoff}s (attempt $((attempt + 1))/$max)"
      echo "$msg" >>"$log"
      echo "$msg" >&2
      sleep "$backoff"
      attempt=$((attempt + 1))
      continue
    fi
    cat "$err" >>"$log"
    rm -f "$err"
    [ -z "$out" ] || printf '%s\n' "$out"
    return "$status"
  done
}
