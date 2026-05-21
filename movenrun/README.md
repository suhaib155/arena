# MovenRun

MovenRun is a GPS-based move-to-earn territory protocol deployed on Base chain. Players run, walk, or cycle through real-world locations; their routes are verified on-chain via a Chainlink-compatible oracle. Moving through a hexagonal zone earns **$MOVE** tokens — the more you move, the more you earn. The top mover in any zone can mint it as a **Zone NFT** and collect a 2% tax on all $MOVE earned by anyone passing through their territory.

Zone ownership isn't permanent. Rival movers can declare 14-day territory battles with GPS-attested scores deciding the winner. Zone owners defend with stronghold boosts (up to 3×+60% multiplier) and time extensions, while long-term holders benefit from a loyalty multiplier of up to 1.75×. Seasons run for 90 days, ending in a Great Burn where the top 100 zones contribute 10% of accumulated yield to the DAO treasury, funding governance and protocol-owned liquidity. $MOVE earns through movement, is spent through competition, and governs through staking — creating a flywheel that rewards both physical activity and strategic territory play.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Mobile App (Expo / React Native)            │
│  Privy wallet  │  Mapbox H3 hex overlay  │  GPS tracking        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API
┌──────────────────────────▼──────────────────────────────────────┐
│                     Backend (Express + BullMQ)                  │
│                                                                 │
│  POST /gps/submit ──▶ BullMQ ──▶ GPS Worker                    │
│  (rate limited,          │      ├─ anomaly detection            │
│   dedup check,           │      ├─ haversine distance           │
│   ban check)             │      ├─ H3 hex coverage              │
│                          │      └─ oracle signing               │
│  POST /zones/mint ───────┼──▶ oracle sign ──▶ ZoneNFT.mintZone  │
│  POST /battles/declare ──┘──▶ oracle sign ──▶ ZoneChallenge     │
│                                                                 │
│  Keeper Worker (cron) ──▶ SeasonController.weeklyKeeperRun()    │
└──────────────────────────────────────────────────────────────────┘
                           │ on-chain (Base / Base Sepolia)
┌──────────────────────────▼──────────────────────────────────────┐
│                     Smart Contracts (Solidity 0.8.24)           │
│                                                                 │
│  MoveToken (ERC-20)      ──▶  ZoneNFT (ERC-721)                │
│    │  oracle-gated mint         │  tokenId = H3 hexId (uint64) │
│    │  halving schedule          │  2% zone tax                  │
│    │  daily cap                 │  dormancy / reclaim           │
│    │  auto-valve                └──▶ ZoneChallenge              │
│    │                                  14-day battles            │
│    └──▶ GearNFT (ERC-1155)            stronghold boosts         │
│            gear multipliers           loyalty multiplier        │
│                                                                 │
│  MoveVault (staking / POL)  ──▶  MovenDAO (3-tier governance)  │
│  SeasonController (Keeper)                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- **Node.js** 20+
- **Yarn** 4 (corepack enabled)
- **Docker** (for local Postgres + Redis)
- **Expo CLI** for mobile development
- A funded Base Sepolia wallet for testnet deployment

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/suhaib155/arena.git
cd arena/movenrun
yarn install
```

### 2. Configure environment variables

**Contracts:**
```bash
cp contracts/.env.example contracts/.env
# Fill in:
#   DEPLOYER_PRIVATE_KEY=0x...
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
#   BASESCAN_API_KEY=...
```

**Backend:**
```bash
cp backend/.env.example backend/.env
# Fill in:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/movenrun
#   REDIS_URL=redis://localhost:6379
#   ORACLE_PRIVATE_KEY=0x...   (generate a fresh key for signing)
#   BASE_RPC_URL=https://mainnet.base.org
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
#   MOVE_TOKEN_ADDRESS=0x...   (from deployment)
#   ZONE_NFT_ADDRESS=0x...
#   ZONE_CHALLENGE_ADDRESS=0x...
#   SEASON_CONTROLLER_ADDRESS=0x...
```

**Mobile:**
```bash
# mobile/.env or app.json extra:
#   EXPO_PUBLIC_API_URL=http://localhost:3000
#   EXPO_PUBLIC_PRIVY_APP_ID=...
```

### 3. Start local infrastructure

```bash
docker run -d -p 5432:5432 -e POSTGRES_DB=movenrun -e POSTGRES_PASSWORD=pass postgres:16
docker run -d -p 6379:6379 redis:7
```

### 4. Run database migrations

```bash
cd backend
yarn db:migrate
```

### 5. Start the backend

```bash
# Terminal 1: API server
cd backend && yarn dev

# Terminal 2: GPS verification worker
cd backend && yarn worker:gps

# Terminal 3: Keeper worker
cd backend && yarn worker:keeper
```

### 6. Run the mobile app

```bash
cd mobile
yarn start          # Expo dev server
yarn ios            # iOS simulator
yarn android        # Android emulator
```

---

## Running Tests

### Smart contracts

```bash
cd contracts
npx hardhat test
```

Tests cover MoveToken minting/burning, ZoneNFT minting/dormancy, and ZoneChallenge
full battle lifecycle including tiebreakers, NFT ownership mid-battle, and escrow mechanics.

### Backend

```bash
cd backend
yarn install        # installs vitest
yarn test
```

Unit tests for the GPS validation service (anomaly detection, haversine distance, loop routes, etc.).

---

## Deployment

### Local Hardhat node

```bash
cd contracts
npx hardhat node &
npx hardhat run scripts/deploy/local.ts --network localhost
```

### Base Sepolia (testnet)

```bash
cd contracts
npx hardhat run scripts/deploy/baseSepolia.ts --network baseSepolia
```

Post-deployment steps:
1. Copy contract addresses to `backend/.env`
2. Verify contracts: `npx hardhat run scripts/verify/verifyAll.ts --network baseSepolia`
3. Grant `SEASON_ROLE` on MoveToken to the SeasonController address
4. Call `MoveToken.setZoneNFT(zoneNFTAddress)`
5. Call `ZoneNFT.setChallengeContract(zoneChallengeAddress)`
6. Grant `KEEPER_ROLE` on SeasonController to the Keeper Worker wallet

### Base mainnet

```bash
cd contracts
npx hardhat run scripts/deploy/baseSepolia.ts --network base   # uses same script
```

---

## Contract Addresses (Base Sepolia Testnet)

| Contract | Address |
|---|---|
| MoveToken ($MOVE) | `0x — deploy and update` |
| ZoneNFT (ZONE) | `0x — deploy and update` |
| GearNFT | `0x — deploy and update` |
| ZoneChallenge | `0x — deploy and update` |
| SeasonController | `0x — deploy and update` |
| MoveVault | `0x — deploy and update` |
| MovenDAO | `0x — deploy and update` |

> Addresses are populated after each deployment. See `contracts/scripts/deploy/baseSepolia.ts` for the deployment script.

---

## Token Economy

**Earning**: Run or cycle through H3 resolution-8 hex cells (~0.74 km² each). Each verified kilometre earns `baseRate × gearMultiplier` $MOVE, subject to a per-address daily cap. The emission rate halves every ~6 months (2.6 million Base blocks). An auto-valve reduces `baseRate` by 10% any week the burn/mint ratio falls below 0.7.

**Spending (burn sinks)**:
- Zone NFT mint: `500 × √(weeklyMoverCount)` $MOVE
- Challenge declaration: 100 $MOVE (escrowed; returned on win, burned on loss)
- Stronghold boost: 300 $MOVE per activation (max 3 stacks, 24-hour duration each)
- Time extension: 500 $MOVE (once per challenge)
- Gear NFT mint: varies by gear type

**Owning**: Zone NFT owners earn 2% of all $MOVE minted by anyone running through their zone. Loyalty multipliers reward long-term holders (up to 1.75× at 365 days). Staking $MOVE in MoveVault earns yield set by DAO governance.

**Governance**: Any $MOVE holder may vote (1× weight). Staking ≥1000 $MOVE provides 1.5× voting weight. Proposals require 100 $MOVE to create, a 7-day vote, 2-day execution delay, and 10% quorum of total staked supply.

---

## Contributing

1. Fork the repo and create a feature branch from `main`
2. Follow the monorepo layout: shared types in `shared/`, contracts in `contracts/`, backend in `backend/`, mobile in `mobile/`
3. Add or update tests for any contract changes (`contracts/test/`)
4. Ensure `cd contracts && npx hardhat test` and `cd backend && yarn test` pass
5. Run `cd mobile && yarn lint` before submitting
6. Open a PR against `main` with a clear description of what changed and why
7. Smart contract changes require a security review and NatSpec documentation on all public functions

For security disclosures, please email security@movenrun.io rather than opening a public issue.
