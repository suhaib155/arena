# MovenRun — Contracts Audit

**Original audit:** 2026-06-06 (PR #9, read-only).
**Reconciliation update:** 2026-06-06 (this PR) — the deployed Base Sepolia
contract source + deployment metadata were brought onto `main`, and the shared
address registry was filled. **No contracts were redeployed.**

This document records what smart-contract work exists, what has been deployed,
and the safe next step for integrating it into the territory economy. Always
re-read this before touching `contracts/`.

> **V1 discrepancy characterization (2026-07-11):** the deployed-V1 lifecycle,
> economic, and governance discrepancies are catalogued — each proven by a
> passing characterization test — in
> [`docs/CONTRACT_V1_DISCREPANCIES.md`](./CONTRACT_V1_DISCREPANCIES.md)
> (tests under `contracts/test/v1-characterization/`). That work is
> **characterization + documentation only**: no Solidity source, deployment
> addresses, or deployment records were changed.

> **Deterministic contract CI (`chore(contracts): add deterministic CI and
> disable unsafe mainnet deployment`):** the workspace now has a committed,
> deterministic `movenrun/yarn.lock` and an independent
> `.github/workflows/contracts-checks.yml` that compiles and tests the
> contract suite on every contract/shared change. The unsafe `deploy:mainnet`
> command was **removed** (repo/tooling fix only — no redeploy, no address
> change). See "Package manager & contract CI" below. **V2 remains source-only
> on the separate PR #45 branch and is not part of this change.**

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
3. ✅ **Export app-facing ABIs / a typed read client** for the deployed
   contracts — **done** in `backend/src/blockchain/` (read-only `ethers`
   client, deployment loader, view-only ABIs, typed errors; no signer/wallet/
   writes; reuses the existing `ethers` dep — no new dependency). See
   `backend/src/blockchain/README.md`.
4. **Read-only testnet integration only** (Phase 2): start by *reading*
   `ZoneNFT` ownership and `ZoneChallenge` state from Base Sepolia. No minting,
   no writes, no mainnet, no wallet UI yet. **Next:** `feat(mobile): add
   read-only Base Sepolia contract status preview` — surface deployment/read
   status in the app as a preview only.

### Read-only client (added)

`backend/src/blockchain/` is a **read-only** layer over the deployed Base
Sepolia contracts:

- RPC URL comes from the `BASE_SEPOLIA_RPC_URL` env var (public fallback if
  unset); **no `.env`, RPC key, or secret is committed.**
- No private key, no signer, no wallet, **no write/transaction methods**, no
  mint/claim/Liquid MOVE.
- The deployment loader validates `contracts/deployments/baseSepolia.json` and
  cross-checks it against the shared registry; addresses are never invented.

> ⚠️ **No liquid reward economy may be exposed yet.** These are **Base Sepolia
> testnet** contracts only. No mainnet addresses exist, and per `docs/ROADMAP.md`
> no liquid rewards / real token emissions / earning claims ship before Phase 1
> density and reliable GPS verification. This PR reconciles artifacts; it does
> **not** enable any economy in the app.

### Oracle signature tuple alignment (fixed)

`backend/src/services/oracle.service.ts` previously signed tuples that did **not**
match what the current contract source and Base Sepolia deployment verify (the
contracts already carry the correct `FIX-001` tuples). The backend signers now
mirror each contract exactly — the contract source is the source of truth:

| Signer | Contract check (source of truth) | Encoding |
|---|---|---|
| `signRouteProof` | `GPSOracle.submitRoute` → `keccak256(abi.encodePacked(chainId, to, routeHash, distanceMeters, hexId))` | packed |
| `signZoneMint` | `ZoneNFT.mintZone` → `keccak256(abi.encodePacked(chainId, hexId, msg.sender, mintCost))` | packed |
| `signChallengeDeclaration` | `ZoneChallenge.declareChallenge` → `keccak256(abi.encodePacked(chainId, hexId, zoneNFT.zoneOwner(hexId), defenderBaseScore))` | packed |
| `signScore` | `ZoneChallenge.submitScore` → `keccak256(abi.encodePacked(chainId, hexId, msg.sender, score))` | packed |
| `signGreatBurn` | `SeasonController.greatBurn` → `keccak256(abi.encode(chainId, seasonNumber, topHexIds, yields))` | **non-packed** `abi.encode` |

- **`chainId` is now bound into every signature** (Base Sepolia `84532`, from the
  zod-validated `CHAIN_ID` config; overridable in tests) — replay protection and
  `usedRoutes` on-chain are unchanged.
- `hexId` is now a **required** parameter on route proofs; `gps.worker.ts` signs
  the primary (first) captured hex (`0` = not in any zone). Multi-zone settlement
  is a follow-up.
- The challenge-declaration path is **guarded**: the signer refuses a zero/invalid
  defender or zero base score, and `POST /battles/declare` returns `501` until the
  real on-chain zone owner + validated defender score are wired.
- **No contract was redeployed and the Base Sepolia deployment artifacts
  (`contracts/deployments/baseSepolia.json`) are unchanged.** Route persistence,
  wallet auth, rate limiting, and anti-cheat remain separate follow-up gates.
- Tuple alignment is proven by `backend/src/services/oracle.service.test.ts`
  (reconstructs each contract digest and recovers the oracle signer; negative
  tests cover the old tuple and a wrong chainId/hexId).

### Route lifecycle persistence + server-side dedup (added)

The GPS route pipeline previously lived entirely inside BullMQ job memory — a
submitted route's status, hash, distance, and oracle signature were lost the
moment the job finished, and `GET /gps/verify/:id` was a hardcoded `PENDING`
stub. This PR persists the route lifecycle to the existing `routes` table
(`backend/src/db/schema.ts`, first defined but never wired up) and adds
server-side dedup **before** signing:

- **Lifecycle statuses** (mirroring `@movenrun/shared`'s `RouteStatus` string
  values without importing the enum — see "Backend typecheck scope" below):
  `SUBMITTED` → `PROCESSING` → `REJECTED` | `VERIFIED`. A route is `VERIFIED`
  only once it has a `routeHash`, `distanceMeters`, `hexId`, and `oracleSig`
  together — there is no separate "signed" status because a route that passes
  validation and dedup is always signed in the same step.
- **`POST /gps/submit`** persists a `SUBMITTED` record (wallet, start/end time)
  *before* enqueueing the BullMQ job, so the route id is resolvable immediately.
- The worker marks `PROCESSING`, runs the existing anomaly check, computes
  distance/hexes/routeHash, then runs **two dedup checks before ever calling the
  oracle signer**:
  1. **Exact `routeHash` dedup** — any other route (any wallet, any status)
     already carrying the same `routeHash` blocks signing. The `routes` table
     also gets a DB-level `UNIQUE` constraint on `route_hash` as a backstop
     (Postgres treats multiple `NULL`s as non-colliding, so unprocessed routes
     never conflict).
  2. **Per-wallet time-overlap dedup** — a new submission whose
     `[startTime,endTime]` window overlaps an already-`VERIFIED` route from the
     *same wallet* is rejected, using only the `startTime`/`endTime` scalars
     already in the schema (no raw GPS added to enable this).
  - Any validation failure, duplicate, or unexpected worker error persists
    `REJECTED` + a human-readable reason — a route is never left stuck in
    `PROCESSING`, and the oracle signer is never invoked on a failed or
    duplicate route (see `backend/src/services/route.service.test.ts`).
- **`GET /gps/verify/:id`** now reads the persisted record and returns
  `status`, `routeHash`, `distanceMeters`, `hexId`, `rejectionReasons`, and
  timestamps; `oracleSig` is surfaced only once `status === "VERIFIED"`; unknown
  ids return `404`. **No raw GPS points, coordinates, or path are ever
  persisted or returned** — only safe scalar lifecycle metadata, consistent with
  the rest of this backend (route proofs, route review history, etc.).
- On-chain `usedRoutes` / replay protection are unchanged; this dedup is a
  server-side belt-and-suspenders layer, not a replacement for it.

**Initial migration (added).** `backend/drizzle/0000_loose_chat.sql` (+
`backend/drizzle/meta/`) is the first migration ever generated for this
schema — no migration existed for *any* table before this PR, not just the new
`routes` columns. It was generated with `drizzle-kit generate` against the
committed `backend/drizzle.config.ts` and the exact `backend/src/db/schema.ts`
in this PR, so it creates all five tables (`battles`, `hex_activities`,
`routes`, `user_route_hexes`, `zones`) as they currently stand. It includes the
`routes_route_hash_unique` `UNIQUE` constraint (which Postgres also backs with
an index), plus btree indexes on `routes.wallet_address`, `routes.status`, and
a composite `(wallet_address, start_time, end_time)` index supporting the
overlap-dedup query. Deploy with:
```
yarn workspace @movenrun/backend db:migrate
```
against a reachable `DATABASE_URL`. *(Tooling note for whoever generates the
*next* migration: `drizzle-kit@0.22.x` throws `TypeError: Do not know how to
serialize a BigInt` when diffing a schema with a `bigint` column that has a
`bigint`-typed `.default()` — pre-existing on `hex_activities`, unrelated to
this PR. Work around it by temporarily swapping `.default(0n)` for
`.default(sql\`0\`)` in a scratch copy of schema.ts before running
`db:generate`, or upgrade `drizzle-kit` first.)*

**Race-condition backstop for the routeHash dedup (tightened).** The
synchronous `findByRouteHash` check leaves a gap: two concurrent submissions
of the same route can both pass it before either writes. `routes_route_hash_unique`
is what actually stops the second write. `DrizzleRouteRepository.update()` now
catches that Postgres `23505` unique-violation (matched on the specific
constraint name) and rethrows it as a typed `RouteHashConflictError`
(`InMemoryRouteRepository` mirrors the same check for tests, with no DB
involved); `route.service.ts` catches it around the finalize write and
converts it into a deterministic `REJECTED` with reason "Duplicate route hash
detected during finalization (concurrent submission)" instead of a generic
worker error. The oracle signature already computed in that race window is
discarded and never persisted or exposed as `VERIFIED`. Fixed alongside this:
the earlier synchronous-duplicate reject path was persisting the *colliding*
`routeHash` value onto the rejected record's own row — which would have
violated the same `UNIQUE` constraint on every single duplicate detection, not
just the race case — so it now leaves that field unset on rejection. Covered
by `route.repository.drizzle.test.ts` (constraint-violation mapping, via a
stub `Db`) and `route.service.test.ts` (`ConflictOnceRepository`, an in-memory
wrapper that fails one `update()` call to simulate the race end-to-end).
Deliberately not addressed: the same live-database validation, and the
narrower overlap-dedup write path (step 4) does not get the identical
try/catch, since it would require two independent races to stack — not worth
the added complexity for this PR.

**PROCESSING stuck-state on DB failure (documented, partially mitigated).**
`gps.worker.ts`'s outer catch now wraps its own "mark REJECTED" write in a
try/catch: if that write also fails, it logs a scalar-only error message
(never the raw error object, which could carry connection strings or other
sensitive detail) and re-throws the original error so BullMQ still sees the
job as failed. Signing itself remains fail-closed in every case — it is
structurally unreachable without a prior successful persisted dedup check, DB
outage or not. The one case this does **not** fully close: if the database is
totally unreachable for the entire duration of a job (both the dedup-check
persistence *and* the failure-marking write fail), the route can be left
stuck in `PROCESSING` until the outage clears. Operational cleanup/retry for
that scenario (e.g. a sweep that re-enqueues or expires stale `PROCESSING`
rows) is a follow-up, not part of this PR.

**Drizzle repository test coverage.** `route.repository.drizzle.test.ts` unit
tests `DrizzleRouteRepository`'s one piece of hand-written logic — mapping a
Postgres unique-violation to `RouteHashConflictError` while leaving unrelated
errors untouched — using a minimal stub `Db` (no real connection). The
generated SQL itself (the `and`/`eq`/`gt`/`lt`/`ne` query builders) is
drizzle-orm's responsibility and is *not* exercised against a live Postgres
anywhere in this repo's CI, which has no Postgres service and none was added
here (no Docker/Postgres CI infrastructure exists to build on, and adding it
is out of scope for a persistence-focused PR). **Live-DB validation of
`DrizzleRouteRepository` (the actual generated SQL, the migration applying
cleanly, and the constraint/index names matching what the catch logic checks
for) must happen before staging/prod deployment** — this is the same
constraint noted for the migration above.

**Backend typecheck scope.** The new persistence modules
(`repositories/route.repository.ts`, `repositories/route.repository.drizzle.ts`,
`services/route.service.ts`, `db/client.ts`) deliberately import nothing from
`@movenrun/shared` or from any file that does, so they are *not* affected by
the pre-existing shared-package build gap noted above — but
`backend/tsconfig.json`'s `include` is still scoped to `src/blockchain/**`
only, so these files are not yet covered by `tsc --noEmit`. Correctness here
is proven at runtime by `route.service.test.ts`, `route.repository.test.ts`,
and `route.repository.drizzle.test.ts` (in-memory repository / stubbed `Db`,
no live DB). Broadening typecheck coverage is tracked as its own follow-up
(`chore(backend): expand typecheck coverage beyond blockchain clients`) so it
isn't mixed into a persistence-focused PR.

**Remaining follow-up gates** (as of the route-persistence PR):
- ~~Wallet auth / SIWE on write endpoints.~~ Added below (wallet-signature
  auth, not a full SIWE/session product).
- ~~Rate limiting, `helmet`, and a CORS allowlist.~~ Added below.
- Expanded anti-cheat beyond the existing anomaly check + dedup.
- Real challenge-declaration eligibility (on-chain zone owner lookup) and a
  validated defender score — `POST /battles/declare` still returns `501`.
- Broader backend `tsc` coverage beyond `src/blockchain/**`, once the
  shared-package build step is addressed.
- Live-DB validation of `DrizzleRouteRepository` and the generated migration
  against a real Postgres before staging/prod deployment (not exercised in
  CI — see above).
- Operational cleanup/retry for routes left stuck in `PROCESSING` after a
  total-DB-outage during failure handling (see above).

### Wallet-signature auth, rate limiting, helmet, and CORS allowlist (added)

Every write endpoint that could act on a specific wallet — get a route
verified and signed, get a zone-mint signature, or declare a challenge — was
previously reachable by anyone who could reach the backend, for any wallet
address they chose to put in the request body. This PR adds wallet-signature
authentication plus baseline HTTP hardening. **No mobile wallet UX, session
product, or SIWE library is added** — this is backend middleware only.

**Protected endpoints:** `POST /gps/submit`, `POST /zones/mint`,
`POST /battles/declare` (still returns `501`, but now only after auth passes —
protecting it now means no auth regression is possible once real
eligibility/scoring lands). Read endpoints (`GET /gps/verify/:id`,
`GET /zones/:hexId`, `GET /users/:address`) remain public — they already
returned only safe scalar/public data before this PR.

**Auth mechanism (`backend/src/middleware/auth.ts`).** A caller signs a short
canonical message with their wallet and sends it via four headers:

| Header | Meaning |
|---|---|
| `x-movenrun-address` | claimed wallet address (`0x` + 40 hex) |
| `x-movenrun-signature` | `personal_sign` / `wallet.signMessage(...)` over the message below |
| `x-movenrun-nonce` | per-request random string (replay protection) |
| `x-movenrun-issued-at` | ms-since-epoch when the message was signed |

Signed message (newline-joined):
```
MovenRun Backend Auth
Address: <address>
Method: <HTTP method>
Path: <request path, no query string>
BodyHash: <0x-prefixed keccak256 of the raw request body bytes>
Nonce: <nonce>
IssuedAt: <issuedAt>
ChainId: <chain id>
```
`requireWalletAuth()` recovers the signer via `ethers.verifyMessage`, checks
it matches the claimed address, rejects a request whose `issuedAt` is outside
`AUTH_MAX_AGE_SECONDS` (default 300s) or more than 5s in the future (clock
skew tolerance), and rejects a replayed nonce. On success it attaches
`req.movenrunAuth.address` (lowercased) — it does **not** check that the
verified signer matches any specific body field; that binding is
route-specific and enforced in each handler (`walletAddress` for
`/gps/submit` and `/zones/mint`, `challengerAddress` for `/battles/declare`)
**before** any persistence, enqueueing, or signing happens. Binding the body
hash into the signed message means a valid signature over one payload can't
be replayed against a different (or tampered) body or path.

**Body hash — read this before writing a client.** `BodyHash` is
`keccak256` of the **raw bytes** of the request body the client is about to
send — **not** a canonical or re-serialized JSON representation. This means:
- Clients **must** sign a hash of the *exact* bytes they then transmit as the
  HTTP body. Any re-serialization between "compute the hash" and "send the
  request" — including simply reordering JSON keys — produces different
  bytes, a different hash, and therefore a signature that fails to verify.
- **This is intentional and fail-closed**, not a bug: it avoids any ambiguity
  about what "canonical JSON" means (key order, number formatting, whitespace)
  by never re-encoding anything on the server side. The cost is that clients
  must be careful to hash-then-send the same bytes verbatim, not "the same
  logical object."
- The `x-movenrun-*` header **values** (signature, nonce, address, issuedAt)
  are never themselves part of the hashed body — only the request payload is
  hashed. The HTTP method and path are bound separately as their own fields
  in the signed message (see above), not folded into the body hash.

**Path, query string, and trailing slash.** The signed message's `Path`
never includes the query string — protected write endpoints must therefore
never rely on query parameters for security-relevant action data, since only
the body and path are cryptographically bound; put anything security-relevant
in the JSON body instead. A single trailing slash is normalized away before
both signing (client-side, via the `buildAuthHeaders` test helper) and
verifying (server-side, via `normalizePath` in `middleware/auth.ts`), so
`/gps/submit` and `/gps/submit/` — which Express's default non-strict routing
already treats as the same route — sign and verify identically.

**Nonce format.** `x-movenrun-nonce` must be a non-empty string of at most 128
characters from `[A-Za-z0-9_-]`; anything else (empty, oversized, or
containing other characters) is rejected with `401 {"error": "Invalid nonce"}`
before the (more expensive) signature-recovery step runs. Nonces are opaque —
the server never reads meaning from them beyond the format check and the
seen/unseen replay check below.

**Nonce replay protection is in-memory and NOT production-grade** — it's a
single-process `Map`, so it doesn't survive a restart and doesn't work across
more than one backend instance. A DB-backed `usedAuthNonces` table is the
correct fix once this runs behind more than one instance; noted as a
follow-up rather than built here to keep this PR's scope to auth/rate-limit
infrastructure.

**Rate limiting (`backend/src/middleware/rateLimit.ts`, via
`express-rate-limit`).** A light app-wide limiter (`RATE_LIMIT_MAX` per
`RATE_LIMIT_WINDOW_MS`, default 300/60s, keyed by IP) applies to every route.
A stricter per-route limiter (`RATE_LIMIT_WRITE_MAX`, default 20/60s) applies
to each write endpoint, mounted *after* `requireWalletAuth()` so it can key on
IP **and** the verified wallet address when available — an unauthenticated
flood is already stopped by the app-wide IP limiter before it reaches the
write limiter. IPv6 addresses are normalized/subnetted via
`express-rate-limit`'s `ipKeyGenerator` helper so a client can't dodge the
limit by cycling addresses in the same /56. Exceeding the limit returns a
safe `429 { "error": "..." }` — no internals.

**Helmet (`backend/src/middleware/security.ts`).** Applied with its default
option set — no customization was needed. Helmet's defaults (including its
CSP) only affect browser-rendered HTML/JS and don't interfere with a JSON API.

**CORS allowlist (`backend/src/middleware/security.ts`, via `cors`).**
`CORS_ORIGINS` is a comma-separated allowlist. In development/test, an unset
`CORS_ORIGINS` falls back to a small set of common local dev origins
(`localhost:19006`/`8081`/`3000`). **In production, `CORS_ORIGINS` must be set
explicitly — an unset value, or a value containing a literal `*`, throws at
process startup (fail closed)**, rather than silently allowing every origin.
Requests with no `Origin` header (curl, server-to-server, a mobile app's
`fetch` outside a WebView) are passed through unconditionally — CORS is a
browser-enforced mechanism and doesn't apply to them; wallet-signature auth is
what actually authenticates those callers.

**Config additions:** `AUTH_MAX_AGE_SECONDS` (default 300), `CORS_ORIGINS`
(required in production), `RATE_LIMIT_WINDOW_MS` (default 60000),
`RATE_LIMIT_MAX` (default 300), `RATE_LIMIT_WRITE_MAX` (default 20).

**Why auth/rate-limit aren't tested against the real route files.**
`routes/gps.ts`, `routes/zones.ts`, and `routes/battles.ts` all transitively
import modules that construct live IORedis connections and call
`getConfig()` at module load time (`getConfig()` calls `process.exit(1)` on
invalid/missing env) — the same constraint noted in the route-persistence
PR that kept `route.service.ts` decoupled from `@movenrun/shared`. So
`requireWalletAuth`, the rate limiters, and CORS/helmet are unit- and
integration-tested directly (mock req/res for pure logic; a small standalone
Express app + a real ephemeral-port HTTP listener + Node's built-in `fetch`
for HTTP-level behavior — no new test dependency needed), and the
auth-then-persist ordering guarantee is proven for each of the three
protected endpoints via a handler that mirrors the real route file exactly:
`middleware/authBindingOrdering.test.ts` mirrors `routes/gps.ts`'s
`POST /submit`, `middleware/zonesMintAuthBinding.test.ts` mirrors
`routes/zones.ts`'s `POST /mint` (including the eligibility/top-mover checks,
with the oracle signer replaced by a spy), and
`middleware/battlesDeclareAuthBinding.test.ts` mirrors `routes/battles.ts`'s
`POST /declare` (proving the 501 path is still reached with valid auth and
that auth/mismatch failures never reach it). The real route files' wiring was
additionally reviewed manually line-by-line against this proven behavior.

**Backend typecheck scope unchanged.** `backend/tsconfig.json`'s `include` is
still `src/blockchain/**` only — the new middleware files aren't covered by
`tsc --noEmit`, same as the persistence modules added in the previous PR.
Correctness is proven at runtime by the test suite above. Tracked as the same
follow-up: `chore(backend): expand typecheck coverage beyond blockchain
clients`.

**Updated remaining follow-up gates:**
- Expanded anti-cheat beyond the existing anomaly check + dedup.
- Device attestation.
- Real challenge-declaration eligibility (on-chain zone owner lookup) and a
  validated defender score — `POST /battles/declare` still returns `501`.
- DB-backed nonce replay protection (`usedAuthNonces`) once this runs behind
  more than one backend instance — the current in-memory cache is
  single-process only.
- Broader backend `tsc` coverage beyond `src/blockchain/**`.
- Live-DB validation of `DrizzleRouteRepository` and the generated migration
  against a real Postgres before staging/prod deployment.
- Mobile wallet connection and client-side signing UX, only once the product
  flow needs it (no mobile changes in this PR).

---

### Package manager & contract CI (added — `chore(contracts): add deterministic
### CI and disable unsafe mainnet deployment`)

**Yarn 4.9.1 is the authoritative package manager** for this monorepo (pinned
via root `movenrun/package.json`'s `"packageManager"` field, unchanged by this
PR). Local setup and CI both use:

```
corepack enable
yarn install --immutable
```

- **`movenrun/yarn.lock` is now committed** — generated from a clean workspace
  install and verified with `yarn install --immutable` from a clean checkout.
  Every prior workflow (`backend-checks.yml`, `mobile-checks.yml`,
  `eas-apk-build.yml`) previously set `YARN_ENABLE_IMMUTABLE_INSTALLS: "false"`
  specifically because no lockfile existed yet — Yarn 4 enables immutable
  installs by default, which fails outright without a committed lock. All
  three now use `yarn install --immutable` and no longer need that workaround.
  The EAS workflow's Expo/EAS behavior, Expo SDK version, and EAS project id
  are unchanged; the EAS CLI itself is still invoked via `npx eas-cli@latest`
  and was not pinned.
- **One workspace lockfile, not two.** `contracts/package-lock.json` (an npm
  lockfile) was **removed**: nothing in this repo's scripts or workflows ran
  `npm install`/`npm ci` against it (confirmed by search), so it was a stale,
  unused artifact left over from before this package joined the Yarn
  workspace — not an intentionally-maintained independent npm project. The
  monorepo uses Yarn workspaces with a single lockfile at `movenrun/yarn.lock`.
- **`@chainlink/contracts` removed (unused).** A full repo-wide search (Solidity
  imports, TS/JS imports, Hardhat config, scripts, tests, docs, `.env.example`,
  and specifically `AggregatorV3Interface`/`VRF`/`Automation`/`FunctionsClient`)
  found **zero** references anywhere outside `contracts/package.json`'s
  `devDependencies` entry itself. It was a devDependency with no consumer, so it
  has been **removed** from `contracts/package.json` and `yarn.lock`
  regenerated — not aliased, not kept "for later." Removing it also drops its
  entire transitive subtree (including a git-hosted `@zksync/contracts` /
  `matter-labs/era-contracts` dependency that previously required Yarn's
  internal "classic bootstrap" fetch), so no `resolutions` override or any
  other workaround is needed for that subtree anymore. If Chainlink is ever
  genuinely needed by future Solidity, add it back as a real dependency and
  resolve its transitive deps normally — never alias one package's identifier
  to an unrelated package's implementation.
- **`.github/workflows/contracts-checks.yml` (new).** Runs on PRs/pushes
  touching `movenrun/contracts/**` or `movenrun/shared/**`: `corepack enable`
  → `yarn install --immutable` → `yarn workspace @movenrun/contracts compile`
  → `yarn workspace @movenrun/contracts test`. **No deployment environment
  variables, no deployer private key, no Base RPC secret, and no Basescan API
  key are used or required — this workflow never deploys anything and never
  makes a network call to a chain.** No test-path filter is applied, so it
  runs every test file under `contracts/test/` — the 26 pre-existing V1 tests,
  the 17 V1 characterization tests, the 6 deployment-command safety tests,
  and any future suite (e.g. a V2 suite, once merged) automatically.
- **Root `verify:contracts` script (new).** `yarn verify:contracts` runs the
  same compile + test sequence locally. The full monorepo verification suite
  (`yarn test` / `yarn build` across every workspace) is intentionally **not**
  expanded yet — backend/shared build work is out of scope here.
- **The unsafe `deploy:mainnet` command was removed** from
  `contracts/package.json` with no replacement added (see
  [`CONTRACT_V1_DISCREPANCIES.md` §16](./CONTRACT_V1_DISCREPANCIES.md#16-mainnet-deployment-script-mismatch--critical--fixed-tooling-only)).
  **Mainnet deployment remains intentionally unsupported** until a dedicated,
  reviewed, chain-asserting mainnet deployment script exists. `deploy:local`,
  `deploy:sepolia`, `verify:sepolia`, `compile`, `test`, and `coverage` are all
  unchanged.
- **Base Sepolia V1 is untouched.** `contracts/src/**/*.sol`,
  `contracts/deployments/baseSepolia.json`, `hardhat.config.ts`, and
  `scripts/deploy/baseSepolia.ts` are byte-identical before/after this PR. No
  deployment ran; no address changed.
- **V2 is out of scope here.** The isolated V2 contract suite lives only on
  the separate, still-open PR #45 branch
  (`claude/contracts-v2-territory-economy-vv3xpk`) and was neither read from
  nor written to by this change. This PR's stated purpose is to prepare the
  repository (deterministic lockfile + real contract CI) so that PR can later
  be rebased onto `main` and verified through `contracts-checks.yml`.

**Updated follow-up gates (contracts):**
- Rebase and revise PR #45 (V2 territory-economy contracts) on top of this PR
  once merged, so it is verified by `contracts-checks.yml` instead of only
  local runs.
- A real, chain-asserting mainnet deployment script — only once mainnet
  deployment is actually planned and reviewed; none exists today.
- Resolve the pre-existing `@nomicfoundation/hardhat-ignition*` /
  `@nomicfoundation/hardhat-verify` peer-dependency range warnings surfaced by
  `yarn install` (`YN0060`) — non-blocking today, unrelated to this PR's scope.

### Revision: invalid dependency workaround removed, package-manager
### verification consolidated (this revision)

A prior revision of this same change had introduced two things that did not
meet engineering-quality standards and have since been corrected:

1. **The `resolutions` package-impersonation override has been removed
   entirely, with no replacement alias.** Root `package.json` no longer
   contains any `resolutions` field. Substituting `@openzeppelin/contracts` for
   `@zksync/contracts` under a `resolutions` alias — even for an allegedly
   unused transitive dependency — made an unrelated package masquerade as a
   different package with a different API, path, and security surface. That is
   never acceptable, so instead of aliasing around the dependency that made it
   "necessary," the dependency itself was removed (see above): once
   `@chainlink/contracts` is gone, so is its entire `@zksync/contracts`
   transitive subtree, and no override is needed.
2. **Yarn version verification is now a single reusable script**,
   `movenrun/scripts/verify-package-manager.mjs` — zero dependencies, reads
   root `package.json`'s `"packageManager"` field (the one authoritative
   source for the pinned Yarn version), runs `yarn --version`, and fails
   loudly with both values printed on any mismatch. `contracts-checks.yml`,
   `backend-checks.yml`, and `mobile-checks.yml` all call this one script
   immediately after `corepack enable`, instead of each independently
   printing (and never actually checking) `yarn --version`, and instead of
   hardcoding "4.9.1" as an independent constant anywhere in workflow YAML.
3. **Workflow path filters were widened.** A dependency or package-manager
   change (root `package.json`, `yarn.lock`, `.yarnrc.yml`, or the
   verification script) can affect the contracts and backend workspaces even
   when no file under `contracts/**`/`backend/**` itself changes, so both
   `contracts-checks.yml` and `backend-checks.yml` now also trigger on those
   root files (see their `on.pull_request.paths`/`on.push.paths` above).
   `mobile-checks.yml` already ran on every PR/push with no path filter and is
   unchanged in that respect.
4. **Test deduplication.** `test/v1-characterization/05-deploy-script.char.test.ts`
   previously re-asserted several current-state facts (no command targets
   `baseMainnet`, the Sepolia command's exact `--network` flag) that
   `test/tooling/deploymentCommands.test.ts` already asserts authoritatively
   and more thoroughly. The historical file was trimmed to two tests: a
   minimal regression guard (`deploy:mainnet` no longer exists) plus the one
   historical root-cause fact (the Base Sepolia script's own hardcoded
   network/chainId/output-file metadata) that isn't restated elsewhere. This
   drops the characterization suite from 18 to **17** tests — contracts test
   totals below are updated accordingly (26 + 17 + 6 = **49**, not 50).
