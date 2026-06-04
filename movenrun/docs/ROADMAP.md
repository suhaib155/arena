# MovenRun — Roadmap

This document tracks the **active product direction** and **preserved future
directions** for MovenRun. It is the canonical place for product scope so that
`CLAUDE.md` can stay short and the older ideas are never lost.

---

## ✅ Current active direction — AI Movement Quest MVP

The app being actively built and shipped is a **lightweight AI movement-quest
app**:

- A **daily movement quest** plus a browsable quest list.
- **Start → active timer → finish → XP result** flow.
- **XP, levels, and a daily streak**, persisted on-device.
- A **profile/streak** screen with recent activity.

**Implementation:** `mobile/` (Expo SDK 51, React Native 0.74, Expo Router v3,
TypeScript, Zustand + AsyncStorage). Quests are served through a quest service
seam (`mobile/src/services/questService.ts`), backed today by local mock data
(`mobile/src/data/quests.ts`).

**Quest service seam (prep for AI quests):** screens depend only on
`questService`, never on raw quest arrays. When AI-generated quests arrive they
must be produced **server-side** (no provider keys in the app) and exposed via an
alternate `QuestService` implementation prefetched at session start — without
rewriting screens. Do not bypass `questService` when adding a new quest source.

**Anti-farming:** each quest awards XP at most once per local day
(`completedQuestIds` + `getLocalDateKey()`), surfaced as a "completed today"
state. This keeps daily XP/streaks honest.

**Deliberately out of scope until the basic app is stable:**

- No real AI API calls and no AI provider keys in the app.
- No wallet / blockchain / token logic.
- No Supabase or other backend wiring from the mobile app.
- No payments.

The goal is a simple, working, demoable app first. Everything below is parked
until that foundation is solid.

---

## 🗄️ Preserved legacy direction — GPS / Blockchain / Move-to-Earn

The original MovenRun concept is a **GPS-based move-to-earn territory protocol
on Base chain**. It is intentionally preserved, not abandoned:

> GPS-based move-to-earn territory protocol on Base chain. Users run/walk/cycle
> through real-world locations. GPS routes verified on-chain via Chainlink
> oracle. Moving through a hexagonal zone earns $MOVE tokens. Top mover in a
> zone can mint it as a Zone NFT. Zone NFT owners earn 2% of all $MOVE earned by
> anyone moving through their zone. Zones can be challenged in 14-day battles.

**Where the legacy work lives today:**

- `mobile/_legacy/` — the earlier Expo/React Native screens, hooks, store, and
  components (Privy wallet, Mapbox/maps, H3 hex overlay, GPS tracking,
  token/zone/battle UI). Parked out of the active Expo Router build. See
  `mobile/_legacy/README.md`.
- `contracts/` — Hardhat + Solidity smart contracts (MoveToken, ZoneNFT,
  GearNFT, ZoneChallenge, SeasonController, MoveVault, MovenDAO).
- `backend/` — Express API + BullMQ workers + Drizzle ORM (Postgres + Redis).
- `shared/` — shared TypeScript types and constants (incl. H3 resolution 8).
- `docs/ARCHITECTURE.md`, `docs/TOKENOMICS.md` — contract interaction/oracle flow
  and emission/burn details.

### Legacy technical decisions (still valid for the future module)

- **MoveToken** — ERC-20 $MOVE, 1B supply, oracle-gated minting, halving every
  `HALVING_INTERVAL` blocks.
- **ZoneNFT** — ERC-721, tokenId = H3 hex ID (uint64), 2% zone tax, dormancy
  system.
- **GearNFT** — ERC-1155, gear with stat multipliers.
- **ZoneChallenge** — 14-day battle system, stronghold boost, time extension.
- **SeasonController** — 90-day seasons, Great Burn, Chainlink Keeper.
- **MoveVault** — staking, POL, treasury.
- **MovenDAO** — 3-tier governance voting.
- **H3 resolution 8** hexagons (~0.74 km² each), Privy wallet auth, Base chain.

> ⚠️ **Do not delete the legacy code** in `mobile/_legacy/` (or the
> `contracts/` / `backend/` GPS-blockchain work) without explicit owner
> approval. It is parked intentionally as a future module.

---

## 🔮 Future possible integrations

Ordered roughly by how naturally they extend the current MVP. None are committed;
each should land as its own branch + PR once the basic app is stable.

1. **GPS route tracking** — capture real walk/run/cycle routes (revive
   `mobile/_legacy/hooks/useGPS.ts` and the map UI).
2. **Real movement verification** — validate that a quest was physically
   performed (motion sensors, GPS distance, Chainlink oracle as in the legacy
   design).
3. **Wallet / rewards** — convert XP into real rewards or tokens (Privy +
   `$MOVE`, building on `contracts/`).
4. **Social leaderboard** — friends, streak rankings, zone leaderboards.
5. **AI-generated quests** — implement an alternate `QuestService` backed by a
   server endpoint that returns AI-generated quests (keys stay on the backend,
   never in the app). The `questService` seam + `useSessionStart` prefetch point
   already exist, so this should not require screen rewrites.
6. **Supabase / backend** — accounts, cloud sync of XP/streak/history, quest
   delivery (extend the existing `backend/`).
7. **Health integrations** — Apple Health / Google Fit / wearables for steps,
   heart rate, and workout import.

---

## Working agreement

- Always work through **feature branches and pull requests**.
- Keep the **MVP simple and working** before adding any of the future
  integrations above.
- Preserve legacy work — move ideas into this roadmap rather than deleting them.
