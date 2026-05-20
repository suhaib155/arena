# MovenRun Tokenomics — $MOVE

## Summary

| Parameter | Value |
|---|---|
| Token name | MoveToken ($MOVE) |
| Chain | Base (EVM) |
| Total supply cap | 1,000,000,000 $MOVE |
| Decimals | 18 |
| Minting mechanism | Oracle-gated (GPS proof) |
| Initial emission | 10 $MOVE per km |
| Halving interval | ~2,600,000 blocks (~6 months on Base at 2s blocks) |

---

## Emission Schedule

Each halving reduces the per-km rate by 50%:

| Epoch | Blocks | Approx. Time | Rate ($/km) | Daily Cap |
|---|---|---|---|---|
| 0 | 0 – 2.6M | Months 1–6 | 10 $MOVE/km | 200 $MOVE |
| 1 | 2.6M – 5.2M | Months 7–12 | 5 $MOVE/km | 100 $MOVE |
| 2 | 5.2M – 7.8M | Months 13–18 | 2.5 $MOVE/km | 50 $MOVE |
| 3 | 7.8M – 10.4M | Months 19–24 | 1.25 $MOVE/km | 25 $MOVE |

> Note: The ARCHITECTURE.md referenced 7→4.9→3.4 as target rates. Those are *effective*
> rates after the **auto-valve** may have reduced `baseRate` by up to 10%/week based on
> burn/mint ratio. The halving schedule above is the ceiling; actual rates may be lower.

---

## Auto-Valve Formula

Runs weekly (called by SeasonController Keeper):

```
if (weeklyBurn / weeklyMint < 0.7):
    baseRate = baseRate * 0.9    // reduce 10%
```

This creates deflationary pressure if burn activity is low. The valve only reduces —
DAO governance via `GOVERNOR_ROLE` can vote to increase `baseRate` within supply cap.

---

## Gear Multipliers

Gear NFTs (ERC-1155) add multipliers to the `earned` calculation:

```
earned = (distanceMeters / 1000) * effectiveRate * gearMultiplier / 1e18
```

Gear slots: Shoes, Jacket, Watch, Headband. Each slot contributes an independent multiplier.
Combined max multiplier: 3x (enforced in `MoveToken.setGearMultiplier`).
Gear multipliers are set by the MINTER_ROLE when a user equips gear (synced from GearNFT).

---

## Burn Sinks

| Action | Amount Burned | Who |
|---|---|---|
| Zone NFT mint | `500 * sqrt(weeklyMoverCount)` $MOVE | Minting user |
| Challenge declaration | 100 $MOVE | Challenger |
| Stronghold boost | 300 $MOVE per activation (max 3) | Zone defender |
| Time extension | 500 $MOVE | Zone defender |
| Gear NFT mint | Varies by gear type (set per type) | Gear buyer |
| Great Burn (season end) | 10% of accumulated zone yield | Top-100 zone owners |

---

## Zone Tax

- **Rate**: 2% of every $MOVE minted via `mintMOVE` for a given hex
- **Destination**: Transferred to `ZoneNFT` contract, credited to `accumulatedYield[hexId]`
- **Withdrawal**: Zone owner calls `ZoneNFT.withdrawYield(hexId)` at any time
- **Loyalty Multiplier** on yield accumulation:
  - 0–30 days ownership: 1.0x
  - 30–90 days: 1.25x
  - 90–180 days: 1.5x
  - 180+ days: 1.75x

---

## Daily Cap

Prevents single-address farming:

```
dailyCap[epoch] = 200 $MOVE / 2^epoch
```

Resets every 24 hours (by block.timestamp). If a single `mintMOVE` call would exceed the
remaining cap, the excess is silently dropped (not reverted). If cap is fully exhausted,
the call reverts with "daily cap reached".

---

## Season Mechanics (90 Days)

1. **Day 1**: Keeper calls `startSeason()` — minting active
2. **Day 77** (14 days before end): Keeper calls `pauseMinting()` — no new $MOVE minted
3. **Day 90**: Keeper calls `endSeason()` then `greatBurn(topHexIds, yields, oracleSig)`
   - Top 100 zones by activity identified off-chain, oracle attests
   - Each zone owner must burn 10% of their accumulated `zoneYield`
   - Burned $MOVE goes to DAO treasury
   - `adjustEmissionRate()` called — auto-valve runs for new season baseline

---

## $ZONE Governance Token (Future)

> Not yet implemented. Notes for future Claude sessions:

- Fixed supply: 10,000,000 $ZONE
- Earned only by staking $MOVE in MoveVault
- Non-transferable for first 12 months (soulbound)
- Used for Tier-1 governance votes (Core tier in MovenDAO)
- Distribution: 1 $ZONE per 100 $MOVE staked per day (subject to DAO vote)
- Purpose: Separate governance from token speculation; long-term aligned holders only

---

## Supply Distribution (Target)

| Bucket | % | Vesting |
|---|---|---|
| Play-to-earn emissions | 60% | Released via GPS minting over years |
| Team & advisors | 15% | 12-month cliff, 36-month linear |
| Ecosystem / grants | 12% | DAO-controlled |
| Protocol-owned liquidity (POL) | 8% | Locked in MoveVault |
| Public sale | 5% | No lock |
