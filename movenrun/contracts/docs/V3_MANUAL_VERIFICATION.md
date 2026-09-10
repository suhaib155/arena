# MovenRun V3 — Manual Source Verification on Base Sepolia

Every deployed MovenRun V3 contract is verified by hand. This document is the procedure.

Nothing here changes contract source. If verification fails, the fix is to correct the
verification input, never to edit and recompile the source: the verified source must match
the deployed bytecode exactly.

---

## 1. Build settings that must match exactly

These are the settings the deployment was compiled with. Any mismatch produces a bytecode
mismatch on the explorer.

| Setting | Value |
| --- | --- |
| Solidity version | `0.8.24` |
| Optimizer | enabled |
| Optimizer runs | `200` |
| EVM version | `cancun` |
| License | MIT |
| Source layout | standard JSON, not flattened |

They come from `movenrun/contracts/hardhat.config.ts`. Read them from there rather than
retyping them, and confirm they match the `compiler` block of the deployment manifest at
`movenrun/contracts/deployments/v3/base-sepolia.json`.

Prefer reproducible standard JSON or build-info verification. Do not flatten contracts
unless the explorer leaves no alternative.

---

## 2. Prerequisites

1. Check out the exact commit the deployment recorded:

   ```bash
   git rev-parse HEAD                       # must equal manifest.gitCommit
   git status --short                       # must be empty
   ```

2. From `movenrun/contracts`, compile at that commit:

   ```bash
   npx hardhat compile
   ```

3. Confirm `BASESCAN_API_KEY` and `BASE_SEPOLIA_RPC_URL` are set in the local environment.
   Never commit them.

4. Confirm the manifest exists at `deployments/v3/base-sepolia.json`. Every command below
   reads its constructor arguments from that file, so the arguments used for verification
   are exactly the arguments that were used at deployment.

---

## 3. Verification order

Verify in this order. It follows the deployment dependency order, so each contract's
constructor arguments are already confirmed addresses by the time you reach the next one.

1. `MovenRunTimelock`
2. `MovenRunToken`
3. `MovenRunRewards`
4. `MovenRunSettlement`
5. `MovenRunDeed`
6. `MovenRunDeedClaims`
7. `MovenRunContests`
8. `MovenRunMarketplace`
9. `MovenRunRegistry`

The deployment script writes the same list with real addresses to
`deployments/v3/base-sepolia.verify.txt`. Use that file as the authoritative command list
for an actual deployment; the commands below are the same commands with the address left
as a placeholder.

---

## 4. Command-line verification, contract by contract

Run each command from `movenrun/contracts`. Substitute the address from the manifest, or
copy the ready-made command out of `deployments/v3/base-sepolia.verify.txt`.

Every `--constructor-args` module in `scripts/v3/verification/` reads the recorded
arguments from the manifest, so the arguments cannot drift from what was deployed.

### 4.1 MovenRunTimelock

Constructor: `(uint256 minDelay, address[] proposers, address[] executors, address admin)`

The `admin` argument is the zero address. That is deliberate: the timelock administers
itself and no deployer key remains a root admin.

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunTimelock.args.js \
  <MovenRunTimelock address>
```

### 4.2 MovenRunToken

Constructor: `(address admin, address bootstrapper)`

`admin` is the deployed `MovenRunTimelock`. `bootstrapper` is the **deployer address**.
The bootstrapper role is cleared onchain at the end of deployment, but the constructor
argument is still the deployer address and must be supplied as such for verification.

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunToken.args.js \
  <MovenRunToken address>
```

### 4.3 MovenRunRewards

Constructor: `(address moveToken, address bootstrapper)`

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunRewards.args.js \
  <MovenRunRewards address>
```

### 4.4 MovenRunSettlement

Constructor: `(address admin, address guardian, address moveToken, address rewards,
address settlementSigner, address reconciliationSigner, uint16 initialRulesVersion)`

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunSettlement.args.js \
  <MovenRunSettlement address>
```

### 4.5 MovenRunDeed

Constructor: `(address admin, address bootstrapper)`

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunDeed.args.js \
  <MovenRunDeed address>
```

### 4.6 MovenRunDeedClaims

Constructor: `(address admin, address guardian, address moveToken, address deed,
address eligibilitySigner, uint16 initialRulesVersion)`

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunDeedClaims.args.js \
  <MovenRunDeedClaims address>
```

### 4.7 MovenRunContests

Constructor: `(address admin, address guardian, address moveToken, address deed,
address contestSigner, uint16 initialHomeAdvantageBps, uint16 initialRulesVersion)`

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunContests.args.js \
  <MovenRunContests address>
```

### 4.8 MovenRunMarketplace

Constructor: `(address moveToken, address deed)`

This contract has no administrator, so there is no admin or guardian argument.

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunMarketplace.args.js \
  <MovenRunMarketplace address>
```

### 4.9 MovenRunRegistry

Constructor: `(address admin, address bootstrapper)`

```bash
npx hardhat verify --network baseSepolia \
  --constructor-args scripts/v3/verification/MovenRunRegistry.args.js \
  <MovenRunRegistry address>
```

---

## 5. After each verification

Open the Base Sepolia explorer page for the address and confirm all of the following before
moving to the next contract:

- source is shown as verified
- the contract name is the expected `MovenRun...` name
- compiler version is `0.8.24`, optimizer enabled, runs `200`
- EVM version is `cancun`
- decoded constructor arguments match the manifest entry for that contract
- proxy status is not reported; none of these contracts is a proxy
- the address matches the manifest exactly

---

## 6. Standard JSON fallback

If the command line fails, verify through the explorer's standard JSON input.

1. Locate the build-info file Hardhat produced for the deployment commit:

   ```bash
   ls artifacts/build-info/
   ```

   Each file contains an `input` object. That object is the standard JSON compiler input,
   already carrying the exact settings from section 1.

2. Extract just the compiler input:

   ```bash
   node -e "const fs=require('fs');const f=process.argv[1];const b=JSON.parse(fs.readFileSync(f,'utf8'));fs.writeFileSync('standard-input.json',JSON.stringify(b.input,null,2));console.log('wrote standard-input.json for solc '+b.solcLongVersion);" \
     artifacts/build-info/<build-info file>.json
   ```

3. On the explorer choose Verify and Publish, then Solidity (Standard JSON Input).

4. Supply:
   - compiler version `v0.8.24+commit.e11b9ed9`
   - the `standard-input.json` file from step 2
   - the ABI-encoded constructor arguments

5. To produce ABI-encoded constructor arguments for a contract:

   ```bash
   node -e "const {AbiCoder}=require('ethers');const a=require('./scripts/v3/verification/<Contract>.args.js');const art=require('./artifacts/src/v3/<Contract>.sol/<Contract>.json');const types=art.abi.find(e=>e.type==='constructor').inputs;console.log(AbiCoder.defaultAbiCoder().encode(types,a).slice(2));"
   ```

   Paste the output without the leading `0x`.

Never edit source and recompile to make verification pass.

---

## 7. Verification record

After all nine contracts are verified, record for each one:

- contract name
- address
- deployment transaction hash
- verification status
- explorer link
- verification timestamp
- exact Git SHA of the deployed source

The manifest carries a `verification` block with a `status`, `explorerUrl` and `verifiedAt`
field per contract for exactly this. Fill it in and keep it with the deployment record.

Never place a private key, RPC credential or API key in the record.

---

## 8. Final invariant check

Re-run the read-only checker after verification completes:

```bash
npx hardhat run scripts/v3/checkDeployment.ts --network baseSepolia
```

It performs no writes. It fails if the lifetime cap, the player movement allocation, the
fixed 2% toll, the 60% automatic-charge ceiling, the fixed contest timings and cooldowns,
the settlement and rewards wiring, the token configuration freeze, the timelock ownership,
the critical signer separation, the guardian permissions, the pause state, the initial deed
supply or the registry addresses do not match the manifest and the MovenRun rules.
