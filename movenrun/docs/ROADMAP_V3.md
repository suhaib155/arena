# MovenRun roadmap, aligned to Game Economy V3

Supersedes the earlier roadmap sketch. V3 (31 August 2026, revision 2) settles
questions the old plan left open and invalidates several of its items outright,
so this is a rewrite rather than an annotation.

**What V3 changes about the plan, in one paragraph.** Sealing is no longer a
"maybe" mechanic pencilled in at #93 — it is the core of the game, and it
arrives with a solid/shade distinction the old roadmap did not contemplate at
all. Wallets and sponsored gas move from "only if strategy requires" to
required, and V3 names them the largest unbuilt dependency in the design. The
token question is closed: one token, one billion, fixed. Gear is gone,
replaced by a different mechanic (kit). And the build order is now explicitly
phased around a **credits-only pilot with no transferable reward** — which
places most token and deed work later than the old plan assumed.

---

## 0. Verified against the code

Every claim V3 makes about the codebase was checked. They hold, with two
corrections in our favour and one that is not.

| V3 claim | Verified |
|---|---|
| App uses a local ~300 m lattice, not real H3 | **Confirmed** — `mobile/src/lib/zones.ts`, `CELL_M = 300`; its comment still says "res 9, matching shared/", which is also wrong (canonical is 8) |
| Deed eligibility from traffic not built | **Confirmed** — `hex.service.ts:getHexActivity` returns hard-coded zeros; `hex_activities` has no writer anywhere |
| The word "toll" appears nowhere | **Confirmed** — zero matches in backend, mobile, contracts, shared |
| Sealing, shade, erosion, day-share, charge, recharge | **Confirmed** — zero source files match any of them |
| Deployed contract pays per kilometre | **Confirmed** — `GPSOracle.mintMOVE(to, routeHash, distanceMeters, hexId)` |
| V1 has loyalty tiers and dormancy | **Confirmed** — `LOYALTY_TIER1..4`, `DORMANCY_PERIOD`; V3 removes both |
| No paymaster / 4337 / bundler / gasless anywhere | **Substantively true.** Three files match incidentally: a comment noting a Base Account is ERC-4337, "Expo Metro bundler" in a CORS allowlist, and `ClaimBundleRequest`. No implementation exists |
| Movement verification pipeline built | **Confirmed and now on `main`** (merged) |

**One thing V3 asserts that is not true yet.** It closes by naming
`movenrun/docs/GAME_ECONOMY_V3.md` as the authoritative technical
specification — "settlement invariants for the fuzz test suite, the contract
responsibilities, the exact on-chain and off-chain boundary" — and says that
where the guide simplifies, that document governs. **That file does not
exist.** Nothing below Phase 0 can be built to spec until it does, because the
PDF deliberately omits the invariants and the settlement algorithm.

---

## 1. Open PRs, and what V3 does to each

`#73` is merged. The rest remain open. V3 does not invalidate any of them, but
it changes what several of them mean.

### The deed/backend chain — order preserved
`#82 → #83 → #86 → #84 → #85 → #87`, with `#80` and `#81` largely independent.

| PR | V3 impact |
|---|---|
| #80 DeedRegistry | **Not the V3 deed.** See §2 below — this is a strict subset |
| #81 Metadata | Compatible. Attributes are factual and carry no income language, which V3 requires |
| #82 Oracle signer | Compatible and reusable. V3's settlement needs an expiring, chain-bound signature of exactly this shape |
| #83 Claim bridge | Compatible. Its eligibility source becomes traffic-based rather than traversal-based under V3 |
| #86 CLI wiring | Compatible |
| #84 / #85 / #87 | Evidence tiers, deadline pack, runbook. Unaffected |

### The mobile stack
| PR | V3 impact |
|---|---|
| #63, #65, #69, #70, #71, #72 | UI foundation. Still needed. #72's removal of false ownership/PvP claims is now *more* important, because V3 forbids exactly those claims |
| #64 | Fail-closed test discovery. Land before integration; the guard findings below make it more valuable, not less |
| #66 | GPS integrity. **Load-bearing under V3** — sealing and verification both depend on route fidelity |
| #67, #68 | Android platform readiness. Unaffected |
| #74–#78 | Movement verification client. **The foundation of Phase 1.** #77's bounded retry and #78's privacy corrections are directly required by V3 §27 |
| #45 | Reference only. V3 removes loyalty, dormancy and the mint-time zone tax, so most of its economy code is now superseded rather than pending extraction |

---

## 2. The gap between #80 and the V3 deed

Worth stating plainly, because it is easy to assume the registry is finished.

V3 marks all of the following **FIXED** for deeds. #80 implements none of them:

| V3 requirement | #80 |
|---|---|
| Solid ground only; shade never deedable | No solid/shade concept exists |
| Eligibility: 30 distinct verified people across 10 days, excluding related accounts and the owner's own traffic | No traffic requirement — oracle authorization alone |
| Deed tenure: 21 days | Not modelled |
| Claim fee, scaling with traffic, burned | No fee |
| Per-person-per-city cap | No cap |
| Deeded cells cannot be worn down | No condition model, so vacuously true |
| Transfer only by sale or formal contest, settled from escrow | Plain ERC-721 transfer; no contest, no escrow |
| Collects the 2% toll | No toll |

**#80 is honest as what it claims to be** — "the smallest registry that can
exist" — and it is a sound base to extend. But a deed minted under it today is
not a V3 deed, and pilot deeds issued for the Base application should be
described as an early registry test, never as the deed the design describes.

---

## 3. A tension to decide deliberately

V3's build order puts **transferable reward in Phase 2**, after a credits-only
pilot of 1,000–5,000 players, and says plainly: *"Phase 1 is the one that
decides everything. A territory game people love without any token is a
business. A token attached to a game nobody loves is a liability."*

The Base Batches work deploys a deed registry and mints pilot deeds **now**,
ahead of that pilot. Those are not contradictory — a deed is not a token, no
$MOVE is involved, and the pilot is explicitly a demonstration — but the
sequencing is a decision, not an accident, and it should be made knowingly:

- **Proceeding** gives the application real on-chain evidence, at the cost of
  issuing deeds under rules that will later change.
- **Deferring** keeps the deed model coherent, at the cost of applying with a
  tested-but-undeployed registry.

Either is defensible. Applying with a tested registry and no deployment is
also defensible — §"Claims safe if only Sepolia is complete" in the deadline
pack covers that wording.

---

## 4. Blocking prerequisites — before any phase

| # | Work | Why it blocks |
|---|---|---|
| **P1** | Write `docs/GAME_ECONOMY_V3.md` | V3 defers to it for settlement invariants, contract responsibilities and the on/off-chain boundary. It does not exist |
| **P2** | Correct three false public-site statements | V3 §31 says "must be corrected now": the site says MovenRun runs on Base without saying testnet; claims role-gating and a timelock that do not exist (one key controls all eight contracts); and promises deed-holder "in-game yield" and live staking, both of which V3 removes |
| **P3** | H3 reconciliation | The app's 300 m lattice and the contracts' H3 cell ids "index different worlds". V3: *"No amount of economy design fixes this one"* |
| **P4** | Mobile integration stack | Combine #63–#78 with #64/#66/#67/#68 into one coherent build with regenerated test inventory |

P2 is small, urgent, and independent of everything else.

---

## 5. Phase 0 — Simulation

No product code. V3 lists what must be proven before Phase 1 begins, and this
is the whole scope:

- the daily budget holds; toll invariants balance to zero
- the ceilings bite where §17 says (12/session, 20/day, 100k pool)
- shade cannot be farmed; sessions cannot be split
- the recharge is affordable at every population
- upkeep scaling actually deters hoarding
- contests are fair to solo, small-club and large-club attackers at +15%
  fortification — **and if not, the cap goes to zero**
- fake-account economics under a shared pool

Deliverable: a simulation harness plus a written result per bullet. Several V3
numbers are marked HYPOTHESIS and are meant to be replaced by measurement here.

---

## 6. Phase 1 — Credits-only pilot

**No transferable reward. No token. No deeds.** The phase V3 says decides
everything.

| # | Work |
|---|---|
| **1.1** | Sealing engine — loop closure by return-to-start (150 m), own ground, or self-intersection; solid vs shade classification; shape and sprawl factors |
| **1.2** | Territory authority backend — zones, ownership, one holder per cell, strength 0–100, transaction-safe transitions |
| **1.3** | Verified movement → claim — server-authoritative; the client never asserts ownership |
| **1.4** | Erosion and decay — push subtraction, overflow flip, 3× shade decay, the held/at-risk/contested/dormant calendar |
| **1.5** | Upkeep and the skip penalty — per-zone cost scaling with holdings, 60% day-close cap, unpayable upkeep paid in condition, 14 free away days |
| **1.6** | Charge and the daily recharge — 50% per scoring session, settled on credit at day close, no cash top-up, empty kit still plays |
| **1.7** | Land levels and kit levels — 5 each, burned, defence and tools only, never income |
| **1.8** | Fortification — +30%/−30%, max 3 active, +15% contest cap |
| **1.9** | Daily settlement in credits — day-share, effort curve, consistency multiplier, trust weight, both ceilings, trim back to season pool |
| **1.10** | Real territory map sync — authoritative state on the Daylight Cartography map |
| **1.11** | Clubs, districts, seasons — real membership and contribution, replacing seeded previews |
| **1.12** | The eleven retention mechanics — none of which creates a token |

**Exit criteria are V3's own:** week-4 retention above 25%, a thousand active
players in one city, >20% of zones contested, three sessions in an active week,
club participation above 30%.

---

## 7. Phase 2 — Limited $MOVE

Only after Phase 1's numbers.

| # | Work |
|---|---|
| **2.1** | Embedded wallet + passkey — email/phone sign-up, wallet created automatically, exportable. Resolves ADR-0011 |
| **2.2** | Paymaster and sponsored gas — with all six controls from V3 §25, including the circuit breaker and the never-sponsored-only exit path. **V3 names this the largest unbuilt dependency** |
| **2.3** | $MOVE supply contract — 1B hard cap, no raise function, no admin override, no upgrade path reaching it |
| **2.4** | On-chain daily settlement — batched, deterministic, versioned, independently recomputed by a reconciliation job that halts on imbalance |
| **2.5** | Deed eligibility from real traffic — 30 distinct verified people over 10 days, related accounts and owner traffic excluded. Replaces the `getHexActivity` stub |
| **2.6** | The 2% toll — once per session in total, split by deeded cells crossed, matched debit/credit summing to zero |
| **2.7** | Deed registry v2 — solid-only, per-city cap, burned claim fee, no wear-down, tenure. Extends #80 |
| **2.8** | Contests — 72h notice, 7-day window, best 3 days, escrow settlement anyone can trigger, cooldowns |
| **2.9** | Locked vs liquid — free players' rewards never sellable, never retroactively so; liquid issuance capped at real revenue |
| **2.10** | Appeals and trust states — confirmed/pending/not-eligible/appeal, with human review |

**Exit criteria:** every day's books balance; appeals work; location deletion
verifiably happens; owner tolls provably come from runner rewards; the
paymaster policy holds under attack.

---

## 8. Phase 3 — Multiple cities

Geographic partitioning, club controls at scale, market-manipulation tests,
and **legal sign-off on land unlocking liquidity before liquid earnings ship**.

Business-side work belongs here: the footfall event model (server-authoritative
verified visits, aggregated and thresholded, no raw GPS), the sponsor console,
and the business→footfall payment rail in ETH/USDC with auditable settlement.
This is "system two" — the actual revenue — and V3 is explicit that the
business must stand even if $MOVE were worth nothing.

---

## 9. Phase 4 — Full scale, then staking

Load tested at twice projected peak, external security audit, incident drills,
app-store and legal sign-off. Staking (100M allocation) is deferred to here and
nowhere earlier.

---

## 10. Cross-cutting, not phase-gated

| # | Work | Note |
|---|---|---|
| **X1** | Guard mutation audit | **Six guards have now been found passing while checking the wrong thing**, three of them mine. Green guards are not evidence until their mutation has been demonstrated |
| **X2** | Scoped config for one-shot CLIs | Decouple tools from the global validator so unused Redis/RPC settings stop being bootstrap requirements |
| **X3** | Abuse and rate controls | Bounds, backpressure, per-account quotas on public APIs |
| **X4** | Observability | Health, privacy-safe structured logs, metrics, settlement and deed pipeline dashboards |
| **X5** | Migration and deployment safety | CI-checked migrations, ordering, rollback, environment validation |
| **X6** | Security acceptance | Auth, secrets, CORS, replay, privacy, contract roles, information leakage |
| **X7** | Device QA | Physical Android/iOS matrix: GPS, permissions, pauses, interruptions, offline retry, battery, large screens |
| **X8** | Notifications | With user controls, and no background-location abuse |
| **X9** | Background movement | Only with permission, battery and privacy acceptance testing — and it must not weaken the foreground-only guarantees currently guarded |

---

## 11. Dropped from the old roadmap

| Old item | Why |
|---|---|
| #93 "Enclosure capture — if this mechanic remains" | Settled. Sealing is core, and brings solid/shade with it. Folded into 1.1 |
| #105 "Token decision — re-evaluate whether MOVE is necessary" | Settled. One token, 1B cap, fixed |
| #106 Gear | V3 has no Gear. Kit levels are a different mechanic (player-side, recharge rate) — folded into 1.7 |
| #100 "Sponsored gas only if strategy requires" | No longer conditional. Required, and the largest unbuilt dependency |
| #98 "Reward authority" as a standalone | Absorbed into 1.9 and 2.4; V3 specifies the algorithm |
| Area-weighted prize draws | V3 explicitly declines them — gambling-shaped, with app-store and legal exposure |

---

## 12. What can honestly be said today

Unchanged by V3, and worth repeating because V3 §31 says the same thing more
bluntly: **none of the economy in Parts One and Two is implemented.** Eight
contracts exist on Base Sepolia implementing an older, different design with
sixteen documented defects, three critical. No deed has ever been created on
any network. No token has ever reached a player. There is no Base mainnet
deployment.

The safe-claims matrix in the deadline pack governs every public statement.
V3 does not loosen it.
