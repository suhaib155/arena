#!/usr/bin/env bash
# Read-only EAS queries for the preview build gate.
#
# Usage: run-queries.sh <eas-binary> <raw-dir>
# Run from the app root (movenrun/mobile). Needs EXPO_TOKEN in the environment.
#
# Every command's stdout, stderr and exit code go to files in <raw-dir>.
# Nothing from eas-cli is echoed to the log: summarize.mjs classifies the
# files afterwards, without the token, and deletes them.
#
# Never add: build, env:create/update/delete/push/pull, secret:*, credentials,
# init, build:configure, project:init, submit, update, or --include-sensitive /
# --include-file-content. Never enable `set -x` here.
set -euo pipefail
set +x

EAS="$1"
RAW="$2"
mkdir -p "$RAW"
chmod 700 "$RAW"

if [ -z "${EXPO_TOKEN:-}" ]; then
  echo "::error::EXPO_TOKEN is not available to this step."
  exit 1
fi

"$EAS" --version 2>/dev/null | sed -E 's#^eas-cli/([0-9.]+).*#\1#' | head -1 > "$RAW/cli_version"

# run <label> <args...>: capture, never print. A failure is recorded, not hidden.
run() {
  local label="$1"; shift
  local rc=0
  "$EAS" "$@" </dev/null >"$RAW/$label.out" 2>"$RAW/$label.err" || rc=$?
  echo "$rc" > "$RAW/$label.exit"
  echo "$label: exit $rc"
}

run whoami        whoami
run project_info  project:info
run env_list      env:list preview --format short --scope project
run build_list    build:list --platform android --limit 10 --json --non-interactive

# Build quota: read the plan usage of the account that owns the project. The
# owner name is read from project:info into memory and passed as an argument;
# it is never printed.
if [ "$(cat "$RAW/project_info.exit")" = "0" ]; then
  owner="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$RAW/project_info.out" | sed -nE 's#^[[:space:]]*fullName[[:space:]]+@?([^/[:space:]]+)/.*#\1#p' | head -1)"
  if [ -n "$owner" ]; then
    run account_usage account:usage "$owner" --json --non-interactive
  fi
fi

# Exit codes are evaluated by summarize.mjs; this script succeeds once every
# query has been attempted and recorded.
exit 0
