# Deed pilot claim pipeline

What has to be true, in order, before a real participant can hold a real deed
derived from real movement. Written before any route is used, so that the gaps
are named rather than discovered halfway through.

Nothing in this document is deployed or running. Every "blocked" below is a
statement about the repository as it stands, verified against the code.

## The chain of dependencies

```
 real movement
   → verified route            (#73, unmerged)
   → traversed H3 cells        (#73, unmerged)
   → eligibility decision      NOT BUILT
   → EIP-712 authorization     DeedOracleService (this PR)
   → participant sends claim   needs a deployed registry + participant wallet
   → deed held                 —
```

## Step 1 — a verified route

**Status: blocked on #73.**

`POST /gps/submit` on `main` is authenticated by wallet signature
(`requireWalletAuth`, and the handler additionally requires the recovered signer
to equal the submitted `walletAddress`). The mobile app has no wallet — embedded
wallet provisioning is recorded as Blocked in ADR-0011 — so the current app
cannot reach that endpoint at all. This is the same blocker that stopped the
server-verified movement batch from using it.

`POST /movement/verify` (#73) is the walletless path: it authenticates with the
mobile identity bearer token, derives the user from that token, computes
distance and traversed hexes server-side, and is idempotent per
`(user, clientSessionId)`. It is open and unmerged.

**Do not weaken `/gps/submit` to work around this.** If pilot ingestion needs an
operator path before #73 lands, it must be a separate, non-public, strongly
authenticated internal route — not a relaxation of an existing one.

## Step 2 — traversed cells

**Status: blocked on #73.**

`hex_activities` exists in the schema on `main` and **has no writer** — no code
path inserts into it. There is therefore no server-side record of which cells
any route passed through.

#73's `movement_verifications.traversedHexIds` is the only place traversed cells
are computed and persisted, and it is unmerged. Note also that the mobile client
deliberately persists a traversed-cell *count* rather than the ids (#76), so the
device is not a source for this either.

## Step 3 — eligibility

**Status: not built.**

"This person moved through this cell enough to deserve its deed" is a product
decision that does not exist anywhere in the code. Verified traversal is
evidence of movement; it is not by itself an eligibility rule, and #76 is
explicit that verified traversal is not ownership.

For a pilot this may be decided by a human operator reading verified results.
That is acceptable **if it is recorded as a human decision** rather than
presented as an automated rule the system enforces.

## Step 4 — the authorization

**Status: available.**

`DeedOracleService` signs the EIP-712 `DeedClaim` struct the registry verifies.

This did not previously exist, and the gap was not obvious: the backend already
has an `OracleService` with a `signZoneMint` method, but it signs
`personal_sign` over `solidityPackedKeccak256` for the V1 `ZoneNFT`. A signature
from it will never verify against `DeedRegistry`, which uses
`_hashTypedDataV4`. The two schemes are not interchangeable and now live in
separate classes for that reason.

Each authorization binds claimant, cell, a single-use claim id, a deadline
(15 minutes), the chain id, and the registry address. It cannot be redirected,
reused, or replayed onto another deployment.

## Step 5 — the claim transaction

**Status: blocked on deployment, and on participant wallets.**

The registry is not deployed anywhere. `totalSupply()` is 0 on every chain
because no registry exists on any chain.

Beyond that, **the participant must send the claim transaction themselves**:
`claim()` mints to `msg.sender`, and the claimant is inside the signed struct,
so nobody can claim on someone else's behalf. That is the correct security
property and it has a real recruitment consequence — each pilot participant
needs a Base wallet holding a small amount of ETH for gas.

There is no sponsored gas and no embedded wallet. Both are explicitly out of
scope before the deadline.

## What would make the holder count dishonest

Recorded here because the pressure to do it will be highest at the end:

- minting every deed to a founder-controlled address and calling them holders,
- using internal test wallets and counting them as participants,
- fabricating or replaying routes to manufacture eligibility,
- counting addresses that were funded and controlled by the project.

A holder is a person who controls their own key, moved through the cell
themselves, and sent their own claim transaction. The reportable number is the
count of those, and if it is two, it is two.

## Current honest position

| Claim | True today |
|---|---|
| Registry code exists and is tested | Yes |
| Registry deployed to Base Sepolia | **No** |
| Registry deployed to Base mainnet | **No** |
| Any deed minted, anywhere | **No** |
| Metadata endpoint exists | Yes (undeployed configuration) |
| Oracle can authorize a claim | Yes (code); no key configured |
| Verified-movement backend on `main` | **No** — #73 is unmerged |
| Traversed cells recorded server-side | **No** — no writer for `hex_activities` |
| Pilot participants recruited | **No** |
