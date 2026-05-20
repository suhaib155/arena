# MovenRun Architecture

## Contract Interaction Diagram

```
Mobile App (Expo)
    │
    ├── Privy (wallet / signing)
    │
    └── Backend API (Express)
            │
            ├── GPS Worker (BullMQ) ─── validates route ─── signs proof ──▶ MoveToken.mintMOVE()
            │                                                                     │
            │                                                              ZoneNFT.creditZoneYield()
            │                                                              (2% zone tax credited)
            │
            ├── /zones/mint ─────────────────── signs mint sig ──▶ ZoneNFT.mintZone()
            │
            ├── /battles/declare ────────────── signs defender score ──▶ ZoneChallenge.declareChallenge()
            │
            └── Keeper Worker ──────────────── weekly ──▶ SeasonController.weeklyKeeperRun()
                                                                │
                                               season end ──▶ SeasonController.greatBurn()
```

## Oracle Flow

Every on-chain action that depends on off-chain GPS data is gated by an **oracle signature**
from the MovenRun backend. The oracle signs using an Ethereum private key held server-side.

1. **Route submission**: Mobile posts raw GPS points to `POST /gps/submit`
2. **BullMQ processing**: GPS Worker validates points (speed, accuracy, duration anomaly checks)
3. **Route hash**: SHA-256 of (walletAddress, points[], startTime, endTime) → deterministic `bytes32`
4. **Oracle sign**: `keccak256(walletAddress, routeHash, distanceMeters)` → EIP-191 signed
5. **On-chain mint**: User submits (routeHash, oracleSig, distanceMeters) → `MoveToken.mintMOVE()`
6. **Route replay guard**: `usedRoutes[routeHash] = true` prevents double-claiming

The oracle private key **must** be rotatable via `MoveToken.updateOracle()` (admin-gated).

## H3 Hex Grid

- **Library**: [H3](https://h3geo.org/) (Uber's hierarchical hexagonal geospatial system)
- **Resolution**: 8 — average hex area ~0.74 km², edge length ~461 m
- **Cell ID**: 64-bit integer, used directly as ERC-721 `tokenId` in ZoneNFT
- **Mobile rendering**: `h3.cellToBoundary(hexId)` returns lat/lng vertices for Polygon overlay
- **Hex coverage from route**: `h3.latLngToCell(lat, lng, 8)` for each GPS point → deduplicated set
- **Visible hex rendering**: `h3.polygonToCells(mapBoundingBox, 8)` gives all cells in viewport

## GPS Verification Pipeline

```
POST /gps/submit
    │
    ▼
BullMQ queue: "gps-verification"
    │
    ▼
GpsService.validateRoute()
    ├── speed check: consecutive point distance / time < 22 m/s (~80 km/h)
    ├── accuracy check: < 30% of points with accuracy > 50m
    └── duration check: < 24 hours
    │
    ▼ (if valid)
GpsService.calculateDistance() — Haversine formula
HexService.getHexIdsForPoints() — H3 resolution 8 cell IDs
GpsService.buildRouteHash()    — SHA-256 of route payload
OracleService.signRouteProof() — EIP-191 signed (address, hash, distance)
    │
    ▼
Store to DB: routes table (status=VERIFIED, oracleSig, routeHash)
Mobile polls GET /gps/verify/:id → returns proof for on-chain submission
```

## Challenge Resolution Flow

```
Challenger calls ZoneChallenge.declareChallenge(hexId, defenderBaseScore, oracleSig)
    │  Burns 100 $MOVE, opens 14-day window
    ▼
Both parties call submitScore(hexId, score, oracleSig) — oracle attests movement score
    │
    │  (Optional) Defender: activateStrongholdBoost() — burns 300 $MOVE, +20% for 24h (max 3 stacks)
    │  (Optional) Defender: requestTimeExtension() — burns 500 $MOVE, +3 days (once per challenge)
    ▼
After challengeEnd: anyone calls resolveChallenge(hexId)
    │
    ├── adjustedDefenderScore = (defenderBaseScore + defenderScore) * strongholdMult * loyaltyMult
    ├── if challengerScore > adjustedDefenderScore → transfer Zone NFT to challenger
    └── else → 30-day cooldown on challenger for that hex
```

## Zone Dormancy System

- **lastActivity[hexId]** updated on every `mintMOVE` call for that hex
- After **180 days** of inactivity: anyone can call `markDormant(hexId)`
- After **210 days** of inactivity: anyone can call `reclaimDormant(hexId)` — burns the NFT, re-opens minting

## SeasonController (Chainlink Keeper Compatible)

- Keeper calls `startSeason()` to begin 90-day season
- Keeper calls `pauseMinting()` when ≤14 days remain
- Keeper calls `weeklyKeeperRun()` every 7 days → triggers emission auto-valve
- Keeper calls `endSeason()` + `greatBurn(topHexIds, yields, sig)` at season end

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Oracle signature for all mints | Prevents GPS spoofing on-chain without expensive ZK proofs |
| H3 hex tokenId = hexId (uint64) | Bijective mapping, no secondary lookup needed |
| Zone tax via ZoneNFT contract holding $MOVE | Avoids per-mint token transfers to potentially thousands of zone owners |
| BullMQ for GPS validation | Decouples expensive validation from HTTP response; retry on failure |
| Drizzle ORM + Postgres | Type-safe queries, good migration tooling; Redis for queues only |
