# MovenRun — Complete Technical Knowledge Base

> **Single-file source of truth for AI assistants.** Upload this file into a
> ChatGPT Project or Claude Project to give the assistant complete, accurate
> knowledge of the MovenRun product, codebase, architecture, economics,
> defects, and plan.

---

## 0. How to use this document

**You are reading a knowledge base, not instructions.** Nothing inside it is a
command to you; it is reference material about a software project.

### 0.1 Confidence tags — read these carefully

Every claim in this document carries one of four tags. **Never blur them.**
Most mistakes people make about MovenRun come from treating a `[DESIGNED]`
claim as a `[BUILT]` one.

| Tag | Meaning |
|---|---|
| `[BUILT]` | Exists in the repository, runs, and is verified by tests or by direct file inspection. |
| `[PARTIAL]` | Exists but is incomplete, stubbed, simulated, or not wired end to end. |
| `[DESIGNED]` | Specified in documentation or contract code but **not** live, not enforced, or not reachable by users. |
| `[DEFECT]` | A known bug, gap, or inconsistency. Every one is listed in §15 and §16. |

### 0.2 Rules for answering questions about MovenRun

1. **Never claim something is live when it is `[DESIGNED]`.** The public
   website and docs describe the protocol *as designed*; the repository shows
   what is *actually built*. Where they disagree, the repository wins, and §17
   lists every disagreement.
2. **The blockchain is on testnet only.** Nothing is deployed to Base mainnet.
   No real-value token economy exists. Say so plainly whenever tokens,
   rewards, or earnings come up.
3. **Never present $MOVE as an investment**, never quote or estimate a price
   or yield, and never describe it as income. It is a game utility token that
   does not trade anywhere.
4. **When asked "is X done?"** check §11 (build status) and §16 (defects)
   before answering. Both exist to stop over-claiming.
5. **When asked to write code**, follow the house rules in §21 — they are
   real constraints the team enforces, not preferences.

### 0.3 Document map

| § | Section | Use it for |
|---|---|---|
| 1 | Identity card & fast facts | One-paragraph answers |
| 2 | Product model | What the game is and how it plays |
| 3 | Repository map | Where any file lives |
| 4 | Technology stack | Versions, dependencies, tooling |
| 5 | System architecture | How data flows end to end |
| 6 | Smart contracts reference | Per-contract API, constants, roles |
| 7 | Deployment record | Addresses, chain, role wiring |
| 8 | Backend reference | Endpoints, services, workers, schema |
| 9 | Mobile reference | Screens, state, what is real vs simulated |
| 10 | Shared package & website | The remaining workspaces |
| 11 | Build, CI/CD & release | How it ships, what CI covers |
| 12 | Security posture | Threat model, controls, key rotation |
| 13 | Tokenomics: designed vs coded | The economics, honestly |
| 14 | Data model & privacy | What is stored and where |
| 15 | Known defect register (contracts) | The 16 catalogued V1 issues |
| 16 | Additional gaps found in review | Issues outside the register |
| 17 | Documentation drift | Where the docs disagree with the code |
| 18 | Prioritised fix plan | What to do, in what order |
| 19 | Strengths & potential | The honest upside |
| 20 | Weaknesses & risks | The honest downside |
| 21 | House rules & working agreements | Constraints on any new work |
| 22 | Roadmap & phase gates | Sequencing and what unblocks what |
| 23 | Glossary | Every term in one line |
| 24 | Canonical Q&A | Pre-written answers to common questions |

---

## 1. Identity card & fast facts

### 1.1 One paragraph

MovenRun is a **Base-native, GPS-driven territory economy** delivered as a
mobile game. Players walk, run, or cycle in the real world; their route is
verified as genuine movement; the hexagonal map tiles they cross are captured;
and held tiles can become **Zone Deeds** — on-chain NFTs whose token ID *is*
the map cell. A native ERC-20 token, **$MOVE**, is minted by verified movement
and consumed by claiming, upgrading, challenging, and staking. The core design
bet is that all of the blockchain machinery stays **invisible** to ordinary
players: embedded wallets, sponsored gas, and game vocabulary instead of crypto
vocabulary. The canonical loop is **Move → Capture → Defend → Own**.

### 1.2 Fast facts

| Fact | Value | Tag |
|---|---|---|
| Product category | GPS territory game with on-chain ownership | `[DESIGNED]` |
| Core loop | Move → Capture → Defend → Own | `[DESIGNED]` |
| Chain | Base (Ethereum L2) | `[BUILT]` |
| Live network | Base Sepolia testnet, chain ID **84532** | `[BUILT]` |
| Mainnet (Base, 8453) | Configured in Hardhat, **never deployed**, deploy command deliberately removed | `[DESIGNED]` |
| Smart contracts | 8 contracts + 1 interface, ~1,030 lines Solidity | `[BUILT]` |
| Solidity version | `^0.8.24`, OpenZeppelin libraries | `[BUILT]` |
| Contract tests | 49 total (26 functional + 17 characterization + 6 tooling) | `[BUILT]` |
| Token | `MoveToken` ($MOVE), ERC-20, 18 decimals | `[BUILT]` |
| Max supply | 1,000,000,000 $MOVE, hard cap in code | `[BUILT]` |
| Deed | `ZoneNFT` ERC-721, `tokenId == H3 hex id` | `[BUILT]` |
| Map grid | H3 (Uber's hexagon system), resolution 8, ~0.74 km² per cell | `[BUILT]` in backend/shared |
| Backend | Node + Express + BullMQ + Drizzle/Postgres + Redis | `[BUILT]` |
| Mobile | Expo SDK 51 / React Native 0.74.1 / Expo Router v3 / Zustand | `[BUILT]` |
| Mobile territory map | On-device **simulation** on a pseudo-hex lattice, not real H3 | `[PARTIAL]` |
| Wallets in app | Infrastructure complete, **no provider wired**, fails closed | `[PARTIAL]` |
| Live token economy | Not live anywhere | `[DESIGNED]` |
| Monorepo tool | Yarn 4.9.1 workspaces, `nodeLinker: node-modules` | `[BUILT]` |
| Repo | `suhaib155/arena`, MovenRun lives in the `movenrun/` subdirectory | `[BUILT]` |
| Public site | `movenrun-website.vercel.app` (source in `movenrun/website/`) | `[BUILT]` |

### 1.3 The hard guardrail (most important governance fact)

> **No liquid/tradeable reward economy ships before all three of:**
> **(1)** reliable GPS verification, **(2)** real tile/city density (Phase 1
> complete), **(3)** genuine sponsor or land demand.

This is written into `docs/ROADMAP.md` and `CLAUDE.md` as a blocking gate, not
a preference. Until it clears, players earn **XP** and **Locked MOVE** — an
explicitly non-liquid, non-tradeable in-app credit. Anyone asking whether
MovenRun is "another move-to-earn" should be pointed at this gate.

---

## 2. Product model

### 2.1 The four verbs

| Verb | What the player does | What the system does |
|---|---|---|
| **Move** | Walks, runs, or cycles. No minimum speed; all modes equal. | Records the route; produces a verifiable proof of movement. |
| **Capture** | Finishes a session. | Maps the route onto the H3 hexes it crossed; claims those cells. |
| **Defend** | Returns to held zones; fortifies; answers challenges. | Runs the 14-day `ZoneChallenge` contest; adjusts defensive strength. |
| **Own** | Holds, transfers, or trades a Zone Deed. | Mints/keeps an ERC-721 deed under the player's own keys. |

A fifth verb, **Grow**, is used in public-facing material for the compounding
layer (districts, clubs, city standing, governance). Internally the canonical
phrasing is the four-verb loop above.

### 2.2 Scope rule

Every feature must serve **Move → Capture → Defend → Own**. If a proposed
feature does not advance one of the four verbs, it is out of scope. This is the
single most-cited rule in the repository's own guidance.

### 2.3 Progression systems

| System | Status | Notes |
|---|---|---|
| XP and levels | `[BUILT]` mobile, on-device | `src/lib/leveling.ts` |
| Daily streaks | `[BUILT]` mobile, on-device | Once-per-local-day anti-farming |
| Locked MOVE | `[PARTIAL]` — display preview derived from XP | No ledger, nothing stored, nothing earned |
| Zone capture | `[PARTIAL]` — simulated on a local lattice | Real H3 capture is the next milestone |
| Clubs, crews | `[PARTIAL]` — screens + view-models over mock data | No server, no shared state |
| Seasons, city wars | `[PARTIAL]` — screens exist, systems not live | |
| Zone Deeds | `[DESIGNED]` for users; `[BUILT]` on testnet contracts | Not reachable from the app |
| $MOVE earning | `[DESIGNED]` | Blocked by the guardrail |
| Governance | `[DESIGNED]` | `MovenDAO` deployed to testnet, not active |

### 2.4 Player archetypes the product serves

1. **Non-crypto everyday mover** — the volume audience. Never sees a wallet,
   seed phrase, gas fee, or token purchase. Motivated by health, habit,
   streaks, neighbourhood, and club.
2. **Crypto-native player** — the depth audience. Connects an external wallet,
   self-custodies, verifies deeds on a block explorer, trades, stakes, votes.

Both hold **identical** assets. The only difference is how much machinery is
exposed. This dual design is the core strategic bet.

---

## 3. Repository map

### 3.1 Repository-level context

The GitHub repository `suhaib155/arena` contains **two unrelated projects**.
Do not confuse them:

```
arena/                              ← repo root
├── README.md                       ← describes MemeArena, NOT MovenRun
├── index.html                      ← MemeArena artefact
├── MemeArena-NoEmoji.jsx           ← MemeArena artefact (~115 KB)
├── .github/workflows/              ← CI for MovenRun (4 workflows)
└── movenrun/                       ← ★ THE MOVENRUN PROJECT ★
```

**Everything relevant to MovenRun is under `movenrun/`.** The root `README.md`
describes "MemeArena", a separate competitive-creativity platform on Starknet.
This is a leftover, and it is a real source of confusion — see §16, gap G-11.

### 3.2 MovenRun tree

```
movenrun/
├── CLAUDE.md                  Project brief + hard guardrails for AI sessions
├── package.json               Yarn 4 workspace root (shared, contracts, backend, mobile)
├── yarn.lock                  Committed, deterministic
├── .yarnrc.yml                nodeLinker: node-modules
├── scripts/
│   └── verify-package-manager.mjs   CI guard: Corepack Yarn matches packageManager
│
├── shared/                    TS types + constants shared across workspaces
│   ├── package.json           main → ./dist/index.js  ⚠ see gap G-01
│   └── src/
│       ├── constants/  h3.ts · emission.ts · contracts.ts
│       └── types/      zone.ts · gps.ts · token.ts
│
├── contracts/                 Hardhat + Solidity — DEPLOYED to Base Sepolia
│   ├── src/                   8 contracts + interfaces/IGPSOracle.sol
│   ├── test/                  Functional + v1-characterization + tooling suites
│   ├── scripts/deploy/        baseSepolia.ts · local.ts
│   ├── scripts/verify/        verifyAll.ts (Basescan)
│   ├── deployments/           baseSepolia.json ← authoritative address record
│   └── hardhat.config.ts
│
├── backend/                   Express API + BullMQ workers + Drizzle ORM
│   ├── src/
│   │   ├── index.ts           App wiring, middleware order, route mounting
│   │   ├── config.ts          Zod-validated env schema
│   │   ├── routes/            gps · zones · battles · users
│   │   ├── services/          gps · hex · oracle · token · route
│   │   ├── repositories/      route repository (memory + Drizzle)
│   │   ├── workers/           gps.worker · keeper.worker
│   │   ├── middleware/        auth · rateLimit · security
│   │   ├── blockchain/        Read-only RPC client, ABIs, deployments
│   │   ├── db/                schema · identity.schema · provider.schema · client
│   │   ├── identity/          Identity/session/wallet foundation (largest module)
│   │   └── openapi/           identity-v1.yaml
│   └── drizzle/               3 SQL migrations + meta
│
├── mobile/                    Expo React Native app
│   ├── app/                   Expo Router routes (39 screens)
│   ├── src/
│   │   ├── components/        ~30 presentational components
│   │   ├── lib/               ~50 pure view-model / logic modules (+ tests)
│   │   ├── services/          moveTracker · moveSession · questService · identityApi
│   │   ├── store/             useGameStore · useAuthStore (Zustand)
│   │   ├── data/              quests · clubs · contractStatus (mock/static)
│   │   └── theme.ts           Daylight Cartography design tokens
│   └── _legacy/               PARKED GPS/blockchain scaffold — reference only
│
├── website/                   Static marketing site + docs (deployed to Vercel)
│   ├── index.html · css/ · js/
│   └── docs/                  ~24 documentation pages + 14 SVG diagrams
│
└── docs/                      Internal engineering documentation
    ├── ROADMAP.md                   ★ canonical product scope
    ├── ARCHITECTURE.md              Contract flow, oracle, H3, GPS pipeline
    ├── TOKENOMICS.md                Emission, burns, distribution
    ├── CONTRACTS_AUDIT.md           What is deployed, what is missing
    ├── CONTRACT_V1_DISCREPANCIES.md ★ the 16 known contract defects
    ├── MOBILE_TO_TERRITORY_PLAN.md  Shell → territory sequencing
    ├── IDENTITY_WALLET_FOUNDATION.md
    ├── THREAT_MODEL.md              Identity/wallet threat model
    ├── SECURITY_CHECKLIST.md        52-row control matrix
    ├── KEY_ROTATION.md              Rotation/incident/rollback runbook
    ├── PROVIDER_DECISION_MATRIX.md  Wallet-provider evaluation (Blocked)
    ├── PROVIDER_EVIDENCE_REGISTER.md
    ├── PROVIDER_INTEGRATION_SEQUENCE.md
    ├── PROVIDER_QUESTIONS.md
    └── adr/                         ADR-0001 … ADR-0013
```

### 3.3 Directories that must not be deleted

`contracts/`, `backend/`, `shared/`, and `mobile/_legacy/` are **preserved
assets**, not dead code. `mobile/_legacy/` in particular holds the earlier
GPS/map/H3/wallet scaffold and is the reference implementation for the
territory build. Repository policy: preserve ideas by writing them into
`docs/ROADMAP.md`, never by deleting code.

---

## 4. Technology stack

### 4.1 By workspace

| Workspace | Runtime | Key dependencies |
|---|---|---|
| `shared` | TypeScript (ESM) | none (types + constants only) |
| `contracts` | Hardhat, Solidity `^0.8.24` | `@openzeppelin/contracts`, TypeChain, ethers |
| `backend` | Node 20, TypeScript ESM | express 4.19, drizzle-orm 0.31, bullmq 5.7, ioredis 5.3, pg 8.11, ethers 6.12, h3-js 4.1, zod 3.23, helmet 8.2, express-rate-limit 8.5 |
| `mobile` | Expo SDK 51, RN 0.74.1, React 18.2 | expo-router 3.5, expo-location 17, expo-secure-store 13, zustand 4.5, @react-native-async-storage 1.23 |

### 4.2 Tooling and pinned versions

- **Package manager:** Yarn **4.9.1**, pinned via root `packageManager`.
  `nodeLinker: node-modules`. A CI guard (`scripts/verify-package-manager.mjs`)
  fails the build if Corepack provisions a different version.
- **Node:** 20 in CI.
- **Expo SDK:** 51 — an SDK upgrade must be its own device-tested PR, never an
  unverified bump.
- **EAS:** project is linked; `app.json` carries a real
  `extra.eas.projectId` (`73abbcb8-…`), package `io.movenrun.app`.
- **Corepack hook:** `eas-build-pre-install: corepack enable` exists in both
  `movenrun/package.json` and `movenrun/mobile/package.json` because EAS remote
  builders start with Yarn 1 while the repo pins Yarn 4.

### 4.3 Deliberate non-dependencies

The following are **intentionally absent** and must not be added casually:

- No wallet SDK in mobile (no provider selected — see §12.5).
- No AI/LLM provider SDK in mobile, ever. Any future AI features must be
  server-side only.
- No Supabase or alternative backend-as-a-service.
- No map or SVG library in mobile yet — hexagons are plain Views.
- No animation library — motion uses core `Animated` only.
- No background location tracking — foreground watch only.

---

## 5. System architecture

### 5.1 The three layers

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 1 — EXPERIENCE (mobile/)                                   │
│ Expo React Native app. Onboarding, movement sessions, territory  │
│ board, clubs, seasons, profile, account/security screens.        │
│ Holds the embedded wallet the player never sees. [PARTIAL]       │
└──────────────────────────────────────────────────────────────────┘
                    │  raw GPS route, once per session
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 2 — VERIFICATION (backend/)                                │
│ Express API + BullMQ workers. Validates plausibility, computes   │
│ H3 cells, builds a deterministic route hash, signs it with the   │
│ oracle key. This layer makes the economy trustworthy. [BUILT]    │
└──────────────────────────────────────────────────────────────────┘
                    │  a signed proof — never the raw location trail
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 3 — PROTOCOL (contracts/, on Base Sepolia)                 │
│ MoveToken · GPSOracle · ZoneNFT · GearNFT · ZoneChallenge ·      │
│ SeasonController · MoveVault · MovenDAO.                         │
│ System of record for ownership and value. [BUILT, testnet]       │
└──────────────────────────────────────────────────────────────────┘
```

**Critical architectural property:** the chain never trusts the phone. Every
on-chain action that depends on real-world data is gated by an **oracle
signature** produced by Layer 2.

### 5.2 End-to-end movement flow `[PARTIAL — layers not yet connected]`

```
1.  Mobile records a route (expo-location foreground watch)
        │
2.  POST /gps/submit  { walletAddress, points[], startTime, endTime }
        │  (requires wallet-signature auth; write rate-limited)
        ▼
3.  Route persisted status=SUBMITTED → job enqueued on BullMQ "gps-verification"
        ▼
4.  GPS Worker (concurrency 10) marks PROCESSING, then:
        ├── GpsService.validateRoute()   speed / accuracy / duration / monotonic
        ├── GpsService.calculateDistance()  Haversine
        ├── GpsService.buildRouteHash()     SHA-256 over (wallet, points, times)  ⚠ G-02
        ├── HexService.getHexIdsForPoints() H3 res-8 cell set
        ├── server-side dedup: route-hash uniqueness + per-wallet time overlap
        └── OracleService.signRouteProof()  EIP-191 personal signature
        ▼
5.  Route persisted status=VERIFIED with routeHash + oracleSig,
    or REJECTED with rejectionReasons[]
        ▼
6.  Mobile polls GET /gps/verify/:id → receives the proof
        ▼
7.  User submits on-chain:
        GPSOracle.submitRoute(to, routeHash, distanceMeters, hexId, sig)
        ├── recovers signer, requires == oracleOperator
        └── calls MoveToken.mintMOVE(...)
                ├── rejects a re-used routeHash
                ├── applies rate × gear multiplier
                ├── clamps to the daily cap
                ├── tracks unique weekly movers
                ├── credits 2% zone tax to ZoneNFT (pull-payment, try/catch)
                └── mints the remainder to the user
```

### 5.3 Oracle signature payloads (contract ↔ backend must match byte-for-byte)

`OracleService` in the backend mirrors each contract's verification exactly.
`chainId` is bound into **every** payload so a signature cannot be replayed on
another chain.

| Contract call | Signed payload | Encoding |
|---|---|---|
| `GPSOracle.submitRoute` | `(chainid, to, routeHash, distanceMeters, hexId)` | `abi.encodePacked` → keccak256 |
| `ZoneNFT.mintZone` | `(chainid, hexId, msg.sender, mintCost)` | `abi.encodePacked` → keccak256 |
| `ZoneChallenge.declareChallenge` | `(chainid, hexId, zoneOwner, defenderBaseScore)` | `abi.encodePacked` → keccak256 |
| `ZoneChallenge.submitScore` | `(chainid, hexId, msg.sender, score)` | `abi.encodePacked` → keccak256 |
| `SeasonController.greatBurn` | `(chainid, seasonNumber, topHexIds[], yields[])` | **`abi.encode`** (not packed) → keccak256 |

All digests are personal-signed (`signMessage(getBytes(digest))`), matching
`MessageHashUtils.toEthSignedMessageHash` + `ECDSA.recover` on-chain.

**Backend safety rail:** `signChallengeDeclaration` refuses to sign a
zero/invalid defender address or a zero `defenderBaseScore` unless an explicit
test-only `allowUnvalidated` flag is passed — so the not-yet-implemented
on-chain-owner lookup cannot silently become a production path.

### 5.4 H3 identifier conversion

H3 cell IDs are 64-bit values. The backend handles them as **hex strings**
(`h3-js` format, e.g. `8828308281fffff`); the contracts use **`uint64`**.
`toHexIdUint64(hexId)` in `oracle.service.ts` is the single conversion point.
`"0"` / `""` / `"0x0"` map to `0n`, the contracts' "not in any zone" sentinel.

---

## 6. Smart contracts reference

All eight are deployed to Base Sepolia. Source in `movenrun/contracts/src/`.
**Every contract below is immutable as deployed** — the defects in §15 cannot
be patched in place and require a V2 redeploy plus migration.

### 6.1 `MoveToken` — ERC-20 $MOVE (178 lines)

**Purpose:** the network's currency. Oracle-gated minting, halving emission,
daily anti-farming cap, 2% zone tax.

| Constant | Value |
|---|---|
| `MAX_SUPPLY` | `1_000_000_000 ether` |
| `HALVING_INTERVAL` | `2_600_000` blocks (~6 months on Base at 2 s) |
| `ZONE_TAX_BPS` | `200` (2%) |
| `MIN_BASE_RATE` | `0.01 ether` (emission floor, FIX-007) |
| `MAX_DISTANCE_METERS` | `100_000` (100 km per route, FIX-012) |
| initial `baseRate` | `10 ether` (10 $MOVE/km) |

**Roles:** `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` (sets gear multipliers),
`ORACLE_ROLE` (only `GPSOracle` — sole caller of `mintMOVE`), `GOVERNOR_ROLE`
(can raise `baseRate`), `SEASON_ROLE` (emission auto-valve, weekly reset).

**Key state:** `dailyCaps[address]{minted, resetAt}` · `gearMultiplier[address]`
· `usedRoutes[bytes32]` (replay guard) · `lastMintEpoch[address]` ·
`weeklyMint` / `weeklyBurn` / `weeklyMoverCount`.

**`mintMOVE(to, routeHash, distanceMeters, hexId)`** — `ORACLE_ROLE` only:
1. rejects a used `routeHash`; rejects distance > 100 km
2. `earned = distanceMeters × currentRate × gearMultiplier / (1000 × 1e18)`
3. clamps `earned` to the remaining daily cap; reverts if the cap is exhausted
4. enforces `MAX_SUPPLY`
5. increments `weeklyMoverCount` once per address per 7-day epoch
6. if `hexId != 0`, attempts to credit 2% to `ZoneNFT.creditZoneYield` inside a
   `try/catch` — a failed credit silently forfeits the tax rather than
   reverting the mint
7. mints `earned − zoneTax` to the user and `zoneTax` to the ZoneNFT contract

**Halving:** both `_currentRate()` and `_currentDailyCap()` compute
`halvings = (block.number − deployBlock) / HALVING_INTERVAL`, capped at 20, and
**halve** (`/2`) per epoch. Daily cap starts at `200 ether`.

**Auto-valve `adjustEmissionRate()`** — `SEASON_ROLE` only: if
`weeklyBurn/weeklyMint < 0.70`, reduce `baseRate` by 10%, floored at
`MIN_BASE_RATE`. Only ever reduces; raising requires `GOVERNOR_ROLE`. Resets
the weekly counters.

### 6.2 `GPSOracle` — movement attestation bridge (56 lines)

**Purpose:** the only contract holding `ORACLE_ROLE` on `MoveToken`. Verifies
the off-chain oracle's ECDSA signature over
`(chainid, to, routeHash, distanceMeters, hexId)` and forwards to `mintMOVE`.

**State:** `oracleOperator` (the signing EOA, rotatable by admin via
`updateOperator`), `moveToken`.

**Why it matters:** it is the single trust boundary between the real world and
the chain. Compromising `oracleOperator` compromises minting, deed minting,
challenge declarations, scores, and the Great Burn — every signed payload in
the system. Key rotation procedure is documented in `docs/KEY_ROTATION.md`.

### 6.3 `ZoneNFT` — the Zone Deed, ERC-721 (133 lines)

**Purpose:** the land registry. `tokenId == uint256(H3 hexId)`, a bijective
mapping with no secondary lookup.

| Constant | Value |
|---|---|
| `BASE_MINT_COST` | `500 ether` **(declared but unused — see §16 G-06)** |
| `LOYALTY_TIER1` | `30 days` **(declared but unused)** |
| `LOYALTY_TIER2 / 3 / 4` | `90 / 180 / 365 days` |
| `DORMANCY_PERIOD` | `180 days` |
| `RECLAIM_PERIOD` | `210 days` |

**State:** `ownershipStart[hexId]` · `lastActivity[hexId]` ·
`accumulatedYield[hexId]` · `isDormant[hexId]` · `usedMintSigs[bytes32]`.

**`mintZone(hexId, mintCost, oracleSig)`** — requires the hex is unminted and
not dormant; verifies an oracle signature over
`(chainid, hexId, msg.sender, mintCost)`; marks the signature used; burns
`mintCost` from the caller via `burnFrom`; mints the deed; stamps
`ownershipStart` and `lastActivity`.

> The `mintCost` is **supplied as a parameter and authorised by the oracle
> signature**, not computed on-chain. The `500 × √(weeklyMoverCount)` formula
> lives in the backend (`HexService._calculateMintCost`). The on-chain
> `BASE_MINT_COST` constant is inert.

**`getLoyaltyMultiplier(hexId)`** returns 100 / 125 / 150 / 175 for elapsed
ownership of <90 d / ≥90 d / ≥180 d / ≥365 d. **Note:** this differs from
`docs/TOKENOMICS.md`, and it is consumed **only** by `ZoneChallenge` at
resolution — it does **not** affect yield accrual. See §17.

**`creditZoneYield`** is callable only by `MoveToken`, requires the zone to be
minted, adds to `accumulatedYield` and refreshes `lastActivity`.
**`withdrawYield`** pays the whole balance to the current owner.

**Dormancy:** anyone may `markDormant` after 180 days of inactivity, and
`reclaimDormant` after 210 — which burns the NFT and re-opens the hex.

### 6.4 `ZoneChallenge` — land defence (191 lines)

| Constant | Value |
|---|---|
| `CHALLENGE_DURATION` | `14 days` |
| `TIME_EXTENSION` | `3 days`, once per challenge |
| `DECLARATION_COST` | `100 ether` |
| `STRONGHOLD_COST` | `300 ether`, max 3 stacks, `+20%` each, 24 h expiry |
| `TIME_EXT_COST` | `500 ether` |
| `COOLDOWN_DURATION` | `30 days` (loser cannot re-challenge that hex) |
| `SCORE_SUBMISSION_CUTOFF` | `1 hours` before the end (FIX-011) |

**Resolution maths:**
```
adjusted = defenderBaseScore + defenderScore
if stronghold active:  adjusted = adjusted × (100 + 20 × stacks) / 100
adjusted = adjusted × loyaltyMultiplier / 100
challengerScore > adjusted  →  deed transfers to the challenger
otherwise                   →  defender holds; challenger gets a 30-day cooldown
```

`resolveChallenge` is `nonReentrant` and callable by anyone after the window.

> **This contract carries four of the six most severe known defects**
> (§15 issues 1–6). Its lifecycle guard is inverted, settlement depends on the
> losing defender's approval, deeds are transferable mid-challenge, and the
> declaration signature is replayable. Treat the deployed V1 challenge system
> as **non-functional for production**.

### 6.5 `GearNFT` — ERC-1155 gear (93 lines)

Four slots (`Shoes`, `Jacket`, `Watch`, `Headband`). Each gear type has a
`multiplierBps`, a `mintCost`, and an `active` flag, added by `GEAR_ADMIN_ROLE`.
`mintGear` burns $MOVE. `getUserMultiplier` multiplies the equipped items'
basis points into a 1e18 figure. `MoveToken.setGearMultiplier` clamps the value
to `[1e18, 3e18]` — the 3× ceiling is enforced there, not in `GearNFT`.
Base metadata URI: `https://api.movenrun.io/gear/{id}.json` (a domain that is
not currently serving — see §16 G-10).

### 6.6 `SeasonController` — 90-day cycle (117 lines)

`SEASON_DURATION` 90 days · `MINT_PAUSE_WINDOW` 14 days · `GREAT_BURN_PCT`
1000 bps (10%). `KEEPER_ROLE` drives `startSeason` → `pauseMinting` →
`endSeason` → `greatBurn(topHexIds[], yields[], oracleSig)` (max 100 zones,
per-zone `try/catch` so one failure does not revert the batch), then calls
`moveToken.adjustEmissionRate()`. `weeklyKeeperRun()` runs the auto-valve.

> **Two severe defects live here:** the mint pause is advisory only — no
> minting path checks it — and the "Great Burn" is a `transferFrom` to the
> treasury, **not** an ERC-20 burn, so total supply is unchanged. See §15
> issues 7, 8, 9.

### 6.7 `MoveVault` — staking, POL, treasury (111 lines)

`stake` / `unstake` / `claimReward` (all `nonReentrant`), `depositTreasury`,
`withdrawTreasury` (`DAO_ROLE`), `addPOL` (`VAULT_ADMIN_ROLE`),
`setRewardRate` (`DAO_ROLE`). Reward accrual:
`amount × rewardRatePerSecond × elapsed / 1e18`, paid only if the treasury can
cover it in full. See §15 issues 12, 13, 15.

### 6.8 `MovenDAO` — governance (145 lines)

`VOTING_PERIOD` 7 days · `EXECUTION_DELAY` 2 days · `QUORUM_BPS` 1000 (10% of
`MoveVault.totalStaked()`). Proposal threshold: 100 $MOVE. Proposal types:
`ParameterChange`, `TreasurySpend`, `ContractUpgrade`, `EmissionAdjust`.
Voting weight = `stakedAmount + liveBalance`, ×1.5 if staked ≥ 1000 $MOVE.
The documented Tier-1 (zone-owner, 3×) tier is **not implemented**.
Execution is a raw `target.call(callData)` after the delay.

> **Severe defect:** voting weight reads **live transferable balances with no
> snapshot**, so the same tokens can vote from wallet A, be transferred to B,
> and vote again. Quorum is also un-snapshotted. See §15 issue 14.

### 6.9 Contract dependency graph

```
        GPSOracle ──ORACLE_ROLE──▶ MoveToken ◀── burnFrom ── GearNFT
            │  (signs everything)      │  ▲                  ZoneChallenge
            │                          │  │                  ZoneNFT
            │              creditZoneYield │
            │                          ▼  │
            └──oracleOperator read──▶ ZoneNFT ◀── safeTransferFrom ── ZoneChallenge
                                       ▲                                    │
                    SeasonController ──┘  (zoneOwner, greatBurn)            │
                            │  adjustEmissionRate ──▶ MoveToken             │
                            └── KEEPER_ROLE ◀── backend keeper.worker ──────┘
        MovenDAO ──▶ MoveVault (DAO_ROLE) ⚠ not granted as deployed
                 ──▶ MoveToken (GOVERNOR_ROLE)
```

---

## 7. Deployment record

### 7.1 Base Sepolia — the authoritative record

Source of truth: `movenrun/contracts/deployments/baseSepolia.json`, mirrored
into `shared/src/constants/contracts.ts` and (as display-only strings) into
`mobile/src/data/contractStatus.ts`.

- **Network:** `baseSepolia`, **chainId `84532`**
- **Deployer:** `0xf258c07f93417DacB3013c4C3367DFcCfCb5C497`
- **Timestamp:** `2026-05-27T18:08:40Z`
- **Explorer:** `https://sepolia.basescan.org/address/<addr>`

| Contract | Address |
|---|---|
| `MoveToken` | `0x86fD3984D0c4D1A8912Fc168cb6eD2a35B94C1aC` |
| `GPSOracle` | `0x7E3972Cff8fF3Ed352DD649Da2E949Bb80A4aF90` |
| `ZoneNFT` | `0xF9694dA0897916A4c01a2c59f2B8E850AA4FEfD8` |
| `GearNFT` | `0xfE46bcC610761D82A646bdDA2D27fD1d044C09Cc` |
| `MoveVault` | `0x87250370311b8D48C19cA7725c1bdb8B3f7CF556` |
| `ZoneChallenge` | `0x3CC6b92B3051D2C4FbAf92423e427761982685D7` |
| `SeasonController` | `0x687b77f2B047313Bba2eC2C69D9D0618bbA15BdA` |
| `MovenDAO` | `0x5Ed4Ee303fB55CEFBB7460e8FDb5C33424A6fC15` |

Per-contract transaction hashes and constructor arguments are in the same JSON.

### 7.2 Base mainnet

**Nothing is deployed to Base mainnet (chain 8453).** Mainnet is configured in
`hardhat.config.ts` but the `deploy:mainnet` npm script was **deliberately
removed** after it was found to run the Base Sepolia script (which hardcodes
`network: "baseSepolia"`, `chainId: 84532`, and always writes
`deployments/baseSepolia.json`). Six static tooling tests now guard that no
command can produce a Sepolia-labelled artefact while connected to mainnet.
A real mainnet script — with a chain-ID assertion and network-correct metadata
— does not exist yet and is a Phase 3 prerequisite.

### 7.3 Deployment secrets

Deploy scripts read `DEPLOYER_PRIVATE_KEY`, `ORACLE_ADDRESS`, `ADMIN_ADDRESS`,
`TREASURY_ADDRESS`, and RPC URLs **from environment only**
(`contracts/.env.example` holds placeholders; `.env` is git-ignored). No
secret is committed anywhere in the repository.

### 7.4 Known wiring gap

The deploy script grants `MoveToken` roles to `MovenDAO` but **never calls
`moveVault.grantRole(DAO_ROLE, movenDAO)`**. As deployed, the DAO cannot call
`MoveVault.setRewardRate` or `withdrawTreasury` — governance proposals
targeting them fail with `"MovenDAO: execution failed"`. This is the one
catalogued issue fixable **without** a redeploy: a single role grant by the
admin, if that wiring is confirmed to be the intent.

---

## 8. Backend reference

Node 20, TypeScript **ESM** (`"type": "module"`), Express 4.

### 8.1 Application wiring (`src/index.ts`) — middleware order matters

```
1. Security headers        (helmet, via middleware/security.ts)
2. CORS allowlist          (fail-closed: unset CORS_ORIGINS in production is a
                            startup error, never a wildcard)
3. Global rate limiter     (default 300 req / 60 s)
4. /identity/webhooks      ← mounted BEFORE the JSON parser and excluded from
                             it, so HMAC verification runs on the exact raw
                             received bytes
5. express.json({ limit: "2mb", verify: capture rawBody })
                             rawBody is captured so auth body-hashing binds to
                             what was actually sent, not a re-serialisation
6. GET /health             liveness only — no dependency checks
7. /gps  /zones  /battles  /users
8. /identity               (readiness at /identity/ready, separate from health)
9. Error handler           logs, returns a generic 500
```

### 8.2 Environment configuration (`src/config.ts`, Zod-validated)

Invalid environment ⇒ the process **exits at startup**. Fail-closed by design.

| Variable | Type | Default | Notes |
|---|---|---|---|
| `PORT` | number | `3000` | |
| `NODE_ENV` | enum | `development` | development / production / test |
| `DATABASE_URL` | url | — | **required** |
| `REDIS_URL` | url | — | **required** (BullMQ) |
| `ORACLE_PRIVATE_KEY` | `0x…` | — | **required** — the single most sensitive secret |
| `BASE_RPC_URL` | url | — | **required** |
| `BASE_SEPOLIA_RPC_URL` | url | optional | |
| `CHAIN_ID` | number | `84532` | bound into every oracle signature |
| `MOVE_TOKEN_ADDRESS` … `SEASON_CONTROLLER_ADDRESS` | `0x…` | optional | per-contract addresses |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | optional | **leftover — should be removed, see G-09** |
| `H3_RESOLUTION` | number | `8` | |
| `AUTH_MAX_AGE_SECONDS` | number | `300` | signed-request validity window |
| `CORS_ORIGINS` | csv | optional | fail-closed in production |
| `RATE_LIMIT_WINDOW_MS` | number | `60000` | |
| `RATE_LIMIT_MAX` | number | `300` | global |
| `RATE_LIMIT_WRITE_MAX` | number | `20` | write endpoints |

### 8.3 HTTP API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness |
| POST | `/gps/submit` | wallet sig + write limit | Submit a route for verification |
| GET | `/gps/verify/:id` | none | Poll route status / retrieve the proof |
| GET | `/zones/:hexId` | none | Zone info and mint eligibility |
| POST | `/zones/mint` | wallet sig + write limit | Request a signed zone-mint authorisation |
| POST | `/battles/declare` | wallet sig + write limit | Request a signed challenge declaration |
| GET | `/battles/:hexId` | none | Challenge state for a hex |
| GET | `/users/:address` | none | User stats **(stubbed — see G-04)** |
| — | `/identity/*` | mixed | Identity, session, wallet subsystem (OpenAPI: `backend/openapi/identity-v1.yaml`) |
| POST | `/identity/webhooks/*` | HMAC | Provider webhooks — **503 fail-closed** while no provider is configured |
| GET | `/identity/ready` | none | Readiness; **503** when Postgres is unreachable |

### 8.4 Services

| Service | Responsibility | Status |
|---|---|---|
| `GpsService` | `validateRoute` (speed ≤ 22 m/s ≈ 80 km/h; ≥10 points; ≤30% of points with accuracy >50 m; monotonic timestamps; ≤24 h), `calculateDistance` (Haversine, R = 6 371 000 m), `buildRouteHash` (SHA-256) | `[BUILT]` but see **G-02** |
| `HexService` | `latLngToHex`, `getHexIdsForPoints`, `getNeighbors` (gridDisk radius 1), `hexToLatLng`, `_calculateMintCost` = `500 × ⌊√weeklyMoverCount⌋` | `[PARTIAL]` — `getHexActivity` and `getDefenderScore` are **stubs returning zeros** (G-03) |
| `OracleService` | Signs all five contract payloads; binds `chainId`; refuses invalid defender/score | `[BUILT]`, tested |
| `TokenService` | `calculateEarning`, `getUserStats` | `[PARTIAL]` — `getUserStats` stubbed; halving maths is **wrong** (G-05) |
| `route.service` | Full route lifecycle: PROCESSING → validate → dedup → sign → VERIFIED/REJECTED, dependency-injected so it imports nothing from `@movenrun/shared` | `[BUILT]`, tested |

### 8.5 Workers (BullMQ over Redis)

**`gps.worker.ts`** — queue `"gps-verification"`, concurrency 10. Wires the
real services into `processRouteJob` as adapter closures. On an unexpected
throw it best-effort marks the route `REJECTED` so nothing is stranded in
`PROCESSING`; if persistence itself is down, the route may remain stuck until
the outage clears (documented, accepted).

**`keeper.worker.ts`** — queue `"keeper"`, tasks `weekly` and `check-season`.
Calls `SeasonController.weeklyKeeperRun()`, and `pauseMinting()` / `endSeason()`
based on `seasonEnd`. Uses a minimal inline ABI.

> ⚠ The keeper signs with `ORACLE_PRIVATE_KEY` — the **same key** as the
> oracle. Keeper and oracle duties should use separate keys (see G-08).

### 8.6 Middleware

- **`auth.ts`** — `requireWalletAuth()`: wallet-signature authentication over a
  message binding method, path, an `issuedAt` timestamp (max age
  `AUTH_MAX_AGE_SECONDS`, default 300 s), and a hash of the exact raw body.
  Dedicated tests cover binding ordering for `/battles/declare` and
  `/zones/mint`.
- **`rateLimit.ts`** — global limiter plus a stricter write limiter.
- **`security.ts`** — helmet headers and a fail-closed CORS allowlist.

### 8.7 Database (Drizzle ORM + PostgreSQL)

Migrations: `0000_loose_chat.sql`, `0001_identity_wallet_foundation.sql`,
`0002_provider_events.sql`.

**Gameplay tables (`src/db/schema.ts`)**

| Table | Notes |
|---|---|
| `routes` | id, wallet, status, distance, `route_hash` (**UNIQUE** — DB backstop for dedup), `hex_id`, confidence, `oracle_sig`, times, earned, `rejection_reasons[]`. Indexes on wallet, status, and `(wallet, startTime, endTime)` for the overlap scan. |
| `hex_activities` | Per-hex weekly/monthly mover counts, total distance, top mover. **Nothing populates this yet.** |
| `user_route_hexes` | Join of route → hex → wallet → distance. |
| `zones` | Mirror of on-chain deed state (owner, ownershipStart, dormancy, yield). |
| `battles` | Mirror of challenge state. |

**Identity tables (`src/db/identity.schema.ts`)** — `users`, `auth_identities`,
`wallets`, `auth_sessions`, `wallet_link_challenges`, `email_otp_challenges`,
`security_audit_events`, plus `provider_events` (`provider.schema.ts`).

Notable constraints, all verified against a real PostgreSQL 16 cluster:
- `auth_identities`: active-unique on `(provider, providerSubject)`
- `wallets`: unique verified address; **one active wallet per user**; **one
  embedded wallet per (user, provider)**
- `auth_sessions`: unique refresh-token hash; `familyId` for rotation lineage
- `provider_events`: unique `(provider, providerEventId)` — the DB is the
  authority for webhook idempotency

### 8.8 Identity, session & wallet subsystem

The largest and most rigorously engineered module in the codebase. It is a
**foundation**: explicit invariants, deterministic offline tests, clean provider
boundaries, fail-closed configuration — and **deliberately no production vendor
wired**.

- **Repositories** — interface + in-memory (test/dev) + Drizzle (production).
  The in-memory implementations mirror every DB constraint so tests exercise
  the real backstops offline.
- **Domain services** — identity resolution and linking, sessions
  (issue / verify / rotate / replay-detect / revoke), idempotent wallet
  provisioning, wallet linking with active-switch and revoke, email OTP, and an
  append-only redacting audit service.
- **Provider abstraction** — narrow interfaces, one offline EOA verifier,
  fail-closed adapters, and test-only doubles. A guard test **forbids
  production imports of the doubles**.
- **HTTP surface** — strict validation that rejects secret-shaped input, stable
  public error codes, public response views that never leak secrets, readiness
  separate from liveness.
- **Webhooks** — raw-bytes HMAC verification (timestamped, key-versioned,
  timing-safe) *before* parsing; durable replay-safe `provider_events`;
  idempotent processing with atomic claim/lease; an explicit allowlist that is
  **currently empty**; production route returns a stable **503** while no
  provider/key is configured.
- **Sessions on device** — platform-free core plus an `expo-secure-store`
  keystore adapter, versioned key, fail-closed lifecycle. **No AsyncStorage
  and no persisted-Zustand credentials anywhere.** Sign-out-everywhere calls
  `/session/revoke-all` server-side before clearing locally.

Design decisions are recorded as **ADR-0001 … ADR-0013**, covering canonical
identity, auth/wallet provider abstraction, automatic provisioning,
smart-account-compatible signatures, session/refresh security, wallet linking,
the non-custodial seed-phrase boundary, secure export/recovery, support and
recovery limitations, provider selection (**Blocked**), secure mobile session
storage, and webhook security.

---

## 9. Mobile reference

Expo SDK 51 · React Native 0.74.1 · React 18.2 · Expo Router v3 · Zustand 4.5.

### 9.1 What the app actually is today

The internal docs describe mobile as a "quest shell", but the code has moved
well past that. **The docs are out of date** (see §17). What exists now:

| Capability | Reality |
|---|---|
| Real GPS tracking | `[BUILT]` — `expo-location` **foreground** `watchPositionAsync`. No background tracking, no TaskManager. Points stay on-device. |
| Demo tracker | `[BUILT]` — synthesises a plausible walking loop for dev, web, and the permission-denied fallback. Always labelled as demo; demo sessions are **never saved as progress**. |
| Session flow | `[BUILT]` — `move/index → move/session → move/summary → move/captured` |
| Distance / pace / duration | `[BUILT]` — computed on-device |
| XP, levels, streaks | `[BUILT]` — Zustand + AsyncStorage, once-per-local-day gate |
| Territory board | `[PARTIAL]` — `territoryMap.ts` lays zones on a **pseudo**-hex grid seeded from zone IDs. Uses **no** real coordinates, route paths, or place names. Explicitly "a board, not a map". |
| Zone capture | `[PARTIAL]` — `zones.ts` quantises routes onto a **local ~300 m lattice**, not real H3. Comment states real `h3-js` indexing lands with the live territory map. |
| Locked MOVE | `[PARTIAL]` — display preview only: `floor(totalXP / 12)`. No ledger, nothing stored, nothing earned, always labelled a preview. |
| Contract status screen | `[BUILT]` — read-only display of the Base Sepolia addresses, mirrored as plain strings. **No wallet, no signing, no RPC calls.** |
| Account / wallets / security | `[BUILT]` UI over the identity API; **no provider wired**, so real auth and provisioning stay disabled |
| Clubs, seasons, city wars, rivals, collections | `[PARTIAL]` — screens + pure view-model modules over mock/local data |
| Backend integration | `[PARTIAL]` — only `identityApi.ts` calls the server (`EXPO_PUBLIC_API_URL`); gameplay never does |

### 9.2 Route map (39 route files under `app/`, of which 36 are screens)

```
_layout · opening · welcome · onboarding · +not-found
(tabs)/       index · clubs · profile · _layout
move/         index · session · summary · captured
territory/    map · alerts
zone/         [id]
route/        passport · proof · review-history
network/      status
account/      index · wallets · security
quest/        [id]        questline · active · result
Standalone:   city-districts · city-war · club-territory · collections ·
              crew-missions · deed-showroom · district-mastery · event-zones ·
              rivals · season-objectives · sponsor-zones · weekly-recap
```

### 9.3 Architecture pattern — pure view-models

The app's most valuable engineering pattern: **screens are thin; logic lives in
~50 pure modules under `src/lib/`**, each with its own test. Examples:
`territoryMap.ts`, `deedsView.ts`, `networkView.ts`, `clubsView.ts`,
`profileView.ts`, `recapView.ts`, `objectivesView.ts`, `collectionsView.ts`,
`completionSummary.ts`, `moveReadiness.ts`, `signalQuality.ts`,
`routeProof.ts`, `routeTrust.ts`, `startupDecision.ts`, `authLifecycle.ts`.

This makes the UI testable without a device or a rendering harness, and it is
why the mobile test suite covers 32 files despite there being no React testing
library in the dependency tree.

### 9.4 State

- **`useGameStore`** — XP, level, streak, history, onboarding, zone state.
  Persisted to AsyncStorage. Replaying a completed quest is idempotent
  (0 XP, no streak change) as defence in depth even if the UI is bypassed.
- **`useAuthStore`** — **not** persisted. Credentials live only in the OS
  keystore via `secureSession`. Covered by dedicated tests for login commit,
  bootstrap recovery, session restore, refresh single-flight, and auth
  lifecycle.

### 9.5 Service seam

All quest access goes through `src/services/questService.ts` — screens never
import raw data arrays. This is the single seam where a server-side data source
plugs in later. Rule: do not bypass it; the current implementation is
mock/local and synchronous.

### 9.6 Design system — "Daylight Cartography"

Tokens live in `src/theme.ts` and are mirrored in `website/css/style.css`.
Never hardcode a hex value in a screen.

| Token | Hex | Role |
|---|---|---|
| Morning White | `#F8FAF7` | background |
| Cloud | `#FFFFFF` | cards |
| Mist | `#F1F6F3` | panels |
| Pale Sky | `#EAF6FF` | tint |
| Deep Ink | `#111827` | text |
| Soft Graphite | `#667085` | secondary text |
| **Base Blue** | `#246BFE` | primary |
| **Pulse Green** | `#18C987` | owned zones / success |
| Volt Mint | `#58F2B3` | XP gradient |
| **Heat Coral** | `#FF6B4A` | contested |
| **MOVE Gold** | `#F7B955` | rewards |
| **Deed Violet** | `#7657FF` | deeds |
| Rival Red | `#EF4444` | danger |
| Dust Gray | `#D0D5DD` | unclaimed |

Typography targets Sora (display), Plus Jakarta Sans (body), Space Grotesk
(numeric), currently with platform-sans fallbacks — `expo-font` wiring is a
pending follow-up. Motion uses core `Animated` only.

### 9.7 `mobile/_legacy/`

A **parked** GPS/blockchain scaffold: maps, H3 overlay, `useGPS`, wallet,
token/zone/battle UI. It is the reference implementation for the territory
build. **Do not edit it in place** — lift patterns into new active code.

---

## 10. Shared package & website

### 10.1 `shared/`

Holds the cross-workspace contract of truth:

**`constants/h3.ts`**
```ts
H3_RESOLUTION        = 8      // ~0.74 km² per cell
MIN_ACTIVITY_THRESHOLD = 5    // distinct movers in 90 days before mint eligibility
MIN_ACTIVITY_DAYS    = 90
HEX_AREA_KM2         = 0.74
DORMANCY_DAYS        = 180
RECLAIM_DAYS         = 210
```

**`constants/emission.ts`** — `BASE_RATE` 10e18 · `HALVING_INTERVAL` 2_600_000n
· `DAILY_CAP_INITIAL` 200e18 · `TOTAL_SUPPLY` 1e27 · `ZONE_TAX_BPS` 200n ·
`MIN_BURN_MINT_RATIO` 0.7 · challenge costs (100 / 300 / 500 $MOVE) ·
`CHALLENGE_DURATION_DAYS` 14 · `TIME_EXTENSION_DAYS` 3.

**`constants/contracts.ts`** — the populated Base Sepolia address registry.

**`types/`** — `zone.ts`, `gps.ts`, `token.ts`.

> ⚠ **Structural defect (G-01):** `shared/package.json` declares
> `main: ./dist/index.js` and a `build: tsc` script, but the package has **no
> `src/index.ts` and no `tsconfig.json`**. The bare specifier
> `@movenrun/shared` therefore cannot resolve, and `yarn workspace
> @movenrun/shared build` cannot run. Backend files that import the bare
> specifier are excluded from type-checking for exactly this reason. Modules
> that need shared constants today reach past the entry point with deep paths
> (`@movenrun/shared/src/constants/…`).

### 10.2 `website/`

Static site deployed to Vercel at `movenrun-website.vercel.app`. Vanilla
HTML/CSS/JS — no framework, no build step. `index.html`, `css/style.css` +
`polish.css`, `js/main.js` + `globe.js`, `sitemap.xml`, `robots.txt`,
`vercel.json`.

**`website/docs/`** — a ~24-page documentation site with client-side search
(`assets/search-index.json`, `docs.js`) and 14 hand-authored SVG diagrams:

```
executive-summary · whitepaper · glossary
product/     vision · core-loop · movement · territory · progression ·
             clubs · wellbeing · deed-preview · privacy
technology/  architecture · web3 · token-design · territory-computation ·
             zone-deeds · contracts · backend · mobile · governance · security
status/      roadmap
trust/       faq · risks · disclaimers
```

**Important:** these pages describe the protocol **as designed**, and say so.
They are not a status report. Where they and the code disagree, §17 rules.

---

## 11. Build, CI/CD & release

### 11.1 GitHub Actions (4 workflows, at the **repository root** `.github/workflows/`)

| Workflow | Trigger | Does | Secrets |
|---|---|---|---|
| `contracts-checks.yml` | PR + push to main, on `contracts/**`, `shared/**`, lockfile | Verify Yarn version → `yarn install --immutable` → compile → **run the full `contracts/test/` tree** (no filter, so new suites are picked up automatically) | **none** — deliberately deployment-free: no deployer key, no RPC secret, no Basescan key |
| `backend-checks.yml` | PR + push to main, on `backend/**`, `shared/**`, `contracts/deployments/**` | Verify Yarn → immutable install → `typecheck` → `test` | none |
| `mobile-checks.yml` | **Every** PR + push to main | Verify Yarn → immutable install → `tsc --noEmit` | none |
| `eas-apk-build.yml` | `workflow_dispatch` (manual) | Preflight `EXPO_TOKEN` and the linked EAS `projectId`, then EAS Build (preview profile) → installable Android APK | `EXPO_TOKEN` only |

All non-EAS workflows declare `permissions: contents: read` — least privilege;
they never push, comment, or publish.

> ⚠ **Gap (G-07):** `mobile-checks.yml` runs **only** the type-check. The
> mobile package's 32-file test suite (`yarn workspace @movenrun/mobile test`)
> is **not run in CI**, despite existing and passing locally.

### 11.2 Test inventory

| Suite | Count | In CI |
|---|---|---|
| Contracts — functional (`MoveToken`, `ZoneNFT`, `ZoneChallenge`, `integration`) | 26 | ✅ |
| Contracts — V1 characterization (`v1-characterization/`) | 17 | ✅ |
| Contracts — deployment-command tooling | 6 | ✅ |
| **Contracts total** | **49** | ✅ |
| Backend (blockchain, services, repositories, middleware, identity) | many files | ✅ |
| Mobile (`src/lib/__tests__`, `src/store/__tests__`, `src/services/__tests__`) | 32 files | ❌ |

**Characterization tests are special:** each one *proves a defect exists*,
including unsafe behaviour. Every such test is named with "V1 characterization"
or "known discrepancy" so a passing test is never mistaken for an approved
invariant.

### 11.3 Release process

- **Android APK:** manual `workflow_dispatch` on `eas-apk-build.yml`, EAS
  preview profile. Package `io.movenrun.app`.
- **iOS:** not built. The codebase is cross-platform; Android is first.
- **Website:** Vercel, from `movenrun/website/`.
- **Backend:** no deployment pipeline exists yet. Runs locally via
  `yarn workspace @movenrun/backend dev` plus `worker:gps` / `worker:keeper`.
- **Contracts:** `deploy:sepolia` only. Mainnet deployment is intentionally
  unsupported.

### 11.4 Local development

```bash
cd movenrun
corepack enable                       # provisions Yarn 4.9.1
yarn install --immutable

yarn workspace @movenrun/contracts compile
yarn workspace @movenrun/contracts test          # 49 tests
yarn workspace @movenrun/backend  typecheck
yarn workspace @movenrun/backend  test
yarn workspace @movenrun/mobile   lint           # tsc --noEmit
yarn workspace @movenrun/mobile   test           # 32 files, not in CI

yarn workspace @movenrun/backend dev             # API
yarn workspace @movenrun/backend worker:gps      # needs Redis + Postgres
yarn workspace @movenrun/mobile  start           # Expo (SDK 51 Go + tunnel)
```

Backend requires PostgreSQL and Redis. Migrations: `yarn workspace
@movenrun/backend db:migrate`.

---

## 12. Security posture

### 12.1 On-chain controls

- **Role-scoped permissions.** No single omnipotent key. `MINTER_ROLE`,
  `ORACLE_ROLE`, `GOVERNOR_ROLE`, `SEASON_ROLE`, `KEEPER_ROLE`,
  `ZONE_ADMIN_ROLE`, `GEAR_ADMIN_ROLE`, `VAULT_ADMIN_ROLE`, `DAO_ROLE`.
- **`chainId` bound into every signed payload** (FIX-001) — no cross-chain replay.
- **Replay guards** — `usedRoutes`, `usedMintSigs`, `usedScoreSigs`.
- **`nonReentrant`** on `resolveChallenge`, vault stake/unstake/claim, DAO execute.
- **Zero-address constructor checks** (FIX-003) on every contract.
- **Emission floor** `MIN_BASE_RATE` (FIX-007) — the auto-valve cannot drive the rate to zero.
- **Distance ceiling** `MAX_DISTANCE_METERS` = 100 km per route (FIX-012).
- **Pull-payment zone tax** (FIX-004) — avoids per-mint transfers to thousands of owners.
- **Batch resilience** (FIX-005) — a failing zone in `greatBurn` is skipped, not reverted.
- **Score-submission cutoff** (FIX-011) — 1 hour before the challenge end.

> These mitigations are real, but they do **not** cover the 15 catalogued
> logic defects in §15. The deployed V1 must be treated as a **testnet
> reference implementation**, not a production-ready protocol.

### 12.2 Off-chain controls

- **Fail-closed configuration everywhere.** Invalid env exits at startup;
  missing CORS origins in production is an error, not a wildcard; webhooks and
  provider-dependent flows return a stable **503** while unconfigured;
  readiness returns 503 when Postgres is unreachable.
- **Wallet-signature request auth** binding method, path, `issuedAt`, and a
  hash of the exact raw body, with a 300 s max age.
- **Rate limiting** globally and, more strictly, on writes.
- **HMAC webhooks over raw bytes before parsing**, timestamped, key-versioned,
  timing-safe, with a bounded previous-key rotation overlap.
- **DB-authoritative idempotency and replay defence** — no process-local state.
- **Append-only redacting audit trail.**
- **No secrets in logs**; error messages name fields, never values.

### 12.3 The seed-phrase boundary (ADR-0008)

MovenRun **never** accepts, generates, stores, or transmits a seed phrase or
private key for a user. There is no database column for one, the HTTP schemas
actively reject secret-shaped input (`assertNoSecretShapedInput`), and the
mobile client performs no local key generation. Wallet export is
provider-isolated and step-up-gated; MovenRun never sees the secret.

### 12.4 Threat model (14+ modelled threats, `docs/THREAT_MODEL.md`)

Each threat is documented as *asset · actor · entry point · trust boundary ·
mitigation · detection · recovery · residual risk · evidence*. Covered:
OTP brute force · email enumeration · OAuth callback replay · malicious deep
links · redirect-URI manipulation · account-link hijacking · cross-provider
email collision · session theft · refresh-token replay · lost device ·
compromised email account · compromised Google account · Base Account
signature replay · ERC-1271/6492 verification failure.

`docs/SECURITY_CHECKLIST.md` maps **52 requirements** to implementation, test
evidence, remaining risk, and provider dependency.

### 12.5 Wallet provider selection — status **Blocked** (ADR-0011)

Six candidates were evaluated against 12 hard gates: **Privy, Dynamic,
Web3Auth, Turnkey, Coinbase CDP, Magic**.

- **No candidate has all 12 gates verified**, so selection is blocked.
- The blocking cause is **evidence**, not engineering: the evaluation
  environment's egress policy denied access to official documentation, and the
  team refused to infer unverified facts (custody model, export, webhooks,
  Base compatibility, pricing are Unverified for every candidate).
- **Turnkey** carries a verified **FAIL** on gate 1: its peer range requires
  `react-native ^0.76.5`, incompatible with the app's 0.74.1.
- **Coinbase CDP** could not be shown to have an embedded-wallet React Native
  SDK at all.
- On the one dimension with sufficient evidence (Mobile/Expo capability),
  **Privy** and **Dynamic** score 4/5, Magic 3, Web3Auth 3, CDP 1, Turnkey 0.
- Deliberately, **no composite ranking was produced** — the team's stated
  reasoning is that scoring with 5 of 8 dimensions unverified would let SDK
  freshness masquerade as a security judgment.

**Consequence:** real authentication and real wallet provisioning remain
**disabled**. Only provider-neutral infrastructure ships. This is the single
largest blocker between the current app and a usable product.

### 12.6 Key rotation

`docs/KEY_ROTATION.md` covers rotation, incident response, rollback, and
outage behaviour. Config enforces a **bounded** current/previous key overlap
(a previous key must carry an expiry). `MoveToken`'s oracle is rotatable via
`GPSOracle.updateOperator` (admin-gated).

---

## 13. Tokenomics — designed vs coded

### 13.1 Headline parameters (agree across docs and code)

| Parameter | Value |
|---|---|
| Token | MoveToken, `$MOVE`, ERC-20, 18 decimals |
| Chain | Base |
| Max supply | 1,000,000,000 — hard cap enforced in `mintMOVE` |
| Minting | Oracle-gated; only against a signed, verified route |
| Initial rate | 10 $MOVE per km |
| Halving interval | 2,600,000 blocks (~6 months on Base) |
| Initial daily cap | 200 $MOVE per address, halving per epoch |
| Zone tax | 2% of everything minted in a hex, to that zone's deed holder |
| Gear multiplier | 4 slots, combined ceiling **3×**, enforced in `setGearMultiplier` |

### 13.2 Emission schedule

| Epoch | Approx. period | Rate | Daily cap |
|---|---|---|---|
| 0 | Months 1–6 | 10 $MOVE/km | 200 |
| 1 | Months 7–12 | 5 | 100 |
| 2 | Months 13–18 | 2.5 | 50 |
| 3 | Months 19–24 | 1.25 | 25 |

The halving schedule is a **ceiling**; the weekly auto-valve may push the
effective rate lower.

**Auto-valve:** weekly, if `weeklyBurn / weeklyMint < 0.70`, reduce `baseRate`
by 10%, floored at `MIN_BASE_RATE` (0.01 $MOVE). The valve only reduces;
raising requires a `GOVERNOR_ROLE` vote.

> ⚠ **Contradiction:** `shared/src/constants/emission.ts` carries a comment
> claiming the schedule is `BASE_RATE × 0.7^epoch` (10 → 7 → 4.9 → 3.43).
> The **deployed contract halves** (`rate / 2`). `docs/TOKENOMICS.md` reconciles
> this by calling 7/4.9/3.43 "effective rates after the auto-valve", but that
> is not how the code works — the valve is a separate, burn-ratio-driven
> reduction, not a 0.7 exponent. **The comment is wrong; the contract is
> right.** See G-12.

### 13.3 Sinks

| Action | Amount | Real burn? |
|---|---|---|
| Zone Deed mint | `500 × ⌊√weeklyMoverCount⌋` $MOVE, computed **off-chain** and authorised by oracle signature | ✅ `burnFrom` |
| Challenge declaration | 100 $MOVE | ✅ |
| Stronghold boost | 300 $MOVE × up to 3 | ✅ |
| Time extension | 500 $MOVE | ✅ |
| Gear mint | per gear type | ✅ |
| **Great Burn (season end)** | 10% of top-100 accumulated yield | ❌ **transfer to treasury, supply unchanged** |

### 13.4 Loyalty multiplier — docs vs code

| Ownership age | `docs/TOKENOMICS.md` says | `ZoneNFT` code does |
|---|---|---|
| 0–30 days | 1.00× | 1.00× |
| 30–90 days | **1.25×** | **1.00×** |
| 90–180 days | 1.50× | **1.25×** |
| 180–365 days | 1.75× | **1.50×** |
| 365+ days | — | **1.75×** |

Additionally, the docs say the multiplier applies to **yield accumulation**.
In code it does **not** — `creditZoneYield` adds the raw amount. The multiplier
is read **only** by `ZoneChallenge.resolveChallenge` to boost the defender's
score. `LOYALTY_TIER1` (30 days) is declared and never used. See G-06.

### 13.5 Intended supply distribution `[DESIGNED]`

| Bucket | % | Vesting |
|---|---|---|
| Play-to-earn emissions | 60% | Released via verified-movement minting over years |
| Team & advisors | 15% | 12-month cliff, 36-month linear |
| Ecosystem / grants | 12% | DAO-controlled |
| Protocol-owned liquidity | 8% | Locked in MoveVault |
| Public sale | 5% | No lock |

**None of this has been executed.** There is no allocation, no vesting
contract, no sale, and no liquidity. The `$ZONE` governance token described in
`docs/TOKENOMICS.md` (10 M fixed supply, soulbound 12 months, earned by
staking) is **not implemented at all**.

### 13.6 Revenue model `[DESIGNED]`

| Line | Phase | Note |
|---|---|---|
| Sponsored zones | 3 | Clearest and most defensible early line |
| Deed marketplace fees | 3 | |
| Premium tools for deed holders | 3 | |
| Events & partnerships | 4 | |

Every line is paid by a business or a committed player; none depends on
ordinary users spending money. The free experience stays free — that is what
protects the growth engine.

---

## 14. Data model & privacy

### 14.1 Privacy design principle

Turn movement into **proofs**, not permanent trails. What the network needs is
confidence that someone really moved — not a searchable history of everywhere
they have been.

### 14.2 Where location data actually goes

| Stage | What exists | Where |
|---|---|---|
| During a session | Raw GPS points | **On-device only.** `moveSession.ts` holds the finished session **in memory**, explicitly not persisted. |
| After a session | Derived stats (distance, duration → XP) | On-device store |
| On submission `[PARTIAL]` | Raw points sent to `/gps/submit` | Backend job payload |
| After verification | `route_hash`, `distance`, primary `hex_id`, `confidence`, `oracle_sig` | `routes` table. **The raw point array is not a column.** |
| On-chain | `routeHash` (32 bytes), distance, hexId | Base — no coordinates ever |

The mobile territory board goes further: it uses **no** raw GPS, coordinates,
route paths, polylines, or place names, and discloses no real geography.

### 14.3 Stated commitments

- Not a data broker; movement is never sold as a product about the user.
- No third-party ad tracking; no selling of location profiles.
- No inference or exposure of another person's precise location.
- Deeds and balances are ownership records under the user's keys, not a
  movement profile.
- Data-retention and deletion controls are **design commitments**, not yet
  implemented features.

### 14.4 Privacy gaps to be honest about

- `/gps/submit` receives the **full raw point array**. Retention and deletion
  policy for that payload is not implemented (see G-13).
- `user_route_hexes` records `(wallet, hexId, distance, timestamp)` per route.
  At scale this is a re-identifiable movement history — pseudonymous, but a
  history nonetheless. Minimisation policy is undefined.
- The mobile app collects a **coarse, sanitised, display-only** device label
  (`Platform.OS` only) — deliberately not evidence, never audited.

---

## 15. Known defect register — deployed V1 contracts

Source: `docs/CONTRACT_V1_DISCREPANCIES.md`. Every entry is **proven by a
passing characterization test** in `contracts/test/v1-characterization/`.

> **Because the deployed contracts are immutable, every logic-level fix below
> requires new V2 contracts + redeployment + a state/ownership migration.**
> It cannot be patched in place.

### 15.1 Severity summary

| # | Defect | Severity | V1 affected | Needs redeploy |
|---|---|---|---|---|
| 1 | Active challenge can be overwritten | **CRITICAL** | Yes | Yes |
| 3 | Settlement depends on the losing defender's approval | **CRITICAL** | Yes | Yes |
| 16 | `deploy:mainnet` ran the Sepolia script | **CRITICAL** | No (tooling) | ✅ **FIXED** |
| 2 | No new challenge after a resolved one | High | Yes | Yes |
| 4 | Deed transferable during an active challenge | High | Yes | Yes |
| 5 | Declaration-signature replay surface | High | Yes | Yes |
| 6 | Score-signature lifecycle collision | High | Yes | Yes |
| 7 | Season mint pause is not enforced | High | Yes | Yes |
| 8 | Great Burn is a treasury transfer, not a burn | High | Yes | Yes |
| 9 | Great Burn signed payload is replayable | High | Yes | Yes |
| 10 | Dormant reclaim leaks yield/activity state | Medium | Yes | Yes |
| 11 | Gear multiplier survives transferring the gear away | Medium | Yes | Yes |
| 12 | Vault reward is all-or-nothing (treasury starvation) | Medium | Yes | Yes |
| 13 | Reward-rate changes apply retroactively | Medium | Yes | Yes |
| 14 | DAO votes on live transferable balances (no snapshot) | Medium | Yes | Yes |
| 15 | `MovenDAO` lacks `DAO_ROLE` on `MoveVault` | Medium | Yes | **No** — role grant |

### 15.2 The critical three, in detail

**#1 — Active challenge overwrite (CRITICAL).** `declareChallenge` gates with
`require(!resolved || challenger == address(0))`. For an *active* challenge
`!resolved` is `true`, so a second declaration passes and **clobbers the live
challenge** — new challenger, reset timers. The first challenger's burned 100
$MOVE is lost. Any challenge can be griefed or hijacked.
*Required V2 invariant:* `state == None || state == Resolved`.

**#2 — Permanent lock after resolution (High).** The same inverted guard means
that once `resolved == true`, a later declaration always reverts. **A zone can
be challenged exactly once, ever.** The cooldown-gated re-challenge economy
does not function at all.

**#3 — Settlement depends on the loser's approval (CRITICAL).**
`resolveChallenge` settles a challenger win via
`zoneNFT.safeTransferFrom(defender, challenger, hexId)`, called by the
`ZoneChallenge` contract — which only succeeds if the **defender** previously
called `setApprovalForAll(zoneChallenge, true)`. **A defender can guarantee
they never lose by simply never approving.** The existing green functional
tests only pass because they include that approval explicitly.
*Required V2 invariant:* settlement must not require the loser's cooperation —
deed escrow at declaration, or a contract-held custody model.

Taken together with **#4** (a defender can transfer the deed away mid-challenge
to strand the challenge) and **#5** (the declaration signature binds neither
challenger, instance, nonce, deadline, nor verifying contract, and has no
used-signature mapping), **the entire Defend → Own half of the core loop is
unsound in deployed V1.**

### 15.3 Economic defects

**#7 — The mint pause does nothing.** `pauseMinting()` sets a flag and
`isMintingAllowed()` reports it, but **no minting path consults it**. After a
pause, both route-reward minting and Zone Deed minting still succeed. The
end-of-season emission control is purely advisory.

**#8 — The Great Burn is not a burn.** `greatBurn` executes
`transferFrom(owner, daoTreasury, amount)`. **Total supply is unchanged**; no
ERC-20 burn happens, and `weeklyBurn` is not incremented — which also means the
auto-valve's burn/mint ratio never sees it. The advertised deflationary sink
redirects value to the treasury instead of destroying it. Either V2 makes it a
real burn, or the tokenomics documentation must be corrected.

**#9 — Great Burn replay.** No `usedGreatBurnSigs` mapping and no per-season
finalised flag, so the same signed payload can be executed repeatedly within a
season, moving another 10% each time. Mitigated operationally only by
`KEEPER_ROLE` gating.

**#10 — Reclaim leaks value.** `reclaimDormant` deletes only `ownershipStart`
and `isDormant`. `lastActivity` and **`accumulatedYield` survive the burn**,
and `mintZone` never resets them — so the next minter of that hex inherits and
can withdraw the previous owner's accrued yield.

**#11 — Rentable gear multipliers.** `getUserMultiplier` reads only
`equippedGear`, never re-checking `balanceOf`. Equip gear, transfer away every
copy, keep the full multiplier — so one item can boost many wallets.

**#12 / #13 — Vault.** Rewards are all-or-nothing: if pending exceeds the
treasury, nothing is paid, the claim timestamp does not advance, and the debt
compounds forever. And `setRewardRate` has no checkpoint, so a rate change
**re-prices the entire interval since the last claim** for every staker.

**#14 — Governance is trivially double-votable.** `_votingWeight` reads live
`balanceOf` + live stake at vote time, with **no snapshot**. Vote from wallet
A, transfer the tokens to B, vote again. Quorum reads
`moveVault.totalStaked()` live at execution time — and with `totalStaked == 0`
the quorum is **zero**, so a double-counted proposal executes and can actually
change `baseRate`.

### 15.4 Recommended next contract PR

`fix(contracts): add isolated v2 territory economy contracts` — a **new,
isolated** V2 set that encodes the required invariants, leaving deployed V1
source and `deployments/baseSepolia.json` untouched, with a migration plan for
V1 state and deed ownership.

---

## 16. Additional gaps found in this review

These are **outside** the contract register above and were identified by direct
inspection of the current tree. IDs are used as cross-references throughout
this document.

| ID | Area | Severity | Issue |
|---|---|---|---|
| **G-01** | `shared/` | **P0** | Package is unresolvable |
| **G-02** | backend | **P0** | `buildRouteHash` throws at runtime |
| **G-03** | backend | **P1** | Hex activity and defender score are stubs |
| **G-04** | backend | P2 | `getUserStats` is a stub |
| **G-05** | backend | **P1** | Halving maths uses the wrong block base |
| **G-06** | contracts/docs | P2 | Loyalty tiers and dead constants |
| **G-07** | CI | **P1** | Mobile tests are not run in CI |
| **G-08** | ops | **P1** | Keeper and oracle share one private key |
| **G-09** | backend | P3 | Anthropic SDK and API key leftover |
| **G-10** | contracts | P3 | Gear metadata URI points at a dead domain |
| **G-11** | repo | P2 | Root README describes a different project |
| **G-12** | shared/docs | P2 | Emission comment contradicts the contract |
| **G-13** | backend/privacy | **P1** | No retention policy for raw GPS payloads |
| **G-14** | mobile | P2 | H3 resolution referenced inconsistently |
| **G-15** | docs | P2 | Internal docs understate what mobile does |

### G-01 — `@movenrun/shared` cannot resolve `[P0]`

`shared/package.json` declares `main: ./dist/index.js`, `types:
./dist/index.d.ts`, and a `build: tsc` script. The package has **no
`src/index.ts`** and **no `tsconfig.json`**. Consequences:

- `yarn workspace @movenrun/shared build` cannot run (no tsconfig).
- Any bare `import … from "@movenrun/shared"` is unresolvable at runtime.
- `backend/tsconfig.json` explicitly excludes `routes/` and `services/` from
  type-checking *because of this*, so a large part of the backend is
  **not type-checked at all**.
- Modules that need shared values work around it with deep paths
  (`@movenrun/shared/src/constants/h3.js`).

Several backend files import the bare specifier: `gps.service.ts`,
`hex.service.ts`, and `gps.worker.ts` among them. **The GPS worker cannot start
as written.**

*Fix:* add `shared/src/index.ts` re-exporting the constants and types, add
`shared/tsconfig.json`, build the package (or point `main`/`exports` at the TS
source for a source-only workspace), then widen `backend/tsconfig.json`'s
`include` to the whole of `src/` and fix whatever that surfaces.

### G-02 — `buildRouteHash` throws at runtime `[P0]`

```ts
// backend/src/services/gps.service.ts
buildRouteHash(route: GPSRoute): string {
  const { createHash } = require("crypto");   // ← ReferenceError in ESM
  …
}
```

`backend/package.json` sets `"type": "module"`, and the worker runs under
`tsx`. **Verified by direct reproduction:** this throws
`ReferenceError: require is not defined in ES module scope`.

`buildRouteHash` is called on **every** route in `gps.worker.ts`, so no route
can ever reach `VERIFIED` — the entire verification pipeline is dead in
production. It survives because `gps.service.ts` has **no test file**, and
`route.service.test.ts` injects a fake `buildRouteHash`.

*Fix:* `import { createHash } from "node:crypto"` at module scope, and add a
`gps.service.test.ts` that exercises `validateRoute`, `calculateDistance`, and
`buildRouteHash` for real.

### G-03 — Hex activity and defender score are stubs `[P1]`

```ts
async getHexActivity(hexId)  { /* TODO: query from DB */ return { …all zeros… }; }
async getDefenderScore(hexId){ /* TODO */ return 0n; }
```

Downstream effects: `getMintEligibility` **always** returns
`isEligible: false` (since `0 < MIN_ACTIVITY_THRESHOLD`), and `mintCost`
always collapses to `500 × √1 = 500 $MOVE` regardless of demand. A zero
defender score is refused by `OracleService.signChallengeDeclaration`, so
`/battles/declare` cannot produce a usable signature.

The `hex_activities` table exists and **nothing populates it**. This is the
missing link between "we recorded routes" and "the territory economy works".

### G-04 — `getUserStats` is a stub `[P2]`

`TokenService.getUserStats` returns hardcoded zeros for total distance, total
earned, and owned zones, with a `TODO: query from DB + contract`. `GET
/users/:address` therefore reports nothing real. Low severity only because no
client consumes it yet — but it is the first endpoint any profile screen will
need.

### G-05 — Halving maths uses the wrong block base `[P1]`

```ts
// backend/src/services/token.service.ts
private _rateAtBlock(block: number) {
  const halvings = BigInt(block) / HALVING_INTERVAL;   // absolute block number
  …
}
```

The contract computes `(block.number − deployBlock) / HALVING_INTERVAL`. The
backend divides the **absolute** block height, so on any real chain it reports
a rate many halvings too low — Base Sepolia is already far past
2.6 M blocks, so the backend would show a near-zero rate while the contract
still pays 10 $MOVE/km. Any UI showing "current rate" would be badly wrong.

*Fix:* read `deployBlock` from the contract (or the deployment record) and
subtract it — or better, call `MoveToken.currentRate()` / `currentDailyCap()`,
which already exist as view functions.

### G-06 — Loyalty tiers and dead constants `[P2]`

`ZoneNFT.LOYALTY_TIER1` (30 days) and `ZoneNFT.BASE_MINT_COST` (500 ether) are
declared and **never read**. The tier boundaries in code (90/180/365 days) do
not match `docs/TOKENOMICS.md` (30/90/180). And the docs claim the multiplier
applies to yield accumulation, whereas in code it only boosts the defender's
score at challenge resolution. Three separate inconsistencies in one small
area. *Fix:* correct the documentation now; align the code in V2.

### G-07 — Mobile tests are not in CI `[P1]`

`mobile-checks.yml` runs `tsc --noEmit` only. The mobile package's `test`
script covers **32 files** — secure-session lifecycle, auth lifecycle,
bootstrap recovery, login commit, refresh single-flight, session management,
and every view-model — and none of it gates a PR. Given that the identity and
session logic is the most security-sensitive code in the app, this is the
cheapest high-value fix in the repository: add one step to the workflow.

### G-08 — Keeper and oracle share one key `[P1]`

`keeper.worker.ts` constructs its signer from `ORACLE_PRIVATE_KEY`. The oracle
key authorises **every** signed payload in the protocol — routes, deed mints,
challenge declarations, scores, the Great Burn. The keeper only needs
`KEEPER_ROLE` to call `weeklyKeeperRun`, `pauseMinting`, and `endSeason`.
Sharing the key means a compromised keeper host is a compromised oracle.
*Fix:* add `KEEPER_PRIVATE_KEY` to the config schema and use it in the keeper.

### G-09 — Anthropic leftover `[P3]`

`@anthropic-ai/sdk` is a **runtime dependency** of the backend and
`ANTHROPIC_API_KEY` is in the config schema, but **no source file imports or
uses either** (verified by grep). This directly contradicts the project's own
rule against AI provider keys. *Fix:* remove both.

### G-10 — Gear metadata URI `[P3]`

`GearNFT`'s base URI is `https://api.movenrun.io/gear/{id}.json`. That domain
does not serve metadata, and the public site is on `movenrun-website.vercel.app`.
Any marketplace rendering gear would show nothing. Immutable in V1; fix in V2.

### G-11 — Root README describes a different project `[P2]`

`arena/README.md` describes **MemeArena**, a Starknet meme-battle platform. A
visitor to the repository — including an accelerator reviewer following a link
— sees the wrong product first. *Fix:* make the root README describe MovenRun
and point at `movenrun/`, or move the MemeArena artefacts into their own
subdirectory.

### G-12 — Emission comment contradicts the contract `[P2]`

`shared/src/constants/emission.ts` documents `BASE_RATE × 0.7^epoch`
(10 → 7 → 4.9 → 3.43). The deployed contract **halves**. The comment is wrong.
*Fix:* correct the comment to describe halving.

### G-13 — No retention policy for raw GPS payloads `[P1]`

`/gps/submit` accepts the full raw point array (up to a 2 MB body). Points are
not a column on `routes`, but they do pass through the BullMQ job payload in
Redis, and no documented TTL, redaction, or deletion policy covers them. For a
product whose privacy promise is "proofs, not trails", this needs an explicit,
implemented policy before any real user data arrives.

### G-14 — H3 resolution referenced inconsistently `[P2]`

`shared/src/constants/h3.ts` and `ARCHITECTURE.md` fix resolution **8**
(~0.74 km²). `mobile/src/lib/zones.ts` says the real indexing will be
"res 9, matching `shared/`" — which `shared/` does not say — and meanwhile
uses a ~300 m lattice, closer to res 9 than res 8. Resolution 8 (~461 m edge)
vs 9 (~174 m edge) is a **7× area difference** and a major game-balance
decision. *Fix:* decide deliberately, document it once, and make every
reference agree.

### G-15 — Internal docs understate the mobile app `[P2]`

`ROADMAP.md` §A and `MOBILE_TO_TERRITORY_PLAN.md` describe mobile as a "quest
shell" with "local mock quests" whose Steps 1–4 (GPS session, route summary,
H3 simulation, capture/defend UI) are *future work*. In reality the app has
real `expo-location` GPS tracking, a full move session → summary → captured
flow, a territory board, zone capture simulation, clubs, seasons, and a
complete account/security surface. **Steps 1, 2, and 4 are substantially
done**; only Step 3 (real H3) and Step 5 (backend/chain) remain. This matters:
the canonical scope document under-reports the team's own progress, which is
exactly the wrong error to make in an accelerator application.

---

## 17. Documentation drift — where docs and code disagree

Use this table whenever a question turns on "does it work like the docs say?"

| Topic | Public docs / internal docs say | Code actually does | Ref |
|---|---|---|---|
| Territory capture in-app | Real H3 capture | ~300 m local lattice simulation | §9.1 |
| Territory map | A map | A pseudo-hex **board** with no geography | §9.1 |
| Wallets | Embedded, created automatically | Infrastructure built, **no provider wired**, fails closed | §12.5 |
| Gas | Sponsored via account abstraction | **Not implemented** — no paymaster, no AA integration anywhere | — |
| "Fully onchain" | Ownership lives on-chain | True on testnet contracts; the **app never touches the chain** | §9.1 |
| Great Burn | Deflationary burn | `transferFrom` to treasury; supply unchanged | §15.3 |
| Season mint pause | Emission control | Advisory flag; nothing checks it | §15.3 |
| Loyalty multiplier | 30/90/180 tiers, applies to yield | 90/180/365 tiers, applies only to challenge defence | §13.4 |
| Emission curve | `0.7^epoch` (in a shared constant comment) | Halving (`/2`) | §13.2 |
| Zone mint cost | `500 × √weeklyMoverCount` | Correct formula, but computed **off-chain**; the on-chain constant is inert, and the input is always 0 today | G-03 |
| Mobile app | "Quest shell", GPS is future work | Real GPS tracking and a full session flow already ship | G-15 |
| DAO tiers | 3 tiers, zone owners get 3× | 2 tiers only; the zone-owner tier is unimplemented | §6.8 |
| `$ZONE` token | Described in TOKENOMICS.md | Does not exist in any form | §13.5 |

**Rule of thumb for answering:** the public site is honest that it describes
the protocol *as designed* and carries the disclaimer. The internal docs are
mostly accurate but **understate** mobile progress and **overstate** the
tokenomics. The code is the truth.

---

## 18. Prioritised fix plan

### P0 — Blocking. Nothing works end to end until these are done.

| ID | Fix | Effort |
|---|---|---|
| G-02 | Replace `require("crypto")` with a top-level `import` in `gps.service.ts`; add `gps.service.test.ts` | ~1 hour |
| G-01 | Add `shared/src/index.ts` + `shared/tsconfig.json`; build or expose source; widen `backend/tsconfig.json` to all of `src/` | ~half a day, plus fixing whatever type errors surface |

Together these two make the backend actually runnable and actually
type-checked. They are the highest-leverage work in the repository.

### P1 — Required before Phase 1 can complete.

| ID | Fix | Effort |
|---|---|---|
| G-03 | Implement `getHexActivity` / `getDefenderScore` against `hex_activities` + `user_route_hexes`; add a job that populates `hex_activities` from verified routes | ~2–3 days |
| G-05 | Use `MoveToken.currentRate()` / `currentDailyCap()` instead of re-deriving halvings off-chain | ~1 hour |
| G-07 | Add `yarn workspace @movenrun/mobile test` to `mobile-checks.yml` | ~15 minutes |
| G-08 | Split `KEEPER_PRIVATE_KEY` from `ORACLE_PRIVATE_KEY` | ~1 hour |
| G-13 | Define and implement a retention/deletion policy for raw GPS payloads (job TTL, redaction, documented window) | ~1 day + a policy decision |
| — | Connect the mobile session to `/gps/submit` and real H3 (Step 3/5 of the mobile plan) | the main Phase 1 milestone |

### P2 — Correctness and credibility.

| ID | Fix |
|---|---|
| G-06, G-12 | Correct `TOKENOMICS.md` loyalty tiers and the emission comment to match the code |
| G-14 | Decide H3 resolution 8 vs 9, document once, align every reference |
| G-15 | Update `ROADMAP.md` §A and `MOBILE_TO_TERRITORY_PLAN.md` to reflect what mobile actually does |
| G-11 | Fix the root `README.md` |
| G-04 | Implement `getUserStats` |
| §15 #15 | Decide the DAO↔Vault wiring and, if intended, grant `MoveVault.DAO_ROLE` to `MovenDAO` (no redeploy needed) |

### P3 — Hygiene.

| ID | Fix |
|---|---|
| G-09 | Remove `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY` |
| G-10 | Plan a real metadata endpoint for V2 gear |
| — | Wire `expo-font` for Sora / Plus Jakarta Sans / Space Grotesk |

### Contracts V2 — a separate, isolated workstream

The 15 logic defects in §15 cannot be patched. The plan of record is a **new,
isolated V2 contract set** that encodes the required invariants, leaving V1
source and the deployment record untouched, plus a migration plan for state and
deed ownership. **This work is a hard prerequisite for mainnet**, alongside an
external audit.

### Suggested sequencing

```
Week 1     G-02 → G-01 → G-07              (make it run, make it checked)
Weeks 2–3  G-03 + hex_activities job       (make the territory economy computable)
Weeks 2–3  Mobile Step 3: real H3 capture  (make the map real)
Week 4     G-05, G-08, G-13                (correctness, security, privacy)
Week 4     P2 documentation batch          (make claims match reality)
Parallel   Unblock the wallet provider decision (ADR-0011) — the single
           largest product blocker
Later      V2 contracts + external audit → only then Phase 3 / mainnet
```

---

## 19. Strengths & potential

### 19.1 Genuine engineering strengths

1. **The hard part was built first.** Most teams build the app and bolt the
   chain on later. Here the contract suite, the oracle, and the verification
   pipeline were written, tested, and deployed to a public testnet before
   anyone was asked for money. The economic design has been pressure-tested
   against real code rather than a spreadsheet.
2. **Exceptional defect honesty.** A team that writes 17 characterization tests
   *to prove its own deployed contracts are broken*, then publishes a severity
   register naming two of its own defects CRITICAL, is doing something rare.
   This is the strongest signal of engineering maturity in the repository.
3. **Security engineering well above stage.** Fail-closed configuration
   everywhere, raw-byte HMAC before parsing, DB-authoritative replay defence,
   refresh rotation with family revocation, an explicit seed-phrase boundary,
   a 14-threat model, a 52-row control matrix, 13 ADRs, and a key-rotation
   runbook — at a stage where most projects have none of it.
4. **Disciplined refusal to guess.** The wallet-provider decision is marked
   **Blocked** rather than being decided on vibes, with an explicit statement
   that scoring on partial evidence would let SDK freshness masquerade as a
   security judgment. That instinct is what the previous move-to-earn
   generation lacked.
5. **Testable architecture in mobile.** Pushing logic into ~50 pure view-model
   modules gives real test coverage without a rendering harness, and keeps
   screens swappable.
6. **Deployment safety reflexes.** Finding and removing an unsafe
   `deploy:mainnet` command, then adding six static tests so it cannot come
   back, is exactly the behaviour that prevents a catastrophic mislabelled
   mainnet deploy.
7. **Deterministic, least-privilege CI.** Committed lockfile, immutable
   installs, a package-manager version guard, `contents: read` everywhere, and
   contract CI that is deliberately deployment-free with no keys.

### 19.2 Product potential

- **A real wedge into a mainstream audience.** If invisible onboarding works as
  designed, MovenRun can reach people no crypto product currently reaches —
  which is precisely what Base's ecosystem is trying to fund.
- **Geographic virality.** A territory game is better when neighbours play, so
  growth compounds locally rather than diffusing. City-by-city density is a
  repeatable playbook, and each won city is a case study for the next.
- **Clubs are pre-formed distribution.** Running clubs, walking groups, and
  gyms already exist, already meet on a schedule, and are already competitive.
  One captain converts thirty players in one conversation — and thirty players
  in one neighbourhood is instant density.
- **Sponsored zones are revenue *and* growth.** A café sponsoring its own hex
  promotes to its own customers, and gives the product a reason to be welcomed
  into a city rather than merely present in it.
- **Territory is a far better social object than a distance number.** A map of
  your neighbourhood in your colour provokes exactly the right reaction:
  *"that's my street — why is it yours?"*
- **Health-first is a bigger market.** Treating a 20-minute walk as a
  first-class move costs the hardcore-athlete audience and buys everyone else —
  a larger and more retentive market.
- **A defensible verification moat.** Reliable movement proof is genuinely
  hard. A team that solves it well owns something competitors cannot copy from
  a screenshot.

---

## 20. Weaknesses & risks

### 20.1 Engineering weaknesses

| Weakness | Why it matters |
|---|---|
| **The three layers are not connected.** | Mobile talks to the backend only for identity; gameplay is entirely local; the backend has never driven a real on-chain mint. The architecture is proven in pieces, never end to end. |
| **The backend cannot currently run its own pipeline** (G-01, G-02). | Two small defects make the flagship verification path non-functional. |
| **Large parts of the backend are not type-checked** (G-01). | `routes/` and `services/` are excluded from `tsconfig.json`, so exactly the code with the stubs and the ESM bug has no compiler safety net. |
| **The territory economy has no data source** (G-03). | `hex_activities` is never populated, so mint eligibility, mint cost, and defender scores are all structurally zero. |
| **Deployed V1 contracts are unsound for production.** | 15 logic defects including two CRITICAL. The Defend → Own half of the loop does not work. Requires a full V2 + migration. |
| **No wallet provider** (§12.5). | The single largest product blocker. Without it, "invisible onboarding" — the entire strategic bet — cannot be demonstrated to anyone. |
| **No account abstraction / gas sponsorship at all.** | Widely claimed in public material; nothing exists in code. |
| **Mobile tests do not gate PRs** (G-07). | The most security-sensitive client code can regress silently. |
| **No backend deployment pipeline.** | Nothing is hosted; there is no staging environment to demo. |
| **No external audit.** | A hard prerequisite for mainnet, not yet started. |
| **Single-key operational risk** (G-08). | Oracle and keeper share one private key. |
| **iOS does not exist.** | Halves the addressable audience; the codebase is cross-platform but untested there. |

### 20.2 Product and market risks

| Risk | Honest assessment |
|---|---|
| **Density is the existential risk.** | A territory game with no neighbours is a lonely map. Everything in the growth plan attacks this, and it is what the team will be measured on first. It is a harder problem than any of the engineering above. |
| **Movement spoofing.** | Layered defences exist and are sound in principle, but they are unproven against a motivated attacker, and the economic caps that bound a successful cheat depend on `hex_activities` data that does not exist yet. |
| **Battery and device reliability.** | Continuous GPS drains batteries and behaves differently across hundreds of Android devices. Currently foreground-only, which limits drain but also limits the product. Unsolved and a known cost of the category. |
| **Economic balance.** | The design is utility-first and the guardrail is real, but the sinks have never been exercised with real users, and one advertised sink (the Great Burn) does not actually reduce supply. |
| **Regulation.** | Rules for digital assets vary by jurisdiction and keep moving. Mitigated by a utility-and-ownership framing, no income promises anywhere, and a phased rollout — but it is a genuine constraint on where and when the economy can launch. |
| **Location privacy.** | The design intent is strong; the implementation of retention and deletion is not there yet (G-13). Mishandling movement data would be both a harm and an existential reputational risk. |
| **Crypto's reputation.** | Many people have a justified negative association. Mitigated by leading with movement and health and keeping crypto invisible — but it costs some users before they try anything. |
| **Documentation over-claims.** | Public material describes an experience the app cannot yet deliver. Defensible as "as designed" with a disclaimer, but it becomes a credibility problem the moment someone installs the app expecting it. |
| **Scope breadth vs. team capacity.** | The repository spans Solidity, a Node backend with queues and an ORM, a React Native app, an identity subsystem, a marketing site, and a docs site. That is a lot of surface area to keep green. |

### 20.3 The single most important thing to fix

**Connect one complete vertical slice, end to end**: a real GPS session in the
app → `/gps/submit` → verification → an oracle signature → a real (testnet)
on-chain capture visible back in the app. That one path is the entire product
thesis. Every layer already exists; none of them has ever been joined. Doing it
would flush out the P0/P1 defects naturally, prove the architecture, and turn
the strongest claim in the pitch — *"we built the hard part first"* — from an
inventory of parts into a working demonstration.

---

## 21. House rules & working agreements

These are enforced constraints from `CLAUDE.md` and `docs/ROADMAP.md`. Any new
work — human or AI — is expected to follow them.

### 21.1 Scope

- Every feature must serve **Move → Capture → Defend → Own**. If it does not,
  it is out of scope.
- `docs/ROADMAP.md` is the canonical product-scope document. Read it before any
  scope decision.
- Preserve ideas by writing them into the roadmap, **never** by deleting code.

### 21.2 Do NOT (unless a roadmap phase explicitly calls for it)

- Add **AI features, AI APIs, or AI provider keys** — they do not serve the
  territory loop, and provider keys must never ship in the mobile app.
- Add **wallet connection, token rewards, or liquid MOVE** before GPS
  verification and Phase 1 density.
- Add **Supabase** or other new backend-as-a-service wiring from the app.
- Add new dependencies or payments casually.
- Build generic quest/step-counter features.
- Delete `contracts/`, `backend/`, `shared/`, or `mobile/_legacy/`.
- Edit `mobile/_legacy/` in place — lift patterns into new code instead.

### 21.3 Contracts

- **Audit before changing any contract.** Treat the Base Sepolia deployment as
  a production asset.
- Never re-deploy or overwrite contract code casually.
- V2 work must be **isolated** and must not touch V1 source or
  `deployments/baseSepolia.json`.
- Never fabricate an address, a transaction hash, or an EAS `projectId`.

### 21.4 Process

- Always work through **feature branches and pull requests**; never commit
  straight to `main`.
- Package manager is **Yarn 4 workspaces**; do not change `packageManager`;
  keep `nodeLinker: node-modules`.
- The app is on **Expo SDK 51**. Any SDK upgrade is a separate, device-tested
  PR where `expo install --fix` / `expo-doctor` can actually run.
- APKs build via the EAS GitHub Actions workflow, authenticated by the
  `EXPO_TOKEN` secret only. Never ask for an Expo password; never commit
  `EXPO_TOKEN`, tokens, or `.env` files.
- Never hardcode a colour in a screen — use `src/theme.ts`.
- Never bypass `questService.ts` when adding a quest data source.
- Never store credentials in AsyncStorage or a persisted Zustand store —
  the OS keystore only.

### 21.5 The hard guardrail (restated because it matters most)

**No liquid reward economy ships before (1) reliable GPS verification,
(2) real city/tile density, and (3) genuine sponsor/land demand.** Locked MOVE
and capped Liquid MOVE are deliberately separated for exactly this reason.

---

## 22. Roadmap & phase gates

### Phase 1 — Free Map Beta / Movement & capture *(current)*

Prove **Move → Capture** with zero real-money risk. GPS route tracking; H3
common-tile capture; XP and Locked MOVE as in-app credits only; **no liquid
rewards, no real emissions, no mainnet, no wallet requirement**; local or mock
backend first.
**Exit gate:** routes map reliably to tiles, capture feels good, density data
starts accumulating.

### Phase 2 — Clubs & city competition / Deed testnet

Prove **Defend → Own** against testnet contracts. Clubs, crew missions,
district control, city wars, seasons. Read `ZoneNFT` ownership; surface the
`ZoneChallenge` flow; simulate the Locked/Liquid split on testnet values. **No
mainnet economics.**
**Exit gate:** a user can see a deed, see a challenge, and understand the
reward-split model — all on testnet.

### Phase 3 — Mainnet city launch / On-chain ownership

Real Zone Deeds on Base mainnet; capped Liquid MOVE emissions; first paid
sponsors; premium tools; marketplace fees.
**Entry gate:** GPS verification is reliable, at least one city has real tile
density, and there is genuine sponsor/land demand. **Plus, from this review:**
V2 contracts shipped and an external audit completed.

### Phase 4 — Progressive decentralisation

On-chain proposals and voting; community treasury control; parameters moving
from stewardship to the community.

### Phase sequencing rationale

The blockchain work is largely done but ships **third**, on purpose:
a territory game needs neighbours before ownership means anything; an economy
needs sound inputs before it carries value; and sponsors need an audience
before they will pay. Revenue follows density, not the other way round.

---

## 23. Glossary

**Account abstraction** — technology that lets an app pay blockchain fees for a
user. *Claimed in public material; not implemented.*
**ADR** — Architecture Decision Record. MovenRun has ADR-0001 … 0013.
**Auto-valve** — the weekly rule that reduces `baseRate` 10% when the
burn/mint ratio falls below 0.7.
**Base** — the Ethereum Layer 2 MovenRun builds on, operated by Coinbase.
**Base Sepolia** — Base's public test network, chain ID 84532. Where all eight
contracts live.
**BullMQ** — the Redis-backed job queue used for GPS verification and keeper runs.
**Characterization test** — a test that documents *actual* behaviour, including
unsafe behaviour, so it cannot be mistaken for an approved invariant.
**Deed / Zone Deed** — the ERC-721 record of owning one hexagon.
`tokenId == H3 hex id`.
**Dormancy** — a zone untouched 180 days can be flagged; after 210 it can be
reclaimed and reopened.
**Drizzle** — the type-safe ORM used with PostgreSQL.
**Embedded wallet** — a wallet created and secured for the player automatically,
with no seed phrase. *Infrastructure built; no provider wired.*
**Fail closed** — when configuration or a dependency is missing, refuse rather
than degrade. Used throughout the backend.
**Gas** — the fee for writing to a blockchain.
**Great Burn** — the season-end event that takes 10% of top-zone yield.
*Currently a treasury transfer, not a burn.*
**H3** — Uber's open hexagonal global grid. MovenRun uses resolution 8
(~0.74 km², ~461 m edge).
**Hex / zone / tile** — three words for one H3 cell.
**Locked MOVE** — non-tradeable in-app credit shipped before the real economy.
Currently a display preview derived from XP.
**Loyalty multiplier** — 1.0× → 1.75× with holding time. *Applies only to
challenge defence, not yield.*
**$MOVE** — the ERC-20 token. Minted by verified movement; spent on claiming,
upgrading, challenging, staking.
**Oracle / `oracleOperator`** — the server-held EOA whose signature every
movement-dependent contract call requires.
**Proof of movement** — a validated route reduced to a deterministic hash and
signed by the oracle.
**Pull payment** — crediting yield to a contract for later withdrawal instead of
pushing transfers to thousands of owners.
**Route hash** — SHA-256 fingerprint of a route; permanently marked used to
block replays.
**Season** — a 90-day cycle: start → pause minting once 14 days remain → end → Great Burn.
**Stronghold boost** — a defender's 300 $MOVE, +20%, 24-hour buff, max 3 stacks.
**Testnet** — a practice chain where tokens are worthless.
**Zone tax** — 2% of everything minted in a hex, credited to that hex's deed
holder.

---

## 24. Canonical Q&A

Pre-written answers. Use these; they are accurate and correctly hedged.

**Q: What is MovenRun in one sentence?**
A GPS territory game on Base where the ground you cover becomes hexagonal map
tiles you can genuinely own as on-chain deeds — built so the person walking
never has to know a blockchain is involved.

**Q: Is it live? Can I play it?**
Not publicly. There is an installable Android APK built through EAS, but the
product is development-stage. The contracts are live on Base **testnet** only,
and the app does not yet connect to them.

**Q: Is there a token I can buy?**
No. $MOVE exists as a deployed testnet contract with no real value. There has
been no sale, no listing, no liquidity, and no allocation. Nothing in MovenRun
is an investment, and the team's own guardrail blocks any tradeable economy
until verification, density, and sponsor demand are all proven.

**Q: How much is actually built?**
Substantially more infrastructure than a typical project at this stage, and
substantially less user-facing product than the website implies. Built: eight
tested contracts deployed to Base Sepolia (49 tests), a GPS verification
backend with the oracle signing pipeline, a serious identity/session/wallet
foundation, a working mobile app with real GPS tracking and 36 screens, a
marketing site, and a 24-page docs site. Not built: the connection between
those layers, a wallet provider, gas sponsorship, and any mainnet presence.

**Q: What is the single biggest blocker?**
The wallet-provider decision (ADR-0011, status Blocked). Without it, the
"invisible onboarding" that the entire strategy rests on cannot be
demonstrated. The second biggest is that no vertical slice runs end to end.

**Q: Are the smart contracts safe?**
The deployed V1 is a **testnet reference implementation, not production-ready**.
The team catalogued 16 defects — two CRITICAL — each proven by a passing test.
The Defend → Own half of the loop is unsound as deployed. A V2 redeploy plus an
external audit are prerequisites for mainnet. Publishing that register is a
mark of engineering maturity, not of carelessness — but the defects are real
and must never be downplayed.

**Q: How do you stop people faking GPS?**
Layered defence: a speed gate (~80 km/h), an accuracy gate (rejects sessions
with >30% vague points), duration and monotonic-timestamp checks, a minimum
point count, a deterministic route fingerprint that can be used exactly once,
an oracle signature the contracts require, a hard daily mint cap per address,
and a minimum number of **distinct** movers before a zone becomes valuable. No
GPS system is perfectly spoof-proof; the claim is layered defence plus economic
caps that make cheating not worth the effort. The economic caps depend on hex
activity data that is **not yet collected**.

**Q: What happens to my location data?**
Raw GPS points stay on-device during and after a session — the finished session
is held in memory, not persisted. The design intent is to store proofs rather
than trails: the `routes` table keeps a hash, a distance, a primary hex, a
confidence score, and a signature, not the point array. On-chain, only a
32-byte hash, a distance, and a hex ID are ever written. Caveat: `/gps/submit`
does receive the raw array, and a retention/deletion policy for that payload is
designed but not yet implemented.

**Q: Why Base rather than another chain?**
Fees are a fraction of a cent, which is the only way a game generating
thousands of small daily transactions can sponsor every user's gas;
confirmation is roughly two seconds; Base has the strongest ecosystem for
embedded wallets and sponsored gas, which is what lets crypto stay invisible;
it is operated by Coinbase, which matters for consumer trust; and it has
deliberately positioned itself for mainstream consumer apps rather than
financial trading.

**Q: How is this different from the move-to-earn apps that collapsed?**
Three ways. First, the asset is **territory**, not a token balance, so progress
is ownable rather than sellable. Second, the sinks were designed **before** the
incentives — spending $MOVE is required to claim, upgrade, and defend, so
demand does not depend on speculation. Third, there is an enforced guardrail
blocking any tradeable economy until verification, density, and real demand are
proven. Honest caveat: one advertised sink, the Great Burn, does not currently
reduce supply.

**Q: What should the team do next?**
Fix the two P0 defects (§18), then connect one complete vertical slice end to
end — a real GPS session in the app through verification to a real testnet
capture visible back in the app. In parallel, unblock the wallet-provider
decision. Everything else follows from those.

---

## Document metadata

- **Version:** 1.0 · August 2026
- **Scope:** the complete `movenrun/` project in the `suhaib155/arena` repository
- **Method:** direct inspection of source, contracts, migrations, CI workflows,
  and all internal documentation; two runtime issues (G-02, and the `shared`
  resolution failure behind G-01) were reproduced directly rather than inferred.
- **Maintenance:** the fast-facts table (§1.2), build status (§11.2), defect
  register (§15–16), and drift table (§17) are the parts that go stale first.
  Re-verify them against the repository before relying on this file after any
  significant merge.
- **Not included:** no secrets, no private keys, no `.env` contents, and no
  credentials appear anywhere in this document. The only addresses listed are
  public Base Sepolia testnet addresses.
