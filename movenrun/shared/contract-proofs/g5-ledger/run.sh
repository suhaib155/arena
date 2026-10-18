#!/usr/bin/env bash
# Runs the G5 contract issue ledger proofs against the prototype contracts at a
# pinned commit, on Hardhat's in-process network only. Nothing is deployed to,
# or read from, any chain: there is no RPC URL and no key in this config.
#
#   bash movenrun/shared/contract-proofs/g5-ledger/run.sh [commit]
#
# The contracts pin `pragma solidity 0.8.24`; to avoid downloading a compiler,
# the scratch copy relaxes it to ^0.8.24 and compiles with the solcjs build
# already in node_modules (0.8.26). The contract source is otherwise unchanged.
set -euo pipefail
SHA="${1:-c8262ecda89d9a2a11f045074ddf2be5d652af56}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive "$SHA" movenrun/contracts | tar -x -C "$WORK"
ln -s "$ROOT/movenrun/node_modules" "$WORK/movenrun/node_modules"
C="$WORK/movenrun/contracts"
grep -rl 'pragma solidity 0.8.24;' "$C/src/v3" | xargs sed -i 's/pragma solidity 0.8.24;/pragma solidity ^0.8.24;/'
mkdir -p "$C/test/ledger"
cp "$HERE/ledger.proof.ts" "$C/test/ledger/"
cp "$HERE/proof.config.ts" "$C/"
cd "$C"
HARDHAT_DISABLE_TELEMETRY_PROMPT=true npx hardhat --config proof.config.ts test
