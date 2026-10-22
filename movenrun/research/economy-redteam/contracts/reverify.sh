#!/usr/bin/env bash
# Offline re-verification of the vendored draft patches against the pinned prototype commit.
# Hardhat in-process network only (chain id 31337, no accounts, no URLs). No RPC, no key,
# no env file is read, no download happens: the compiler is the solcjs already in node_modules.
#   MODE=original|patched  BRANCH_SUITE=1  bash reverify.sh
set -euo pipefail
SHA="c8262ecda89d9a2a11f045074ddf2be5d652af56"
MODE="${MODE:-patched}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
V="$HERE/vendored-122"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# refuse to run if any RPC-like variable is present
for v in $(env | cut -d= -f1 | grep -E '^(BASE_SEPOLIA_RPC_URL|BASE_RPC_URL|DEPLOYER_PRIVATE_KEY|BASESCAN_API_KEY|MNEMONIC|ALCHEMY.*|INFURA.*|.*_RPC_URL|.*_RPC|.*_PRIVATE_KEY)$' || true); do
  echo "refusing to run: $v is set" >&2; exit 2; done
git -C "$ROOT" archive "$SHA" movenrun/contracts | tar -x -C "$WORK"
ln -s "$ROOT/movenrun/node_modules" "$WORK/movenrun/node_modules"
C="$WORK/movenrun/contracts"
[ "$MODE" = "patched" ] && cp "$V"/patched/*.sol "$C/src/v3/"
grep -rl 'pragma solidity 0.8.24;' "$C/src/v3" | xargs sed -i 's/pragma solidity 0.8.24;/pragma solidity ^0.8.24;/'
mkdir -p "$C/test/ledger"
cp "$V/regression.proof.ts" "$C/test/ledger/"
if [ "$MODE" = "original" ]; then cp "$V/ledger.proof.ts" "$V/valve.proof.ts" "$C/test/ledger/"; fi
if [ "${BRANCH_SUITE:-0}" = "1" ]; then
  cp "$C"/test/v3/*.test.ts "$C/test/ledger/"
  sed -i 's#"\./helpers"#"../v3/helpers"#; s#"\./cells"#"../v3/cells"#' "$C"/test/ledger/*.test.ts
fi
if [ "${TIME_SHIM:-0}" = "1" ]; then
  # Harness-only experiment: advance the in-process chain clock past the day-close time before a
  # settlement authorization is built, so a time-bound publication is valid. Changes no contract.
  python3 - "$C/test/v3/helpers.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
needle="  const liquidMovementClaims = overrides.liquidMovementClaims ?? 0n;\n  const tollCredits"
assert needle in s
s=s.replace(needle,"  await time.increase(overrides.dayId * 86400 + 60);\n"+needle,1)
open(p,'w').write(s)
PY
fi
if [ "${PORT_SHIM:-0}" = "1" ]; then
  python3 "$HERE/port-shim.py" "$C/test/v3/helpers.ts"
fi
if [ -n "${EXTRA_TEST:-}" ]; then cp "$EXTRA_TEST" "$C/test/ledger/"; fi
cp "$V/proof.config.ts" "$C/"
# static assertion: config has no url / accounts
if grep -nE 'url:|accounts:|process\.env' "$C/proof.config.ts"; then echo "config can reach outside" >&2; exit 3; fi
cd "$C"
G5_MODE="$MODE" HARDHAT_DISABLE_TELEMETRY_PROMPT=true ../node_modules/.bin/hardhat --config proof.config.ts test
