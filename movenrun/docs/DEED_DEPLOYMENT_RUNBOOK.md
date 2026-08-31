# DeedRegistry deployment runbook

Human-executable steps for deploying the registry, in an environment that has
Base RPC access. Nothing here has been run: at the time of writing the registry
is not deployed on any chain and no deed has ever been minted.

**Never paste a private key into a chat, an issue, a PR, a log, or a
screenshot.** Only public addresses appear in this document, and only public
addresses should ever be reported back.

---

## 0. Environment

Configured locally, outside Git, in the deployment environment only.

| Variable | Purpose | Secret |
|---|---|---|
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia endpoint (defaults to `https://sepolia.base.org`) | no |
| `BASE_RPC_URL` | Base mainnet endpoint (defaults to `https://mainnet.base.org`) | no |
| `DEPLOYER_PRIVATE_KEY` | Pays for deployment. Read by `hardhat.config.ts` | **yes** |
| `DEED_TARGET` | `baseSepolia` or `base`. The intended chain, stated explicitly | no |
| `DEED_ADMIN` | Registry administrator. A Safe on mainnet | no |
| `DEED_ORACLE_SIGNER` | Public address of the claim-signing key | no |
| `DEED_BASE_URI` | Metadata base, e.g. `https://<domain>/api/deed/` | no |
| `BASESCAN_API_KEY` | Source verification | **yes** |
| `ORACLE_PRIVATE_KEY` | Signs claims. Backend only, never on the deploy host if avoidable | **yes** |
| `DEED_REGISTRY_ADDRESS` | Set **after** deployment, for the signer and metadata | no |

The deployment script reads no key itself. `DEPLOYER_PRIVATE_KEY` reaches
Hardhat through its own config; the script never touches, prints, or records it.

## 1. Preflight — know these before broadcasting

- deployer public address, and its balance on the target chain
- admin address (on mainnet: the Safe, which **must have contract code**)
- oracle signer public address
- base URI
- expected chain id — Sepolia `84532`, mainnet `8453`
- the exact commit being deployed

The script refuses to broadcast if: the live chain id does not match
`DEED_TARGET`; admin equals oracle; either is the zero address; the deployer is
the oracle; or — on mainnet only — the base URI is unset, the admin is the
deploying EOA, or the admin address has no code.

The chain check reads the id **from the node**, not from the local config,
because the config is the thing most likely to be wrong.

---

## 2. Base Sepolia

```bash
git checkout <exact reviewed commit>
cd movenrun
yarn install --immutable
yarn workspace @movenrun/contracts compile
yarn workspace @movenrun/contracts test          # expect 93 passing

export DEED_TARGET=baseSepolia
export DEED_ADMIN=0x…            # public
export DEED_ORACLE_SIGNER=0x…    # public
export DEED_BASE_URI=https://<domain>/api/deed/

cd contracts
npx hardhat run scripts/deploy/deedRegistry.ts --network baseSepolia
```

The script prints the address and transaction hash, runs six post-deploy role
assertions, aborts if any fails, and writes
`deployments/deedRegistry.baseSepolia.json` — refusing to overwrite an existing
record.

**Record:** contract address, deployment tx hash, chain id, block number.

### Verify the source

```bash
npx hardhat verify --network baseSepolia <address> <admin> <oracle> "<baseURI>"
```

If verification is blocked (no API key, indexer lag), say so explicitly and
record the reason. An unverified contract is a documented limitation, not a
silent one.

### One real pilot claim

1. Configure the backend with `DEED_REGISTRY_ADDRESS` and `CHAIN_ID=84532`.
2. A participant supplies **their own** Base Sepolia address.
3. Issue the authorization:
   ```bash
   yarn tsx src/scripts/issueDeedClaim.ts \
     --user <userId> --session <clientSessionId> \
     --cell <h3Index> --claimant 0x…
   ```
4. Hand the participant the printed bundle. **The participant submits the
   claim from their own wallet** — `claim()` mints to `msg.sender` and the
   claimant is inside the signed struct, so nobody can claim on their behalf.

### Evidence checklist

| Check | Expected |
|---|---|
| Contract exists at the recorded address | yes |
| Source verified on Basescan | yes, or a documented blocker |
| `hasRole(DEFAULT_ADMIN_ROLE, admin)` | true |
| `hasRole(ORACLE_SIGNER_ROLE, oracle)` | true |
| `hasRole(ORACLE_SIGNER_ROLE, admin)` | **false** |
| `hasRole(DEFAULT_ADMIN_ROLE, oracle)` | **false** |
| `totalSupply()` after one claim | 1 |
| `ownerOf(cell)` | the participant |
| Replay of the same authorization | reverts |
| Second claimant, same cell | reverts |
| Transfer to another wallet | succeeds |
| `totalSupply()` after transfer | still 1 |
| `tokenURI(tokenId)` | resolves and returns metadata |

**Sepolia results require a human review gate. Do not proceed automatically to
mainnet.**

---

## 3. Base mainnet — do not execute until every prerequisite is met

Hard prerequisites, none of which may be waived for the deadline:

- [ ] Sepolia deployment succeeded
- [ ] Sepolia claim by a real participant succeeded
- [ ] Sepolia replay rejection observed
- [ ] Sepolia duplicate-cell rejection observed
- [ ] Sepolia transfer observed
- [ ] Source verified, or the blocker documented
- [ ] Constructor arguments reviewed by a human
- [ ] Admin and oracle are distinct
- [ ] Admin Safe **deployed on Base mainnet** and its address confirmed
- [ ] Deployer funded on mainnet
- [ ] Oracle key configured securely, and not on the deploy host
- [ ] Metadata domain live and serving `tokenURI` correctly
- [ ] The exact reviewed commit frozen

Then the same sequence with `DEED_TARGET=base`, `--network base`, chain id
`8453`, and the mainnet-only preflight rules in force.

Deploy **only** DeedRegistry. No MOVE, no governance, no staking, no seasons,
no gear, no battles.

---

## 4. After deployment

Set `DEED_REGISTRY_NETWORK` and `DEED_REGISTRY_ADDRESS` so the metadata
endpoint's Network and Registry attributes appear. Until then they are
deliberately absent, because naming a chain the contract is not on would be a
false claim nobody would notice.

Then, and only then, make the **smallest** factual website correction: say that
*this specific registry* is live on the chain it is actually on. Do not imply
the other eight contracts moved, do not add economic claims, and do not state a
holder count beyond what the chain shows.
