# MovenRun — Claude Context

## What It Is
GPS-based move-to-earn territory protocol on Base chain. Users run/walk/cycle through
real-world locations. GPS routes verified on-chain via Chainlink oracle. Moving through
a hexagonal zone earns $MOVE tokens. Top mover in a zone can mint it as a Zone NFT.
Zone NFT owners earn 2% of all $MOVE earned by anyone moving through their zone.
Zones can be challenged in 14-day battles.

## Monorepo Layout
- `shared/` — TypeScript types and constants used by all packages
- `contracts/` — Hardhat + Solidity smart contracts (deploy to Base / Base Sepolia)
- `backend/` — Express API + BullMQ workers + Drizzle ORM (Postgres + Redis)
- `mobile/` — Expo React Native app (Privy wallet, Mapbox, H3 hex overlay)

## Key Technical Decisions
See `docs/ARCHITECTURE.md` for contract interaction diagram and oracle flow.
See `docs/TOKENOMICS.md` for emission schedule and burn sink details.

## Contracts (Base chain)
- **MoveToken** — ERC-20 $MOVE, 1B supply, oracle-gated minting, halving every HALVING_INTERVAL blocks
- **ZoneNFT** — ERC-721, tokenId = H3 hex ID (uint64), 2% zone tax, dormancy system
- **GearNFT** — ERC-1155, gear with stat multipliers
- **ZoneChallenge** — 14-day battle system, stronghold boost, time extension
- **SeasonController** — 90-day seasons, Great Burn, Chainlink Keeper integration
- **MoveVault** — staking, POL, treasury
- **MovenDAO** — 3-tier governance voting

## H3 Resolution
Resolution 8 hexagons (~0.74 km² each). See `shared/src/constants/h3.ts`.

## Never Ask Me About
- Whether to use Privy for wallet auth — it's decided
- Whether to use H3 for hex grid — it's decided (resolution 8)
- Whether to use Base chain — it's decided
- Package manager — yarn workspaces
