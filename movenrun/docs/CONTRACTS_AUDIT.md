# MovenRun — Contracts Audit

**Audit date:** 2026-06-06
**Scope:** read-only audit of on-chain assets. **No contract code was modified.**

This document records what smart-contract work exists, what has been deployed,
and the safe next step for integrating it into the territory economy. Always
re-read this before touching `contracts/`.

---

## 1. Contract folders found

- `contracts/src/` — Solidity sources.
- `contracts/scripts/deploy/` — deploy scripts (`baseSepolia.ts`, `local.ts`).
- `contracts/scripts/verify/` — `verifyAll.ts` (Basescan verification).
- `contracts/test/` — Hardhat tests.
- `contracts/artifacts/`, `contracts/typechain-types/`, `contracts/cache/` —
  generated build output (compiled ABIs + TypeChain bindings).
- `shared/src/constants/contracts.ts` — the address registry the app/backend read
  from (currently **empty** on `main`, see §6).

---

## 2. Contract names (`contracts/src/*.sol` on `main`)

| Contract | Standard | Role in the territory economy |
| --- | --- | --- |
| `MoveToken` | ERC-20 | $MOVE token. Oracle-gated minting, halving, 2% zone tax. |
| `ZoneNFT` | ERC-721 | **Zone Deed.** tokenId = H3 hex ID; 2% zone tax; dormancy/reclaim. |
| `GearNFT` | ERC-1155 | Gear items with stat multipliers (basis points). |
| `ZoneChallenge` | AccessControl | **Land defence** — 14-day battles, stronghold boost, time extension. |
| `SeasonController` | AccessControl | 90-day seasons, Great Burn (10%), keeper. |
| `MoveVault` | AccessControl + ReentrancyGuard | Staking, protocol-owned liquidity, treasury. |
| `MovenDAO` | AccessControl | 3-tier governance. |

> **Also present on the deploy branch (not on `main`):** `GPSOracle.sol` and
> `interfaces/IGPSOracle.sol` — the on-chain GPS verification oracle. See §5.

---

## 3. Deployment scripts found

- `contracts/scripts/deploy/baseSepolia.ts` — deploys the suite to Base Sepolia.
  On `main` it expects `ORACLE_ADDRESS`, `ADMIN_ADDRESS`, `TREASURY_ADDRESS` from
  `.env`, deploys all seven contracts, wires `SEASON_ROLE` and the challenge
  contract, then prints addresses. (The deploy-branch version is substantially
  larger — it also deploys `GPSOracle` and writes a deployment JSON file.)
- `contracts/scripts/deploy/local.ts` — local Hardhat deploy.
- `contracts/scripts/verify/verifyAll.ts` — Basescan source verification.

---

## 4. Deployed addresses found

✅ **Yes — the contracts are deployed to Base Sepolia.**

The deployment record lives at `contracts/deployments/baseSepolia.json` **on the
`claude/movenrun-base-sepolia-deploy-BZhUH` branch** (it is *not* on `main`).
Recorded values:

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

Per-contract deployment tx hashes and constructor args are recorded in the same
JSON file. Verify any address on Basescan
(`https://sepolia.basescan.org/address/<addr>`) before relying on it.

---

## 5. Chain / network assumptions

- **Base Sepolia** (chainId `84532`) is the active testnet target.
- **Base mainnet** (chainId `8453`) is configured in `hardhat.config.ts` but
  **not** deployed to — reserved for Phase 3.
- Local Hardhat is chainId `31337`.
- `backend/src/config.ts` defaults `CHAIN_ID` to `84532` and reads
  `MOVE_TOKEN_ADDRESS`, `ZONE_NFT_ADDRESS`, `GEAR_NFT_ADDRESS`,
  `ZONE_CHALLENGE_ADDRESS`, `SEASON_CONTROLLER_ADDRESS`, plus `BASE_RPC_URL` /
  `BASE_SEPOLIA_RPC_URL` and `ORACLE_PRIVATE_KEY` from env.
- `shared/src/constants/h3.ts` fixes **H3 resolution 8** and the activity
  thresholds for mint eligibility.

> ⚠️ **Branch divergence — important.** `main` and
> `claude/movenrun-base-sepolia-deploy-BZhUH` have **diverged**. The deploy
> branch contains a post-security-audit version of the contracts (commit
> `9a3171b` "pre-deployment security audit and fixes"), the `GPSOracle`
> contract + interface, an integration test, updated deploy/verify scripts, and
> the deployment JSON — **none of which are on `main`.** The deployed Base
> Sepolia bytecode corresponds to the **deploy-branch** sources, **not** `main`'s
> older `contracts/src`.

---

## 6. What is ready

- A complete contract suite is **written, tested, and deployed to Base Sepolia.**
- A `GPSOracle` exists for on-chain GPS verification (deploy branch).
- Deploy + verify scripts exist for Base Sepolia, local, and (configured) Base
  mainnet.
- The backend already has config slots for every deployed address and the oracle
  key.
- `shared/` holds the H3 + emission constants the contracts assume.

## 7. What is missing / open items

- **Address registry is empty on `main`.** `shared/src/constants/contracts.ts`
  has empty strings for every `baseSepolia` and `base` address — even on the
  deploy branch it was never backfilled from `baseSepolia.json`.
- **The deployed source is only on a branch.** The audited/deployed contracts
  (incl. `GPSOracle`) are not on `main`; `main`'s `contracts/src` is the older
  pre-audit version.
- **No env values committed (correctly).** `.env` files exist but secrets are not
  to be relied on or committed; `ORACLE_ADDRESS`, `ADMIN_ADDRESS`,
  `TREASURY_ADDRESS` and RPC URLs must be supplied per-environment.
- **No mainnet deployment** (intentional — Phase 3).
- **No verified link** in this audit between the deployed bytecode and a tagged
  commit; verification status on Basescan should be confirmed.

## 8. Recommended next safe integration step

**Do not re-deploy and do not modify contract code.** Instead:

1. **Reconcile the branches first.** Review and land the contract work from
   `claude/movenrun-base-sepolia-deploy-BZhUH` (post-audit sources, `GPSOracle`,
   deployment JSON) onto `main` via its own PR, so `main` reflects what is
   actually deployed. This is a prerequisite for any integration.
2. **Backfill the address registry.** Populate
   `shared/src/constants/contracts.ts` `baseSepolia` block from
   `contracts/deployments/baseSepolia.json` so app/backend read real addresses.
   (Code change — out of scope for this docs-only PR.)
3. **Confirm on Basescan** that each address is the expected contract and is
   source-verified.
4. **Read-only integration only, on testnet.** When the app reaches Phase 2,
   start by *reading* `ZoneNFT` ownership and `ZoneChallenge` state from Base
   Sepolia. No minting, no writes, no mainnet.
