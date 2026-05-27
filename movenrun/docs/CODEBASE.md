# MovenRun Contracts — Codebase Reference

## Directory Layout

```
contracts/
├── src/
│   ├── MoveToken.sol         — ERC-20 $MOVE token with oracle minting + emission schedule
│   ├── GPSOracle.sol         — ECDSA signature verifier; holds ORACLE_ROLE on MoveToken
│   ├── ZoneNFT.sol           — ERC-721 territory zones; yield crediting + dormancy
│   ├── GearNFT.sol           — ERC-1155 gear items with move multipliers
│   ├── MoveVault.sol         — $MOVE staking, POL, treasury
│   ├── ZoneChallenge.sol     — 14-day zone battle system
│   ├── SeasonController.sol  — 90-day seasons, weekly auto-valve, Great Burn
│   ├── MovenDAO.sol          — 3-tier governance voting
│   └── interfaces/
│       └── IGPSOracle.sol    — Minimal interface for oracleOperator getter
├── scripts/
│   └── deploy/
│       ├── baseSepolia.ts    — Production deploy + wiring for Base Sepolia
│       └── local.ts          — Local Hardhat node deploy
├── test/
│   ├── MoveToken.test.ts
│   ├── ZoneNFT.test.ts
│   ├── ZoneChallenge.test.ts
│   └── integration.test.ts
└── hardhat.config.ts
```

---

## MoveToken.sol

**Inherits:** ERC20, AccessControl

**Roles:**
- `DEFAULT_ADMIN_ROLE` — can set zoneNFT address, grant/revoke roles
- `ORACLE_ROLE` — held by GPSOracle; the only caller allowed to call `mintMOVE`
- `MINTER_ROLE` — held by ZoneNFT; can call `setGearMultiplier`
- `GOVERNOR_ROLE` — held by MovenDAO + deployer; can call `updateBaseRate`
- `SEASON_ROLE` — held by SeasonController; can call `adjustEmissionRate` and `resetWeeklyStats`

**Key State:**
- `baseRate` — current emission rate in $MOVE per 1000 meters (default: 10 ether)
- `deployBlock` — block number at deploy time; used to compute halvings
- `weeklyMint / weeklyBurn` — rolling weekly stats for auto-valve
- `weeklyMoverCount` — count of unique minters this epoch (7-day window)
- `dailyCaps[address]` — per-user daily cap struct `{minted, resetAt}`
- `gearMultiplier[address]` — gear bonus in 1e18 scale (1 ether = no bonus, 3 ether = 3x)
- `usedRoutes[bytes32]` — route replay protection
- `lastMintEpoch[address]` — last 7-day epoch index a user minted

**Constants:**
- `MAX_SUPPLY = 1,000,000,000 ether`
- `HALVING_INTERVAL = 2,600,000 blocks` (~90 days at 3s block time)
- `ZONE_TAX_BPS = 200` (2%)
- `MIN_BASE_RATE = 0.01 ether` (emission floor)
- `MAX_DISTANCE_METERS = 100,000` (100 km per route)

**Emission Formula:**
```
halvings = min((block.number - deployBlock) / 2,600,000, 20)
effectiveRate = baseRate / 2^halvings
earned = (distanceMeters * effectiveRate * gearMult) / (1000 * 1e18)
```

**Auto-Valve (adjustEmissionRate):**
```
if weeklyMint > 0 and (weeklyBurn * 10000 / weeklyMint) < 7000:
    baseRate = max(baseRate * 9000 / 10000, MIN_BASE_RATE)
```

---

## GPSOracle.sol

**Inherits:** AccessControl

**Roles:**
- `DEFAULT_ADMIN_ROLE` — can call `setMoveToken`, `updateOperator`

**Signature format (submitRoute):**
```
message = keccak256(abi.encodePacked(block.chainid, to, routeHash, distanceMeters, hexId))
ethHash = toEthSignedMessageHash(message)
ECDSA.recover(ethHash, sig) == oracleOperator
```

**Flow:** `submitRoute(to, routeHash, distanceMeters, hexId, sig)` → verifies sig → calls `IMoveTokenMint(moveToken).mintMOVE(to, routeHash, distanceMeters, hexId)`

---

## ZoneNFT.sol

**Inherits:** ERC721, AccessControl

**Roles:**
- `DEFAULT_ADMIN_ROLE` — sets challengeContract, seasonController
- `ZONE_ADMIN_ROLE` — reserved for future zone management

**Key Mappings:**
- `ownershipStart[hexId]` — timestamp when current owner acquired the zone
- `lastActivity[hexId]` — last activity timestamp (updated on yield credit)
- `accumulatedYield[hexId]` — unclaimed yield in $MOVE
- `isDormant[hexId]` — true once marked inactive
- `usedMintSigs[bytes32]` — mint signature replay protection

**Zone Mint Signature:**
```
sigHash = keccak256(abi.encodePacked(block.chainid, hexId, msg.sender, mintCost))
```

**Loyalty Multiplier:**
| Ownership Duration | Multiplier |
|--------------------|-----------|
| < 90 days          | 100 (1.0x) |
| ≥ 90 days          | 125 (1.25x)|
| ≥ 180 days         | 150 (1.50x)|
| ≥ 365 days         | 175 (1.75x)|

**Zone Tax Flow:**
1. Runner submits GPS route through zone (hexId != 0)
2. GPSOracle calls MoveToken.mintMOVE with hexId
3. MoveToken calls ZoneNFT.creditZoneYield(hexId, tax) — updates accumulatedYield
4. MoveToken mints tax tokens to ZoneNFT contract address
5. Zone owner calls withdrawYield(hexId) to pull their $MOVE

---

## GearNFT.sol

**Inherits:** ERC1155, AccessControl

**Gear Slots:** Shoes, Jacket, Watch, Headband (4 slots, `GearSlot` enum)

**Multiplier Calculation:**
```
result = 1 ether
for each equipped slot:
    result = result * gearStats[tokenId].multiplierBps / 10_000
```

Result returned in 1e18 scale; passed to MoveToken.setGearMultiplier.

---

## MoveVault.sol

**Inherits:** AccessControl, ReentrancyGuard

**Roles:**
- `VAULT_ADMIN_ROLE` — can call `addPOL`, `setRewardRate`
- `DAO_ROLE` — can call `withdrawTreasury`, `setRewardRate`

**Staking Reward Formula:**
```
elapsed = block.timestamp - lastRewardClaim
reward = (staked * rewardRatePerSecond * elapsed) / 1e18
```

Rewards accrue continuously. `lastRewardClaim` is only advanced when the reward is actually paid (treasury sufficient). Accrual window stays open if treasury is dry.

---

## ZoneChallenge.sol

**Inherits:** AccessControl, ReentrancyGuard

**Challenge Lifecycle:**
1. `declareChallenge(hexId, defenderBaseScore, oracleSig)` — challenger burns 100 $MOVE; 14-day window starts
2. `submitScore(hexId, score, oracleSig)` — either party submits oracle-signed scores; cutoff 1 hour before end
3. (Optional) `activateStrongholdBoost` — defender burns 300 $MOVE for 24h boost (max 3 stacks, +20% each)
4. (Optional) `requestTimeExtension` — defender burns 500 $MOVE for +3 days (once per challenge)
5. `resolveChallenge(hexId)` — after window; compares `challengerScore` vs `(defenderBaseScore + defenderScore) * strongholdBoost * loyaltyMult / 100`

**Score Submission Signature:**
```
sigHash = keccak256(abi.encodePacked(block.chainid, hexId, msg.sender, score))
```

**Challenge Declare Signature:**
```
message = keccak256(abi.encodePacked(block.chainid, hexId, defenderAddress, defenderBaseScore))
```

---

## SeasonController.sol

**Inherits:** AccessControl

**Roles:**
- `KEEPER_ROLE` — can call startSeason, pauseMinting, endSeason, greatBurn, weeklyKeeperRun

**Season Flow:**
1. `startSeason()` — begins 90-day season
2. `pauseMinting()` — callable 14 days before end
3. `greatBurn(topHexIds, yields, sig)` — at season end; burns 10% of top zone yields to treasury; calls adjustEmissionRate
4. `weeklyKeeperRun()` — intermediate calls to adjustEmissionRate

**Great Burn Signature:**
```
payload = keccak256(abi.encode(block.chainid, seasonNumber, topHexIds, yields))
```

---

## MovenDAO.sol

**Inherits:** AccessControl, ReentrancyGuard

**Voting Tiers:**
| Tier | Condition | Weight |
|------|-----------|--------|
| Active | staked ≥ 1000 $MOVE | 1.5x (total $MOVE + staked) |
| Community | any holder | 1.0x (balance + staked) |

**Governance Flow:**
1. `propose(type, description, target, callData)` — requires 100 $MOVE balance
2. 7-day voting period
3. 2-day execution delay
4. `execute(proposalId)` — requires forVotes > againstVotes AND forVotes ≥ 10% of totalStaked (quorum)

---

## Key Invariants

1. Only GPSOracle (ORACLE_ROLE) can call `mintMOVE`
2. Signatures must include `block.chainid` — cross-chain replays are impossible
3. Route hashes are used exactly once (`usedRoutes[routeHash]`)
4. Zone mint sigs are used exactly once (`usedMintSigs[sigHash]`)
5. Score sigs are used exactly once (`usedScoreSigs[sigHash]`)
6. Zone tax (2%) only flows to minted zones; unminted hexId → no tax taken
7. ZoneNFT token balance ≥ sum of all `accumulatedYield[hexId]` at all times
8. MoveVault staking reward accrual is never silently discarded

---

## Deployment Order (Required)

```
1. MoveToken(adminAddress)
2. GPSOracle(oracleOperatorAddress)
3. ZoneNFT(moveToken, gpsOracle)
4. GearNFT(moveToken)
5. MoveVault(moveToken)
6. ZoneChallenge(zoneNFT, moveToken, gpsOracle)
7. SeasonController(moveToken, zoneNFT, zoneChallenge)
8. MovenDAO(moveToken, zoneNFT, moveVault)

Wiring:
  moveToken.grantRole(ORACLE_ROLE, gpsOracle)
  moveToken.grantRole(MINTER_ROLE, zoneNFT)
  moveToken.grantRole(GOVERNOR_ROLE, movenDAO)
  moveToken.grantRole(SEASON_ROLE, seasonController)
  gpsOracle.setMoveToken(moveToken)
  zoneNFT.setSeasonController(seasonController)
  zoneNFT.setChallengeContract(zoneChallenge)
  zoneChallenge.setSeasonController(seasonController)
  seasonController.setGpsOracle(gpsOracle)
  seasonController.setDaoTreasury(treasuryAddress)
  moveToken.setZoneNFT(zoneNFT)
```
