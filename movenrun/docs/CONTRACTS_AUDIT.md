# MovenRun — Contracts Audit

**Original audit:** 2026-06-06 (PR #9, read-only).
**Reconciliation update:** 2026-06-06 (this PR) — the deployed Base Sepolia
contract source + deployment metadata were brought onto `main`, and the shared
address registry was filled. **No contracts were redeployed.**

This document records what smart-contract work exists, what has been deployed,
and the safe next step for integrating it into the territory economy. Always
re-read this before touching `contracts/`.

---

## ✅ Reconciliation summary (this PR)

`main` now matches the **deployed Base Sepolia state**:

- Brought the **post-audit contract source** that corresponds to the deployed
  bytecode onto `main`, verbatim from
  `claude/movenrun-base-sepolia-deploy-BZhUH` (including `GPSOracle.sol` and
  `interfaces/IGPSOracle.sol`, previously missing on `main`).
- Brought the **deployment record** `contracts/deployments/baseSepolia.json`
  (addresses, tx hashes, constructor args) onto `main`.
- Brought the matching **scripts, tests, hardhat config, build config, and
  lockfile** so the deployed state is reproducible and testable.
- **Filled `shared/src/constants/contracts.ts`** `baseSepolia` block from the
  authoritative deployment file, and added a `GPSOracle` slot.
- Verified: `hardhat compile` succeeds (40 Solidity files) and **all 26
  contract tests pass**, including the integration test.

What this PR did **not** do: no redeploy, no address changes, no tokenomics or
economic-parameter edits beyond what the deploy branch already shipped and the
deployment file proves, and no backend/mobile behavior changes.

---

## 1. Contract folders found

- `contracts/src/` — Solidity sources (now incl. `GPSOracle.sol` +
  `interfaces/IGPSOracle.sol`).
- `contracts/deployments/` — **`baseSepolia.json`** deployment record (now on
  `main`).
- `contracts/scripts/deploy/` — `baseSepolia.ts`, `local.ts`.
- `contracts/scripts/verify/` — `verifyAll.ts` (Basescan verification).
- `contracts/test/` — Hardhat tests (now incl. `integration.test.ts`).
- `shared/src/constants/contracts.ts` — the address registry; **Base Sepolia
  addresses are now populated** (was empty before this PR).
- Generated `artifacts/`, `typechain-types/`, `cache/` are build output and are
  **git-ignored** (not committed).

---

## 2. Contract names (`contracts/src/*.sol`)

| Contract | Standard | Role in the territory economy |
| --- | --- | --- |
| `MoveToken` | ERC-20 | $MOVE token. Oracle-gated minting, halving, 2% zone tax. |
| `GPSOracle` | — | On-chain GPS route verification; gates $MOVE minting (signed routes). |
| `ZoneNFT` | ERC-721 | **Zone Deed.** tokenId = H3 hex ID; 2% zone tax; dormancy/reclaim. |
| `GearNFT` | ERC-1155 | Gear items with stat multipliers (basis points). |
| `ZoneChallenge` | AccessControl | **Land defence** — 14-day battles, stronghold boost, time extension. |
| `SeasonController` | AccessControl | 90-day seasons, Great Burn (10%), keeper. |
| `MoveVault` | AccessControl + ReentrancyGuard | Staking, protocol-owned liquidity, treasury. |
| `MovenDAO` | AccessControl | 3-tier governance. |

`interfaces/IGPSOracle.sol` is the oracle interface consumed by the token/zone
contracts.

---

## 3. Deployment scripts found

- `contracts/scripts/deploy/baseSepolia.ts` — deploys the full suite (incl.
  `GPSOracle`) to Base Sepolia, wires roles, and writes
  `deployments/baseSepolia.json`.
- `contracts/scripts/deploy/local.ts` — local Hardhat deploy.
- `contracts/scripts/verify/verifyAll.ts` — Basescan source verification.

> Deploy scripts read `DEPLOYER_PRIVATE_KEY`, `ORACLE_ADDRESS`, `ADMIN_ADDRESS`,
> `TREASURY_ADDRESS`, and RPC URLs **from env only** — see
> `contracts/.env.example` (placeholders, no secrets). `.env` is git-ignored.

---

## 4. Deployed addresses found

✅ **Deployed to Base Sepolia.** Recorded in
`contracts/deployments/baseSepolia.json` (now on `main`) and mirrored into the
shared registry.

- **Network:** `baseSepolia` — **chainId `84532`**
- **Deployer:** `0xf258c07f93417DacB3013c4C3367DFcCfCb5C497`
- **Timestamp:** `2026-05-27T18:08:40Z`

| Contract | Base Sepolia address |
| --- | --- |
| `MoveToken` | `0x86fD3984D0c4D1A8912Fc168cb6eD2a35B94C1aC` |
| `GPSOracle` | `0x7E3972Cff8fF3Ed352DD649Da2E949Bb80A4aF90` |
| `ZoneNFT` | `0xF9694dA0897916A4c01a2c59f2B8E850AA4FEfD8` |
| `GearNFT` | `0xfE46bcC610761D82A646bdDA2D27fD1d044C09Cc` |
| `MoveVault` | `0x87250370311b8D48C19cA7725c1bdb8B3f7CF556` |
| `ZoneChallenge` | `0x3CC6b92B3051D2C4FbAf92423e427761982685D7` |
| `SeasonController` | `0x687b77f2B047313Bba2eC2C69D9D0618bbA15BdA` |
| `MovenDAO` | `0x5Ed4Ee303fB55CEFBB7460e8FDb5C33424A6fC15` |

Per-contract tx hashes and constructor args are in the same JSON file. Verify any
address on Basescan (`https://sepolia.basescan.org/address/<addr>`).

---

## 5. Chain / network assumptions

- **Base Sepolia** (chainId `84532`) is the active testnet target.
- **Base mainnet** (chainId `8453`) is configured in `hardhat.config.ts` but
  **not** deployed to — reserved for Phase 3.
- Local Hardhat is chainId `31337`.
- `backend/src/config.ts` defaults `CHAIN_ID` to `84532` and reads per-contract
  address env vars + RPC URLs + `ORACLE_PRIVATE_KEY`.
- `shared/src/constants/h3.ts` fixes **H3 resolution 8** and the activity
  thresholds for mint eligibility; `shared/src/constants/emission.ts` holds the
  tokenomics (unchanged by this PR).

### Branch divergence — status

- **Contracts + deployment metadata + shared registry: RESOLVED.** `main` now
  carries the deployed source and addresses.
- **Backend: STILL DIVERGED.** `claude/movenrun-base-sepolia-deploy-BZhUH` also
  contains backend changes (`backend/src/config.ts`, `workers/gps.worker.ts`,
  route wiring) and a `shared/` package restructure (`src/index.ts`,
  `package.json`, `tsconfig.json`). These are **application-logic changes, not
  deployment artifacts**, and were intentionally left out of this PR. They should
  be reconciled separately, on their own merits.

---

## 6. What is ready

- Full contract suite is **written, tested (26/26 passing), compiled, and
  deployed to Base Sepolia**, and the deployed source now lives on `main`.
- `GPSOracle` for on-chain GPS verification is present and exercised by tests.
- Deploy + verify scripts for Base Sepolia / local / (configured) mainnet.
- The **shared address registry is populated** for Base Sepolia — consumers can
  import `CONTRACT_ADDRESSES.baseSepolia`.
- Backend already has config slots for every deployed address + the oracle key.

## 7. What is missing / open items

- **ABIs for app consumption.** The mobile app has no typed ABI/client yet. ABIs
  exist as build output (`artifacts/`) but are git-ignored; a deliberate,
  app-facing ABI export (or a generated client) is needed before mobile
  integration.
- **Backend reconciliation.** The deploy-branch backend + `shared` package
  changes are not yet on `main` (see §5). Needed before the backend can talk to
  the deployed contracts.
- **No `base` (mainnet) addresses** — intentional (Phase 3).
- **Basescan source verification** of each address should be confirmed/run
  (`yarn verify:sepolia` with a `BASESCAN_API_KEY`).

## 8. Recommended next safe integration step

**Do not re-deploy and do not modify contract code.** In order:

1. **Confirm Basescan verification** for each deployed address (read-only).
2. **Reconcile the backend** (`config.ts`, workers, routes) and the `shared`
   package restructure from `claude/movenrun-base-sepolia-deploy-BZhUH` in a
   separate, behavior-reviewed PR, wiring the now-populated registry.
3. **Export app-facing ABIs / a typed read client** for the deployed contracts.
4. **Read-only testnet integration only** (Phase 2): start by *reading*
   `ZoneNFT` ownership and `ZoneChallenge` state from Base Sepolia. No minting,
   no writes, no mainnet, no wallet UI yet.

> ⚠️ **No liquid reward economy may be exposed yet.** These are **Base Sepolia
> testnet** contracts only. No mainnet addresses exist, and per `docs/ROADMAP.md`
> no liquid rewards / real token emissions / earning claims ship before Phase 1
> density and reliable GPS verification. This PR reconciles artifacts; it does
> **not** enable any economy in the app.
