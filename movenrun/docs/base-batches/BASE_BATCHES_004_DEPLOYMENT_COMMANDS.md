# Deployment command pack

Exact commands, in order. **None of these have been run** — this environment
has no Base RPC egress and no keys.

Secrets come from the environment. No command here contains an inline key, and
no example shows one. If you find yourself about to paste a key onto a command
line, stop: it lands in shell history.

---

## Base Sepolia

### 1. Freeze the commit

```bash
git fetch origin
git checkout <exact reviewed commit>       # #80 head for contracts
git status --short                          # must be empty
```

### 2. Install and build

```bash
cd movenrun
yarn install --immutable
yarn workspace @movenrun/contracts compile
```

Record the compiler version, optimizer setting and runtime bytecode size:

```bash
node -e "const a=require('./contracts/artifacts/src/registry/DeedRegistry.sol/DeedRegistry.json');
console.log('runtime bytes:',(a.deployedBytecode.length-2)/2)"
```

Expected ≈ 9,290 bytes with solc 0.8.24, optimizer enabled, 200 runs,
evmVersion cancun. **Report the actual value, not this one.**

### 3. Tests — stop if anything fails

```bash
yarn workspace @movenrun/contracts test    # expect 93 passing
yarn workspace @movenrun/backend test      # expect 312 with #73 + #82 + #83
```

### 4. Configure — public values only

```bash
export DEED_TARGET=baseSepolia
export DEED_ADMIN=0x…              # public
export DEED_ORACLE_SIGNER=0x…      # public
export DEED_BASE_URI=https://<domain>/api/deed/
# DEPLOYER_PRIVATE_KEY and BASESCAN_API_KEY come from the environment's own
# secret configuration, not from this shell.
```

### 5. Confirm the chain before spending anything

```bash
curl -s -X POST "${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# 0x14a34 = 84532. Anything else: STOP.
```

### 6. Deploy

```bash
cd contracts
npx hardhat run scripts/deploy/deedRegistry.ts --network baseSepolia
```

The script re-checks the chain id against the node, refuses admin == oracle and
deployer == oracle, runs six post-deploy role assertions, aborts if any fails,
and refuses to overwrite an existing deployment record.

### 7. Verify the source

```bash
npx hardhat verify --network baseSepolia "$ADDRESS" \
  "$DEED_ADMIN" "$DEED_ORACLE_SIGNER" "$DEED_BASE_URI"
```

If it fails, classify why — API key, propagation delay, compiler metadata
mismatch, or a source issue — and record that. Do not claim success.

### 8. Read the contract back

```bash
cast call "$ADDRESS" "totalSupply()(uint256)"       --rpc-url "$RPC"   # 0
cast call "$ADDRESS" "baseURI()(string)"            --rpc-url "$RPC"
cast call "$ADDRESS" "H3_RESOLUTION()(uint8)"       --rpc-url "$RPC"   # 8
cast call "$ADDRESS" "hasRole(bytes32,address)(bool)" \
  $(cast call "$ADDRESS" "DEFAULT_ADMIN_ROLE()(bytes32)" --rpc-url "$RPC") \
  "$DEED_ADMIN" --rpc-url "$RPC"                                       # true
cast call "$ADDRESS" "hasRole(bytes32,address)(bool)" \
  $(cast call "$ADDRESS" "ORACLE_SIGNER_ROLE()(bytes32)" --rpc-url "$RPC") \
  "$DEED_ADMIN" --rpc-url "$RPC"                                       # false
```

Read the values back rather than trusting the deploy log. A deployment that
succeeded with the wrong roles looks fine until it matters.

### 9. Generate one real claim authorization

Requires the backend running the reviewed verification code, with a genuine
verified session.

```bash
export DEED_REGISTRY_ADDRESS="$ADDRESS"
cd ../backend
yarn tsx src/scripts/issueDeedClaim.ts \
  --user <userId> --session <clientSessionId> \
  --cell <h3Index> --claimant 0x…
```

Prints the public bundle. Hand it to the participant.

### 10. The participant claims — from their own wallet

`claim()` mints to `msg.sender` and the claimant is inside the signed struct.
Nobody can claim on their behalf, and nobody should try.

```bash
cast send "$ADDRESS" \
  "claim(uint64,bytes32,uint256,bytes)" \
  "$CELL_ID" "$CLAIM_ID" "$DEADLINE" "$SIGNATURE" \
  --rpc-url "$RPC" --private-key <the participant's own, on their machine>
```

### 11. Confirm

```bash
cast call "$ADDRESS" "totalSupply()(uint256)"     --rpc-url "$RPC"   # 1
cast call "$ADDRESS" "ownerOf(uint256)(address)" "$CELL_ID" --rpc-url "$RPC"
cast call "$ADDRESS" "tokenURI(uint256)(string)"  "$CELL_ID" --rpc-url "$RPC"
```

---

## Base mainnet — after Sepolia passes and a human approves

Identical, with `DEED_TARGET=base`, `--network base`, and chain id `8453`
(`0x2105`). The script additionally requires, on mainnet only: a set base URI,
an admin that is not the deploying EOA, and an admin address **with contract
code**.

Deploy only DeedRegistry. No MOVE, no governance, no staking, no seasons, no
gear, no battles.

**Do not run any of this without explicit approval for that specific
broadcast.** A general instruction to proceed is not approval to spend mainnet
funds.
