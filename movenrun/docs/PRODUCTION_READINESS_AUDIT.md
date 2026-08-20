# MovenRun — Production Readiness Audit

**Date:** 2026-08-20 · **Scope:** `backend/`, `contracts/`, `mobile/`, `shared/`, CI
**Method:** full read of the API surface, middleware, services, workers, all 8 Solidity
contracts, the mobile client, and the GitHub Actions workflows. Every finding below was
verified against the code, with file and line references.

---

## Executive summary

You asked for "risk free." That is not a state software reaches, so this audit gives you
the honest version: **what would actually hurt you, ranked, with the fix for each.**

The identity/wallet subsystem (`backend/src/identity/**`) is genuinely strong work —
peppered HMAC secret storage, constant-time comparison, refresh-token family rotation with
replay detection, shared-store replay authority, fail-closed configuration, and a real
threat model with test evidence. That module is not the problem and is largely left alone
here.

**The problems are everywhere else**, and three of them mean the product does not work
today at all:

| | Finding | Effect |
|---|---|---|
| **C1** | `require()` used in an ESM module | Every GPS route verification throws. **No user can ever earn.** |
| **C2** | `tsc` configured with `noEmit`, but `start` runs `dist/index.js` | `yarn build` produces nothing. **The backend cannot be deployed.** |
| **C3** | Async Express 4 handlers with no `try/catch` | One DB blip → unhandled rejection → **process exit.** |

And five findings would cost real money the moment the token economy is live:

| | Finding | Effect |
|---|---|---|
| **C4** | `declareChallenge` guard is logically inverted | Active challenges can be overwritten (burning up to 1,500 MOVE of other users' spend); resolved zones lock forever. |
| **C5** | `resolveChallenge` transfers an NFT it was never approved for | **Winning challengers always revert.** 100 MOVE burned for an unwinnable fight. |
| **C6** | `reclaimDormant` never clears `accumulatedYield` | The next minter of a hex **withdraws the previous owner's yield.** |
| **C7** | `withdrawTreasury` ignores tokens backing user stakes | One EOA can make `unstake()` revert for everyone. Principal locked. |
| **C8** | No pause, no proxy, and `mintingPaused` is never read | If any of the above is exploited on mainnet, **there is no way to stop it.** |

**Bottom line: do not deploy to Base mainnet.** The Base Sepolia deployment is fine as a
testbed. C1–C3 are hours of work. C4–C9 must be fixed and then externally audited before
any contract holds value.

---

## P0 — Blockers

### C1. `require()` in an ESM module breaks every route verification
`backend/src/services/gps.service.ts:58`

```js
const { createHash } = require("crypto");
```

`backend/package.json` declares `"type": "module"`. `require` is not defined in ESM scope,
so `buildRouteHash()` throws `ReferenceError` on every call. The GPS worker catches it,
marks the route `REJECTED` with `"Worker error: require is not defined"`, and rethrows.

**Effect: the core Move → Capture → Defend → Own loop is 100% non-functional.** Every
submitted run is rejected.

**Fix:** hoist to a static import at the top of the file:
```ts
import { createHash } from "node:crypto";
```

---

### C2. The backend cannot be built or started
`backend/tsconfig.json:16,30` · `backend/package.json:8,9`

```jsonc
"noEmit": true,
"include": ["src/blockchain/**/*", "src/identity/**/*", "src/db/**/*"]
```
```json
"build": "tsc",
"start": "node dist/index.js",
```

Two compounding problems:

1. **`noEmit: true` means `yarn build` writes no files.** `dist/index.js` never exists, so
   `yarn start` fails. There is no Dockerfile and no deploy manifest in the repo, so this
   has never been exercised.
2. **`include` covers three directories.** `routes/`, `services/`, `middleware/`,
   `workers/`, and `repositories/` — the entire territory/token surface — are **never
   type-checked**. C1 is exactly the class of bug a typechecker catches; it survived
   because the file is outside the include list.

CI runs `typecheck` and `test` but never `build`, so none of this is visible.

**Fix:** add a `tsconfig.build.json` with `noEmit: false`, `outDir: "dist"`, and full `src`
coverage; expand the base `include` to all of `src`; fix the resulting type errors
(the `@movenrun/shared` bare-specifier resolution gap noted in the tsconfig comment is the
real blocker here and needs the shared package's build wired up); add `yarn build` to CI.

---

### C3. Unhandled promise rejections kill the API process
`backend/src/routes/gps.ts:33,58` · `routes/zones.ts:27`

Express **4** does not forward rejected promises from async handlers to the error
middleware. Three handlers have no `try/catch`:

- `POST /gps/submit` — `submitRoute()` (Postgres) and `gpsQueue.add()` (Redis)
- `GET /gps/verify/:id` — `getRouteView()` (Postgres)
- `POST /zones/mint` — `getMintEligibility()` and `signZoneMint()`

A momentary Postgres or Redis failure produces an unhandled rejection. Node 15+ defaults to
`--unhandled-rejections=throw`, so **the process exits.** There is no `unhandledRejection`
or `uncaughtException` handler anywhere, no graceful shutdown, and no `trust proxy` setting.

**Fix:** wrap handlers in an `asyncHandler` helper (or upgrade to Express 5, which forwards
rejections natively), and add process-level guards plus SIGTERM draining — see M3.

---

### C4. `declareChallenge`'s guard is inverted — both directions are wrong
`contracts/src/ZoneChallenge.sol:74-77`

```solidity
require(
    !challenges[hexId].resolved || challenges[hexId].challenger == address(0),
    "ZoneChallenge: challenge already active"
);
```

Walk the three states:

| State | `resolved` | `challenger` | Evaluates to | Should be |
|---|---|---|---|---|
| Fresh hex | `false` | `0x0` | **passes** ✓ | pass |
| **Active challenge** | `false` | set | **passes** ✗ | reject |
| **Resolved challenge** | `true` | set | **rejects** ✗ | pass |

**An active challenge can be overwritten.** `challenges[hexId] = Challenge({...})` replaces
the whole struct, destroying:
- the first challenger's 100 MOVE `DECLARATION_COST`
- the defender's stronghold boosts (up to 3 × 300 = 900 MOVE)
- the defender's time extension (500 MOVE)
- both parties' accumulated scores

An attacker can re-declare repeatedly for 100 MOVE a time to permanently reset any
challenge and burn the defender's investment. That is up to **1,500 MOVE destroyed per
grief**, and the defender has no counter.

**A resolved challenge locks the zone forever.** Once `resolved == true`, no one can ever
challenge that hex again.

**Fix:**
```solidity
Challenge storage existing = challenges[hexId];
require(
    existing.challenger == address(0) || existing.resolved,
    "ZoneChallenge: challenge already active"
);
```
and `delete challenges[hexId];` before writing the new struct.

---

### C5. `resolveChallenge` always reverts when the challenger wins
`contracts/src/ZoneChallenge.sol:177` · `contracts/src/ZoneNFT.sol:26,49-51`

```solidity
zoneNFT.safeTransferFrom(defender, challenger, uint256(hexId));
```

ERC-721 requires `msg.sender` to be the owner, an approved address, or an approved
operator. `ZoneChallenge` is none of these. `ZoneNFT` stores a `challengeContract` address
via `setChallengeContract` — and **never reads it.** Verified: no `_update` override, no
`_isAuthorized` override, no `isApprovedForAll` hook.

So the transfer reverts. Because `c.resolved = true` is set earlier in the same call, the
revert rolls that back too: the challenge is **permanently unresolvable**, the challenger's
100 MOVE is gone, and no cooldown is ever recorded.

**Fix:** override `_isAuthorized` in `ZoneNFT` to treat `challengeContract` as an
authorized operator, or grant `ZoneChallenge` a role that a transfer hook honors. Add a
test that asserts a challenger win actually moves the deed.

---

### C6. `reclaimDormant` hands the previous owner's yield to the next minter
`contracts/src/ZoneNFT.sol:107-114`

```solidity
_burn(uint256(hexId));
delete ownershipStart[hexId];
delete isDormant[hexId];
```

`accumulatedYield[hexId]` is **not** cleared. After reclaim the hex can be minted by anyone
else; `mintZone` does not reset it either. The new owner calls `withdrawYield(hexId)` and
receives MOVE that the *previous* owner earned.

**Fix:** `delete accumulatedYield[hexId];` on reclaim — or better, sweep the balance to the
treasury (or to the departing owner) explicitly rather than silently dropping it.

Related, and worth a product decision: `markDormant`/`reclaimDormant` are permissionless
and `lastActivity` only advances on `creditZoneYield`. A zone that earns no yield for 180
days is reclaimable **even if its owner is active every day** — they lose an NFT they paid
500 MOVE for. That is a consumer-harm and chargeback risk, not just a code issue.

---

### C7. `MoveVault` can be drained out from under stakers
`contracts/src/MoveVault.sol:91-97,72-85`

```solidity
function withdrawTreasury(address to, uint256 amount) external onlyRole(DAO_ROLE) {
    require(treasuryBalance >= amount, "MoveVault: insufficient treasury");
    treasuryBalance -= amount;
    moveToken.transfer(to, amount);
}
```

`treasuryBalance` is a bookkeeping integer. The check never confirms the vault's **actual**
MOVE balance still covers `totalStaked`. `DAO_ROLE` is granted to `msg.sender` — a plain
EOA — in the constructor. One key can withdraw the tokens backing user stakes, after which
every `unstake()` reverts and principal is locked.

Second bug in the same file: `_claimReward` silently no-ops when `treasuryBalance < reward`.
The comment claims *"the accrual window stays open so nothing is lost."* It is wrong —
`unstake()` calls `_claimReward` first, then reduces `stakes[user].amount`. A user who fully
unstakes while the treasury is dry sets `amount = 0`, and **all accrued unpaid rewards are
permanently destroyed.**

**Fix:** enforce `moveToken.balanceOf(address(this)) - totalStaked >= amount` in
`withdrawTreasury`; track unpaid reward debt in a `pendingRewards[user]` mapping that
survives unstaking; move `DAO_ROLE` to a multisig behind a timelock.

---

### C8. There is no way to stop an incident
Across all of `contracts/src/`

- **No contract inherits `Pausable`.** Verified across all 8.
- **No contract is behind a proxy.** No upgrade path.
- **`SeasonController.mintingPaused` is never read by anything.** Verified:
  `MoveToken.mintMOVE` does not consult `isMintingAllowed()`. The advertised "mint pause
  window" is decorative — it sets a flag nobody checks.

Combined with C4–C7, an exploit on mainnet would be unstoppable and unfixable.

**Fix (before mainnet, in order):** add `Pausable` with a guardian role to `MoveToken`,
`ZoneNFT`, `ZoneChallenge`, and `MoveVault`; wire `mintMOVE` to actually check
`isMintingAllowed()`; decide deliberately on upgradeability (UUPS behind a timelock, or
immutable-plus-migration — either is defensible, silence is not); then get an external audit.

---

### C9. The oracle key is a single hot EOA that can mint the supply
`backend/src/services/oracle.service.ts:36` · `backend/src/workers/keeper.worker.ts:26`

`ORACLE_PRIVATE_KEY` is read from env into `new ethers.Wallet(...)` in the API process.
Anyone holding it can sign arbitrary route proofs and mint MOVE for unlimited addresses
(bounded only by the 200 MOVE/address/day cap — trivially parallelized across addresses).

Worse, `keeper.worker.ts` reuses **the same key** as its transaction-signing wallet. That
means one key spans two very different trust domains, it must hold ETH for gas, and every
keeper transaction publishes its address on-chain as a named target.

There is no KMS/HSM, no signer isolation, no rotation mechanism in code (`docs/KEY_ROTATION.md`
describes a process, not an implementation), and no separation between "sign attestations"
and "send transactions."

**Fix:** move attestation signing behind a KMS (AWS KMS / GCP KMS support secp256k1) or a
dedicated signer service with its own authz; use a **separate** keeper key; add on-chain
operator rotation with a timelock; alert on any mint whose signature did not originate from
the signer service.

---

## P1 — High

### H1. Rate limiting does not work as deployed
`backend/src/index.ts` (no `trust proxy`) · `backend/src/middleware/rateLimit.ts` (no store)

Two independent breakages:

1. **`app.set('trust proxy')` is never set.** Behind any load balancer, CDN, or reverse
   proxy — i.e. any real deployment — `req.ip` returns the *proxy's* address. Every client
   collapses into one bucket. One user hitting the limit **locks out everyone** (a
   self-inflicted DoS), and the write limiter's `${ip}:${wallet}` key degrades to a single
   shared prefix.
2. **No store is configured**, so `express-rate-limit` uses its in-memory `MemoryStore`.
   Limits are per-instance (3 replicas = 3× the intended limit) and reset on every deploy.
   `ioredis` is already a dependency.

**Fix:** `app.set('trust proxy', 1)` (match the actual hop count — don't use `true`), and
add `rate-limit-redis` backed by the existing Redis connection.

---

### H2. Replay protection is per-process and in-memory
`backend/src/middleware/auth.ts:78-86`

The code documents this itself: *"NOT production-grade: it doesn't survive a restart and
doesn't work across more than one backend instance."* A captured signed request can be
replayed against a different instance, or after a restart, for up to `AUTH_MAX_AGE_SECONDS`
(default **300s**).

Also `pruneExpiredNonces(now)` iterates the **entire** Map on every authenticated request —
O(n) per request. Under load that is a P99 latency cliff.

**Fix:** move nonces to Redis with a TTL of `AUTH_MAX_AGE_SECONDS` and use `SET NX` for
atomic single-use consumption — this deletes the prune scan too. The identity module
already does exactly this pattern correctly (`SECURITY_CHECKLIST.md` row 10, "Replay
authority is shared store"); apply it here.

---

### H3. Raw GPS location history is retained in Redis forever
`backend/src/routes/gps.ts:48` · `backend/src/workers/gps.worker.ts`

The backend is careful never to persist raw GPS points to Postgres — `route.service.ts`
says so explicitly and `getRouteView` returns only safe scalars. But the BullMQ job payload
**is** the raw point array (up to 10,000 coordinates), and `gpsQueue.add("verify-route", job)`
passes **no options**: no `removeOnComplete`, no `removeOnFail`.

BullMQ's default keeps completed and failed jobs indefinitely. So every user's precise
location trace — home, workplace, daily pattern — accumulates in Redis permanently.

This defeats the entire privacy design, and it is your sharpest **GDPR** exposure: location
is personal data, there is no retention limit, no Article 17 erasure path, and no documented
processor boundary. It is also unbounded memory growth ending in a Redis OOM.

**Fix:** `{ removeOnComplete: true, removeOnFail: { age: 3600 } }` at minimum. Better: strip
coordinates from the job payload entirely — write points to a short-TTL keyed blob, pass the
key, and delete it in the worker's `finally`.

---

### H4. GPS jobs never retry — one blip permanently destroys a user's run
`backend/src/routes/gps.ts:48`

No `attempts`, no `backoff` → BullMQ default is **1 attempt**. The worker's catch block
marks the route `REJECTED` and rethrows. A one-second Postgres failover or RPC hiccup
permanently rejects a legitimate run, and the user's earnings are gone with no appeal path.
There is no dead-letter queue.

**Fix:** `{ attempts: 5, backoff: { type: "exponential", delay: 2000 } }`. Critically,
**distinguish infrastructure failures from validation rejections** — only validation
failures should write `REJECTED`; infrastructure failures should leave the route retryable.
Add a DLQ and alert on it.

---

### H5. Nothing has a timeout or a circuit breaker
`token.service.ts:9` · `blockchain/readClient.ts:73` · `db/client.ts:29` · `keeper.worker.ts:36`

| Call | Configured timeout | Actual default |
|---|---|---|
| `ethers.JsonRpcProvider` | none | **300 seconds** |
| `pg.Pool` | none | max 10 conns, **no** `connectionTimeoutMillis`, no `statement_timeout` |
| `tx.wait()` (keeper) | none | **waits forever** |
| HTTP server | none | no `requestTimeout` / `headersTimeout` (slowloris) |

One slow dependency stalls every worker and every request. There is no circuit breaker
anywhere, so a degraded RPC provider takes the whole API down instead of failing fast.

The keeper also constructs a fresh `JsonRpcProvider` and `Wallet` per job with no nonce
management — two concurrent jobs will collide on nonce and one will be silently replaced.

**Fix:** set explicit timeouts on all four; add `connectionTimeoutMillis: 5000` and
`statement_timeout` to the pool; wrap RPC reads in a circuit breaker (`opossum` or similar);
give the keeper a single long-lived provider with serialized nonce handling.

---

### H6. `GET /users/:address` is an unauthenticated RPC amplifier
`backend/src/routes/users.ts:8` · `backend/src/services/token.service.ts:29`

Every call makes a live `getBlockNumber()` round trip to your paid RPC provider. The
endpoint is unauthenticated and protected only by the coarse global limiter (which, per H1,
does not actually work behind a proxy). Block number changes every ~2s on Base, so caching
it for 2 seconds would eliminate essentially all of this load.

An attacker burns your RPC quota for free, adds RPC latency to every user's request, and may
push you past your provider's ToS.

**Fix:** cache block number for 2s in-process (or in Redis); require auth or a tighter
per-IP limit on this route.

---

### H7. Emission rate is computed three different ways
`contracts/src/MoveToken.sol:161` · `backend/src/services/token.service.ts:41` · `shared/src/constants/emission.ts`

| Source | Formula | Result |
|---|---|---|
| **Contract** | `(block.number - deployBlock) / HALVING_INTERVAL`, `rate / 2` each | 0.5^epoch |
| **Backend** | `BigInt(block) / HALVING_INTERVAL` — **absolute height** | 0.5^epoch, wrong epoch |
| **Docs** | `BASE_RATE * 0.7^epoch` → "10, 7, 4.9, 3.43" | 0.7^epoch |

The backend is **missing `- deployBlock`**. At Base's current height that computes ~11
phantom halvings, so `GET /users/:address` reports `currentRate` roughly **2,000× lower**
than the contract's real rate. And the documented 0.7^epoch curve is not what the contract
implements at all.

The constants comment also states *"Halving every ~6 months on Base (~2.6M blocks at 2s)"* —
2,600,000 × 2s ≈ **60 days**, about two months, not six.

Publishing a wrong earnings rate to users is a financial-misrepresentation risk, not just a
cosmetic bug.

**Fix:** have the backend read `deployBlock` and `currentRate()` **from the contract** rather
than reimplementing the math — one source of truth. Correct the docs to match whichever
curve you actually want, and fix the halving-interval comment.

---

### H8. Anti-cheat will not survive contact with GPS spoofers
`backend/src/services/gps.service.ts:3,60-67`

```ts
const MAX_SPEED_MS = 22; // ~80 km/h
```

- **80 km/h passes as running.** Anyone in a car under that speed farms tokens freely.
- **Point-to-point checks only** — no average-pace check, no route-shape plausibility, no
  accelerometer/cadence corroboration.
- **No mock-location detection** (`isFromMockProvider` on Android) and **no device
  attestation** (Play Integrity / DeviceCheck). Free spoofing apps produce flawless
  synthetic routes that pass every current check.
- **`buildRouteHash` is SHA-256 over full-precision floats**, so the duplicate-hash check is
  defeated by jittering one coordinate by 1e-12. Only the time-overlap check has real teeth.
- `confidence: 0.95` is a hardcoded constant, not a computed confidence.

This is the failure mode that ended STEPN's economy. Per your own `CLAUDE.md` guardrail —
*no liquid reward economy before reliable GPS verification* — **this is the gate**, and it
is not met.

**Fix, roughly in order of value:** device attestation + mock-location rejection (biggest
single win); realistic speed bands by activity type; average-pace and stop-distribution
checks; per-account daily distance caps; server-side route-shape scoring; a manual review
queue for high-value claims.

---

### H9. The mobile app has no error boundary and no crash reporting
`mobile/` — verified: no `ErrorBoundary`, no `componentDidCatch`, no Sentry, no Crashlytics

A single render throw produces a white screen, and **you will never learn it happened.**
There is no `expo-updates` either, so a bad release cannot be rolled back over the air —
every fix requires a full store round trip.

**Fix:** add a root error boundary with a recovery action; add Sentry (`sentry-expo`) with
release health; add `expo-updates` with a rollback channel.

---

### H10. Expo SDK 51 is past Google Play's target-API window
`mobile/package.json` (Expo `~51.0.0`, RN `0.74.1`) · `mobile/eas.json`

SDK 51 / RN 0.74 ship `targetSdkVersion 34`. Google Play has required 35 for uploads since
August 2025 and raises the bar every August. **As of today, this build cannot be published
or updated on Play.**

`eas.json` also has no `autoIncrement`, so the second upload collides on `versionCode`, and
there is no iOS production profile at all.

`CLAUDE.md` correctly requires any SDK upgrade be a separate, device-tested PR. That PR is
now on the critical path to shipping.

**Fix:** dedicated SDK upgrade PR (51 → current) with `expo install --fix` + `expo-doctor`
+ device testing; add `"autoIncrement": true` to the production profile; add an iOS profile.

---

### H11. No privacy policy or Data Safety disclosure — for a location-tracking app
`mobile/app.json` · repo-wide

The app requests foreground location and there is **no privacy policy URL anywhere in the
repo.** Also missing: a Play Data Safety mapping, a consent record, a retention statement,
and an in-app account-deletion path (Play now requires one for any app with accounts).
`app.json` declares only `locationWhenInUsePermission`; iOS
`NSLocationAlwaysAndWhenInUseUsageDescription` is absent.

Combined with H3 (indefinite raw-location retention in Redis), this is the **single sharpest
legal exposure in the repository** and a hard store-review blocker.

**Fix:** publish a privacy policy covering location specifically; complete the Data Safety
form; implement in-app deletion wired to actual erasure (including the Redis job data);
add the iOS usage strings; document the retention window and enforce it in code.

---

### H12. Token design carries securities and gambling exposure that is unaddressed
`docs/TOKENOMICS.md` · `contracts/src/ZoneNFT.sol` · `contracts/src/ZoneChallenge.sol`

Two structures deserve counsel review before any liquid economy:

1. **Zone Deed NFTs** are sold for MOVE and marketed as earning "a capped share of the
   economy." An asset purchased with an expectation of profit derived from the efforts of
   others is the textbook Howey pattern.
2. **Challenge declarations** burn 100 MOVE for a chance to take another user's paid asset,
   with the outcome partly determined by the other party's spending. In several
   jurisdictions that reads as a wager.

The repo has no terms of service, no geo-fencing, no jurisdiction exclusion list, and no
KYC/AML consideration. `CLAUDE.md`'s guardrail is a scope rule, not a legal control.

**Fix:** get securities counsel on the deed structure and gaming counsel on challenges,
both **before** mainnet; add ToS + jurisdiction gating; keep MOVE non-transferable until
you have those opinions in writing.

---

## P2 — Medium

### M1. You cannot debug a production incident
17 bare `console.log`/`console.error` calls; no structured logger, **no request IDs, no
metrics endpoint, no tracing, no alerting.** The global error handler at `index.ts` does
`console.error(err)`, which can dump request-bound PII (wallet addresses, emails, GPS
payloads) into plaintext logs.

With no SLIs there is nothing to build SLOs or error budgets on.
*Covers: Logging, Monitoring, Metrics, Distributed Tracing, Alerting, SLOs, SLIs, Error Budgets, Observability.*

**Fix:** `pino` with redaction paths; an `x-request-id` middleware propagated to logs and
workers; `prom-client` on `/metrics`; OpenTelemetry traces across API → queue → worker;
alerts on error rate, queue depth, DLQ size, and oracle-signing volume.

### M2. `/health` never checks its dependencies
`index.ts` returns `{ status: "ok" }` unconditionally. An orchestrator keeps routing traffic
to an instance whose Postgres and Redis are both gone. There is no readiness probe for the
main app (identity exposes its own at `/identity/ready`).

**Fix:** keep `/health` as liveness; add `/ready` that pings Postgres and Redis with a short
timeout; point the load balancer at `/ready`.

### M3. No graceful shutdown
`app.listen()`'s return value is discarded. No SIGTERM handler, no `server.close()`, no
`worker.close()`, no pool drain. Every deploy drops in-flight requests and kills in-progress
route jobs, leaving rows stuck in `PROCESSING` forever (the worker's own comment
acknowledges this).
*Covers: Rolling Deployments, Blue-Green, Canary, zero-downtime.*

**Fix:** capture the server, handle SIGTERM/SIGINT → stop accepting → drain in-flight →
`worker.close()` → `pool.end()` → exit. Add a `PROCESSING`-reaper for orphaned rows.

### M4. No dependency or secret scanning; a forbidden dependency is still shipping
No Dependabot config, no CodeQL, no `yarn npm audit`, no secret scanning in CI.

The backend still depends on **`@anthropic-ai/sdk`** and validates `ANTHROPIC_API_KEY` in
`config.ts`, even though `CLAUDE.md` explicitly forbids AI APIs and keys. It is unused —
dead weight and live attack surface.

CI also lacks `timeout-minutes` on the backend and mobile jobs (a hung job burns 6 hours of
runner time), has no `concurrency` group (duplicate runs stack on rapid pushes), and does no
dependency caching.

**Fix:** remove `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY`; add Dependabot + CodeQL +
`yarn npm audit --severity high`; add `timeout-minutes`, a `concurrency` group, and yarn
caching to every workflow.

### M5. Input-validation gaps that become crashes the moment the stubs are real
`hexId` is `z.string()` with no H3 validation on `POST /zones/mint`, and **no validation at
all** on `GET /zones/:hexId` and `GET /battles/:hexId`. `toHexIdUint64` does
`BigInt("0x" + hexId)` — throws on non-hex input; ethers throws again on anything exceeding
uint64. Same shape in `TokenService.calculateEarning`, where `BigInt(distanceMeters)` throws
on a non-integer float (GPS distances *are* floats).

Today `getMintEligibility` always returns `isEligible: false` because `getHexActivity` is a
stub returning zeros — so the 403 accidentally shields the crash. **The moment that stub is
wired to real data, `POST /zones/mint` becomes a one-request process kill** via C3.

**Fix:** validate `hexId` with `h3.isValidCell()` at the schema boundary on every route that
accepts one; `Math.round()` before `BigInt()`; fix C3 so validation failures can't take the
process down regardless.

### M6. `greatBurn` burns nothing, silently
`contracts/src/SeasonController.sol:100-105` calls
`moveToken.transferFrom(owner, daoTreasury, burnAmount)` inside `try { } catch {}`. No zone
owner has ever approved `SeasonController`, and no approval flow exists in the codebase. So
every transfer fails, `totalBurned` stays 0, and the empty `catch` guarantees you never find
out. **The deflationary sink the tokenomics depend on is inert.**

**Fix:** add an approval step to the zone-owner flow (or use a pull model where owners
settle their own burn); emit a per-zone failure event instead of swallowing; alert when
`totalBurned` is 0 on a season with non-zero yields.

### M7. Admin powers are instant, unbounded, and partly unlogged
`updateBaseRate` accepts any `uint256` with no bounds and no timelock. `setMoveToken`,
`updateOperator`, `setZoneNFT`, `setChallengeContract`, `setSeasonController`, and
`setRewardRate` are all instant single-EOA calls, and several emit **no event** — so there
is no on-chain audit trail of critical config changes. `GPSOracle.updateOperator` lacks the
zero-address check its own constructor has (`FIX-003`), so the oracle can be bricked in one
transaction.

**Fix:** multisig + timelock for `DEFAULT_ADMIN_ROLE`, `GOVERNOR_ROLE`, and `DAO_ROLE`;
sanity bounds on `updateBaseRate` and `setRewardRate`; an event on every setter;
zero-address checks on all of them.

### M8. Mobile network layer: no timeout, no TLS enforcement, no pinning
`mobile/src/services/identityApi.ts:213` — `fetch` with no `AbortController`. React
Native's `fetch` has **no default timeout**, so a hung backend hangs the UI indefinitely
with no recovery path. `readApiBaseUrl()` accepts `http://` without complaint, and there is
no certificate pinning on an app that carries wallet session tokens.

**Fix:** `AbortSignal.timeout(15000)` on every request; reject non-`https` base URLs outside
dev; consider pinning before the wallet surface goes live.

### M9. Smaller correctness issues
- **`ZoneNFT.LOYALTY_TIER1` (30 days) is declared but never used** — `getLoyaltyMultiplier`
  jumps from the base 100 straight to TIER2's 125, so days 30–89 silently get no loyalty
  bonus at all despite the constant advertising one.
- **`GpsService.MIN_POINTS` is 10 but `SubmitRouteSchema` accepts `.min(2)`** — routes with
  2–9 points are accepted, queued, processed, and then always rejected. Wasted work and a
  confusing user experience.
- **Stronghold boosts expire 24h after purchase but only count if live at the 14-day
  resolution** — a defender who buys 3 stacks early burns 900 MOVE for exactly zero effect,
  and each purchase *resets* the expiry rather than extending it. Undocumented and
  punishing.
- **`SeasonController.pauseMinting` underflows** (`seasonEnd - MINT_PAUSE_WINDOW`) if called
  before any season starts — reverts with an opaque panic.
- **`MoveVault.stake` resets `stakedAt` on every top-up**, discarding tenure.
- **`ZoneChallenge.submitScore` underflows** (`c.challengeEnd - SCORE_SUBMISSION_CUTOFF`) for
  a nonexistent challenge — panic instead of a clear error.

---

## What is genuinely good

Worth stating plainly, because it sets the standard for the rest:

- **`backend/src/identity/**` is production-quality.** Peppered HMAC storage, constant-time
  comparison with length-blinding, rejection-sampled OTP generation, refresh-token family
  rotation with replay → family revoke, DB-atomic single-use consumption, fail-closed
  config, no-enumeration responses, and an import-boundary test preventing test doubles from
  reaching production.
- **`middleware/auth.ts`** binds method, path, body hash, nonce, issuedAt, and chainId into
  the signed message, hashes the *raw* bytes rather than a re-serialization, and burns the
  nonce only *after* signature verification. The reasoning is documented and correct.
- **`route.service.ts`** is dependency-injected, independently testable, and has a genuine
  race-condition backstop that discards an already-computed signature rather than persisting
  a duplicate.
- **`oracle.service.ts`** mirrors each contract's digest byte-for-byte, binds `chainId` into
  every signature, and **refuses to sign** zero/invalid inputs — `battles/declare` returning
  501 rather than emitting a bad signature is exactly the right call.
- **Contracts show real audit history** (`FIX-001` … `FIX-012`), use OpenZeppelin correctly,
  apply checks-effects-interactions in `withdrawYield`, and dedupe signatures via
  `usedRoutes` / `usedMintSigs` / `usedScoreSigs`.
- **CI is least-privilege** (`permissions: contents: read`), uses immutable installs, pins
  the package manager, and is deliberately deployment-free.

The gap is not capability. It is that this rigor was applied to identity and to the
contracts' *earlier* review passes, and has not yet been applied to the territory/token
layer or to the operational layer.

---

## Recommended sequence

**Week 1 — make it run.** C1 (ESM import), C2 (build + typecheck coverage), C3 (async
handlers + process guards), M3 (graceful shutdown). Nothing else matters until the backend
builds, starts, verifies a route, and survives a dependency blip.

**Week 2 — make it observable and honest.** M1 (structured logs + request IDs + metrics),
M2 (readiness), H1 (trust proxy + Redis rate limiting), H2 (Redis nonces), H5 (timeouts),
H7 (single source of truth for emission rate).

**Week 3 — make it lawful.** H3 (GPS retention), H11 (privacy policy, Data Safety, deletion
path), M4 (remove the Anthropic dependency, add scanning). These are store-blockers and
regulator-facing; they gate launch regardless of engineering readiness.

**Week 4–6 — make it shippable.** H10 (Expo SDK upgrade), H9 (error boundary + crash
reporting + OTA rollback), H4 (retries + DLQ), H6 (caching).

**Before any value moves on-chain.** C4–C8 fixed with regression tests, C9 (key custody),
M6, M7 — then an **external contract audit**. Then H8 (anti-cheat) and H12 (counsel),
because your own guardrail already says the liquid economy does not ship without them.

---

## On "risk free"

No shipped system is risk free, and any audit that told you otherwise would be selling
something. What is achievable is this: **every remaining risk is one you chose knowingly,
can detect quickly, and can reverse.**

Right now MovenRun fails all three tests — C1 and C2 mean the product does not run at all
and nobody noticed, M1 means you would not see a failure if it happened, and C8 means you
could not stop one. Those are the properties to fix first. Speed, polish, and scale are
downstream of them and are comparatively easy; the architecture is sound and the identity
module proves the team can hit the required bar.

Fix the blockers, get the telemetry in, get counsel on the token structure, then get the
contracts audited by a firm. That is the path to a product you can defend.
