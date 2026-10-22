#!/usr/bin/env sh
# Track A research suite. Runs on plain Node with the workspace's tsx; no
# network, no device, no hosted service. Exit code is the suite's.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"
TSX_TSCONFIG_PATH="$HERE/tsconfig.json" exec node --import tsx --import ./support/nodeShims.ts --test --test-concurrency=1 tests/*.test.ts
