# External environment readiness checklist

For whoever runs the real deployment, in an environment that this one is not.

> **Never paste private keys into Claude, ChatGPT, GitHub, issues, pull
> requests, screenshots, or any document.** Keys belong in the deployment
> environment's own configuration and nowhere else. Only public addresses,
> contract addresses, transaction hashes, chain ids and verification status are
> ever reported back.

## Network

- [ ] Base Sepolia RPC reachable from the deployment machine
      (`https://sepolia.base.org` or your own endpoint)
- [ ] Base mainnet RPC reachable (`https://mainnet.base.org` or your own)

Verify with a plain chain-id call before anything else:

```bash
curl -s -X POST "$BASE_SEPOLIA_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# expect {"result":"0x14a34"}  → 84532
```

The current environment fails this step: its egress policy denies both hosts.
That is the blocker, and it cannot be worked around from inside.

## Keys — configured locally, never shared

- [ ] `DEPLOYER_PRIVATE_KEY` configured, funded on the target network
- [ ] `ORACLE_PRIVATE_KEY` configured, **different key** from the deployer
- [ ] `BASESCAN_API_KEY` configured (optional; only affects source verification)

## Public addresses — these are safe to report

- [ ] Deployer address: `______`
- [ ] Oracle signer address: `______`
- [ ] Admin address: `______`
- [ ] Confirmed **admin ≠ oracle**
- [ ] Confirmed **deployer ≠ oracle**
- [ ] For mainnet: admin is a Safe and **has contract code** on Base mainnet
      (the deploy script refuses an EOA admin on mainnet)

The eight older contracts on Base Sepolia use one EOA as both admin and oracle.
Do not repeat that.

## Metadata

- [ ] `DEED_BASE_URI` decided, e.g. `https://<domain>/api/deed/`
- [ ] That URL is reachable and returns ERC-721 JSON with `name`,
      `description`, `image`, `attributes`
- [ ] It contains no price, yield, or return language

## Backend runtime — required for a real pilot

- [ ] `DATABASE_URL` configured, PostgreSQL reachable
- [ ] Migrations applied through `0003_movement_verifications`
- [ ] `movement_verifications` exists with the
      `(user_id, client_session_id)` unique constraint
- [ ] The backend is running the reviewed movement-verification code
- [ ] A participant can authenticate and submit a session through the normal
      bearer-authenticated path

**Without this there is no honest eligibility source.** Do not substitute
`hex_activities` (nothing writes it), local mobile territory state, or an
operator assertion that a route was verified.

## Ready to report back

When all of the above is true, report only:

1. deployer public address
2. admin public address
3. oracle public address
4. confirmation the corresponding keys are configured **there**
5. confirmation Base RPC is reachable
6. confirmation the backend is running the reviewed verification code

No secret values, in any form, ever.
