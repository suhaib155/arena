# Read-only Base Sepolia contract layer

Infrastructure that lets backend/shared code **read** the already-deployed
MovenRun contracts on Base Sepolia. It is read-only **by construction**:

- no private key, no signer, no wallet
- no transaction/write methods
- no minting, no claiming, no Liquid MOVE, no payments

This is the first safe bridge from the local beta toward the on-chain territory
economy. It does **not** wire anything into the mobile app.

## What's here

| File | Purpose |
| --- | --- |
| `networks.ts` | Network config — Base Sepolia (`chainId 84532`), RPC env var, public fallback. |
| `deployments.ts` | Loads & validates `contracts/deployments/baseSepolia.json`; cross-checks the shared registry; typed errors. |
| `abis.ts` | Minimal **view-only** ABI fragments verified against `contracts/src/*.sol`. |
| `readClient.ts` | `ethers` `JsonRpcProvider` read client + read helpers. |
| `errors.ts` | Typed config errors. |
| `*.test.ts` | `node:test` unit tests (no network, no extra deps). |

## Configuring RPC locally

The client reads its RPC URL from the `BASE_SEPOLIA_RPC_URL` environment
variable. If unset, it falls back to the public endpoint
`https://sepolia.base.org` (rate-limited, no key) so reads work out of the box;
set the env var to use your own provider.

```bash
# .env is git-ignored — never commit it, never commit an RPC key
export BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"   # or your provider URL
```

No API keys or secrets are required or committed.

## Usage

```ts
import { createBaseSepoliaReadClient } from "./blockchain/index.js";

const client = createBaseSepoliaReadClient();         // RPC from env/fallback

client.getDeploymentSummary();                         // offline: addresses, chainId
await client.getMoveTokenInfo();                       // { name, symbol, decimals }
await client.getZoneNftInfo();                         // { name, symbol }
await client.getGpsOracleInfo();                       // { oracleOperator, moveToken }
await client.getSeasonInfo();                          // season state
await client.getCodeStatus("ZoneNFT");                 // bytecode present?
const zone = client.getReadOnlyContract("ZoneNFT");    // ethers.Contract (provider runner)
await zone.ownerOf(tokenId);
```

## Tests

```bash
yarn workspace @movenrun/backend test
```

Uses Node's built-in test runner via the existing `tsx` dev dependency — **no
new dependency added**. Tests do not require network access; the read-helper
calls that need live RPC are covered structurally (offline) rather than by
hitting the chain.

## How future features should consume this

- **Backend:** import from `./blockchain/index.js` to read on-chain state
  (e.g. `ZoneNFT` ownership) alongside the DB. Still read-only.
- **Next PR — `feat(mobile): add read-only Base Sepolia contract status
  preview`:** a mobile screen that surfaces deployment/read status (addresses,
  "contracts live", season info) as a **preview only**. No wallet, no signing,
  no writes.

## What remains before any testnet *write* interaction

Real wallet/signing/mint/claim is **out of scope** and gated by the roadmap:
no liquid reward economy ships before reliable GPS verification, Phase 1 tile/
city density, and genuine sponsor/land demand (`docs/ROADMAP.md`). A future
write path would need a wallet/signer, user-key custody decisions, and a fresh
security review — none of which exist here.
