# MovenRun — Contract Interaction Diagrams

## 1. GPS Route → Token Minting

```
Mobile App / Backend
      │
      │  off-chain: oracle signs (chainId, to, routeHash, distanceMeters, hexId)
      ▼
GPSOracle.submitRoute(to, routeHash, distanceMeters, hexId, sig)
      │
      │  1. recover signer from sig
      │  2. require signer == oracleOperator
      ▼
MoveToken.mintMOVE(to, routeHash, distanceMeters, hexId)
      │
      ├─ check usedRoutes[routeHash] (replay guard)
      ├─ check distanceMeters <= 100,000
      ├─ compute earned = distance * effectiveRate * gearMult / (1000 * 1e18)
      ├─ enforce daily cap
      ├─ update weeklyMoverCount (unique 7-day epoch)
      │
      ├─ if hexId != 0 and zoneNFT set:
      │     try ZoneNFT.creditZoneYield(hexId, potentialTax)
      │       └─ accumulatedYield[hexId] += potentialTax
      │     if success: zoneTax = potentialTax
      │
      ├─ _mint(to, earned - zoneTax)
      └─ if zoneTax > 0: _mint(zoneNFT, zoneTax)
```

---

## 2. Zone NFT Minting

```
Mobile App / Backend
      │
      │  off-chain: oracle signs (chainId, hexId, minterAddress, mintCost)
      ▼
ZoneNFT.mintZone(hexId, mintCost, oracleSig)
      │
      ├─ check zone not already minted
      ├─ check zone not dormant
      ├─ recover signer from sig (using block.chainid)
      ├─ check usedMintSigs[sigHash] (replay guard)
      │
      ├─ MoveToken.burnFrom(msg.sender, mintCost)
      │     └─ _spendAllowance + weeklyBurn++ + _burn
      │
      └─ ERC721._mint(msg.sender, hexId)
         ownershipStart[hexId] = block.timestamp
         lastActivity[hexId] = block.timestamp
```

---

## 3. Zone Challenge Lifecycle

```
Challenger                  ZoneChallenge              ZoneNFT / MoveToken
    │                            │                            │
    │  declareChallenge(hexId,   │                            │
    │    defenderBaseScore, sig) │                            │
    ├───────────────────────────►│                            │
    │                            │  verify sig (chainId+hexId+│
    │                            │  defender+score)           │
    │                            │  burnFrom(challenger, 100) │
    │                            │  challenges[hexId] = {...} │
    │                            │                            │
    │  submitScore(hexId,        │                            │
    │    score, sig)             │                            │
    ├───────────────────────────►│                            │
    │                            │  verify sig (chainId+hexId+│
    │                            │  submitter+score)          │
    │                            │  update challengerScore    │
    │                            │                            │
    │  [14 days pass]            │                            │
    │                            │                            │
    │  resolveChallenge(hexId)   │                            │
    ├───────────────────────────►│                            │
    │                            │  compare scores with       │
    │                            │  loyalty + stronghold boost│
    │                            │                            │
    │                            │  if challenger wins:       │
    │                            │  ZoneNFT.safeTransferFrom  │
    │                            │  (defender → challenger)   │
    │                            │────────────────────────────►
    │                            │                            │  transfer NFT
```

---

## 4. Season Lifecycle

```
Keeper (bot / Chainlink)             SeasonController           MoveToken
        │                                   │                       │
        │  startSeason()                    │                       │
        ├──────────────────────────────────►│                       │
        │                                   │  seasonNumber++       │
        │                                   │  seasonStart/End set  │
        │                                   │                       │
        │  [every week]                     │                       │
        │  weeklyKeeperRun()                │                       │
        ├──────────────────────────────────►│                       │
        │                                   │  adjustEmissionRate() │
        │                                   │──────────────────────►│
        │                                   │                       │  check burn/mint ratio
        │                                   │                       │  if < 70%: baseRate *= 0.9
        │                                   │                       │  reset weeklyMint/Burn
        │                                   │                       │
        │  [90 days later]                  │                       │
        │  greatBurn(hexIds, yields, sig)   │                       │
        ├──────────────────────────────────►│                       │
        │                                   │  verify oracle sig    │
        │                                   │  for each top zone:   │
        │                                   │    try transferFrom   │
        │                                   │    (owner → treasury) │
        │                                   │  adjustEmissionRate() │
        │                                   │──────────────────────►│
```

---

## 5. Zone Yield Withdrawal

```
Zone Owner                 ZoneNFT                 MoveToken
    │                         │                        │
    │  withdrawYield(hexId)   │                        │
    ├────────────────────────►│                        │
    │                         │  check ownerOf == msg.sender
    │                         │  amount = accumulatedYield[hexId]
    │                         │  accumulatedYield[hexId] = 0
    │                         │                        │
    │                         │  moveToken.transfer(   │
    │                         │    owner, amount)      │
    │                         │───────────────────────►│
    │                         │                        │  ERC20 transfer from
    │                         │                        │  ZoneNFT balance
    │◄────────────────────────────────────────────────-│
    │  receives $MOVE                                  │
```

---

## 6. DAO Proposal Execution

```
Proposer                MovenDAO               Target Contract
    │                      │                        │
    │  propose(type,        │                        │
    │  desc, target,        │                        │
    │  callData)            │                        │
    ├─────────────────────►│                        │
    │                      │  check balance ≥ 100   │
    │                      │  create proposal        │
    │                      │  7-day voting window    │
    │                      │                        │
    │  vote(id, support)    │                        │
    ├─────────────────────►│                        │
    │  [many voters]        │  accumulate for/against│
    │                      │                        │
    │  [7 days + 2 days]    │                        │
    │  execute(id)          │                        │
    ├─────────────────────►│                        │
    │                      │  check quorum (≥10%    │
    │                      │  of totalStaked)        │
    │                      │  p.target.call(callData)│
    │                      │───────────────────────►│
    │                      │                        │  executes change
```

---

## 7. Role Dependency Graph

```
DEFAULT_ADMIN_ROLE (deployer → governance via DAO)
    ├─ can grant/revoke all roles on each contract
    ├─ can set critical addresses (zoneNFT, moveToken, gpsOracle, etc.)

ORACLE_ROLE (GPSOracle)
    └─ MoveToken.mintMOVE

MINTER_ROLE (ZoneNFT)
    └─ MoveToken.setGearMultiplier

GOVERNOR_ROLE (MovenDAO + deployer)
    └─ MoveToken.updateBaseRate

SEASON_ROLE (SeasonController)
    ├─ MoveToken.adjustEmissionRate
    └─ MoveToken.resetWeeklyStats

KEEPER_ROLE (SeasonController deployer / Chainlink)
    ├─ SeasonController.startSeason
    ├─ SeasonController.pauseMinting
    ├─ SeasonController.endSeason
    ├─ SeasonController.greatBurn
    └─ SeasonController.weeklyKeeperRun

VAULT_ADMIN_ROLE / DAO_ROLE (MoveVault)
    ├─ addPOL
    ├─ withdrawTreasury
    └─ setRewardRate

ZONE_ADMIN_ROLE (ZoneNFT)
    └─ reserved for future use

GEAR_ADMIN_ROLE (GearNFT)
    └─ addGearType
```

---

## 8. Signature Verification Summary

| Function | Signed Data | Replay Guard |
|----------|-------------|--------------|
| `GPSOracle.submitRoute` | `chainId, to, routeHash, distanceMeters, hexId` | `usedRoutes[routeHash]` in MoveToken |
| `ZoneNFT.mintZone` | `chainId, hexId, msg.sender, mintCost` | `usedMintSigs[sigHash]` |
| `ZoneChallenge.declareChallenge` | `chainId, hexId, defender, defenderBaseScore` | per-challenge lifecycle state |
| `ZoneChallenge.submitScore` | `chainId, hexId, msg.sender, score` | `usedScoreSigs[sigHash]` |
| `SeasonController.greatBurn` | `chainId, seasonNumber, topHexIds[], yields[]` | seasonNumber increment |

All signatures use `ECDSA.recover(toEthSignedMessageHash(hash), sig) == oracleOperator`.
