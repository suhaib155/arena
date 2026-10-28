#!/usr/bin/env bash
# Runs the G5 contract proofs against the prototype contracts at a pinned commit, on
# Hardhat's in-process network only. Nothing is deployed to, or read from, any chain:
# there is no RPC URL and no key in this config.
#
#   bash movenrun/shared/contract-proofs/g5-ledger/run.sh [commit]
#   G5_MODE=patched bash movenrun/shared/contract-proofs/g5-ledger/run.sh [commit]
#   G5_PORTED_SUITE=1 G5_MODE=patched ...   runs the ported v3 suite (suite-port/) against the patches,
#     plus the legacy greatBurn probe (legacy-harness/, legacy src/SeasonController.sol unmodified)
#   G5_BRANCH_SUITE=1 ...   additionally runs the branch's own test/v3 suite in that mode
#
# G5_MODE=original (default): ledger.proof.ts (issue proofs), valve.proof.ts (valve, fallback
#   and emission failure modes and invariants) and regression.proof.ts, which asserts that
#   every issue reproduces on the unmodified source.
# G5_MODE=patched: the draft patches in ./patched are copied over src/v3 in the scratch
#   copy, then regression.proof.ts asserts that every fix holds. The pinned branch itself
#   is never modified.
#
# The contracts pin `pragma solidity 0.8.24`; to avoid downloading a compiler, the scratch
# copy relaxes it to ^0.8.24 and compiles with the solcjs build already in node_modules
# (0.8.26). In original mode the contract source is otherwise unchanged.
set -euo pipefail
SHA="${1:-c8262ecda89d9a2a11f045074ddf2be5d652af56}"
MODE="${G5_MODE:-original}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive "$SHA" movenrun/contracts | tar -x -C "$WORK"
ln -s "$ROOT/movenrun/node_modules" "$WORK/movenrun/node_modules"
C="$WORK/movenrun/contracts"
if [ "$MODE" = "patched" ]; then
  cp "$HERE"/patched/*.sol "$C/src/v3/"
fi
grep -rl 'pragma solidity 0.8.24;' "$C/src/v3" | xargs sed -i 's/pragma solidity 0.8.24;/pragma solidity ^0.8.24;/'
mkdir -p "$C/test/ledger"
cp "$HERE/regression.proof.ts" "$C/test/ledger/"
if [ "$MODE" = "original" ]; then
  cp "$HERE/ledger.proof.ts" "$HERE/valve.proof.ts" "$C/test/ledger/"
fi
if [ "${G5_BRANCH_SUITE:-0}" = "1" ]; then
  cp "$C"/test/v3/*.test.ts "$C/test/ledger/"
  sed -i 's#"\./helpers"#"../v3/helpers"#; s#"\./cells"#"../v3/cells"#' "$C"/test/ledger/*.test.ts
fi
if [ "${G5_PORTED_SUITE:-0}" = "1" ]; then
  # Ported v3 suite (RESEARCH ONLY): suite-port/*.ts next to regression.proof.ts, patched mode.
  cp "$HERE"/suite-port/*.ts "$C/test/ledger/"
  # Legacy greatBurn probe (issue ledger I-04): the unmodified legacy SeasonController and the
  # files it imports, plus minimal stand-ins, compiled next to v3 under src/v3/legacy-probe.
  L="$C/src/v3/legacy-probe"
  mkdir -p "$L/interfaces"
  cp "$C/src/SeasonController.sol" "$C/src/MoveToken.sol" "$C/src/ZoneNFT.sol" "$L/"
  cp "$C/src/interfaces/IGPSOracle.sol" "$L/interfaces/"
  cp "$HERE"/legacy-harness/*.sol "$L/"
fi
cp "$HERE/proof.config.ts" "$C/"
cd "$C"
G5_MODE="$MODE" HARDHAT_DISABLE_TELEMETRY_PROMPT=true npx hardhat --config proof.config.ts test
