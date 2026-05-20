# MovenRun

GPS-based move-to-earn territory protocol on Base chain. Users capture real-world
hexagonal zones by physically moving through them (verified via GPS oracle). Zones
are minted as NFTs. Users earn $MOVE tokens. Territory ownership = passive yield.

## Stack
- Smart Contracts: Solidity ^0.8.24 — Hardhat + OpenZeppelin + Chainlink
- Backend: Node.js (ESM), Express, PostgreSQL (pg), Redis, Drizzle ORM
- Mobile: React Native (Expo SDK 51), TypeScript strict
- Geo Grid: H3-js (Uber hex grid, Resolution 8)
- Oracle: Chainlink Functions + Automation (Keepers)
- Chain: Base Mainnet / Base Sepolia testnet
- Auth: Privy (wallet + social login)
- Storage: IPFS via Pinata (NFT metadata)

## Monorepo Structure
```
movenrun/
├── contracts/          Solidity contracts (Hardhat project)
│   ├── src/            MoveToken, ZoneNFT, GearNFT, ZoneChallenge,
│   │                   SeasonController, MoveVault, MovenDAO
│   ├── test/           Hardhat tests (ethers v6)
│   ├── scripts/        deploy/, verify/, seed/
│   └── hardhat.config.ts
├── backend/            Node.js API server
│   ├── src/
│   │   ├── routes/     REST endpoints
│   │   ├── services/   gps, oracle, hex, token, nft
│   │   ├── workers/    BullMQ queue processors
│   │   └── db/         Drizzle schema + migrations
│   └── package.json
├── mobile/             Expo React Native app
│   ├── src/
│   │   ├── screens/    Map, Zone, Battle, Earn, Profile
│   │   ├── components/ ZoneHex, MoveTracker, BattleCard
│   │   ├── hooks/      useGPS, useZone, useToken
│   │   └── store/      Zustand global state
│   └── app.json
└── shared/             Types + constants shared across all packages
```

## Commands
- `cd contracts && npx hardhat test` — run contract tests
- `cd contracts && npx hardhat run scripts/deploy/local.ts --network localhost` — local deploy
- `cd backend && npm run dev` — start API server (port 4000)
- `cd backend && npm run db:migrate` — run DB migrations
- `cd mobile && npx expo start` — start Expo dev server

## Critical Rules
- NEVER commit .env files or private keys
- All $MOVE minting MUST require a valid Chainlink oracle signature
- Use ethers v6 syntax (not v5) in all scripts and tests
- All contract functions that move funds must have reentrancy guards
- GPS routes must be validated server-side before oracle attestation
- Use ES modules (import/export) throughout — no CommonJS require()
- TypeScript strict mode everywhere — no `any` types
- See @docs/ARCHITECTURE.md for deep technical decisions
- See @docs/TOKENOMICS.md for $MOVE emission rules
