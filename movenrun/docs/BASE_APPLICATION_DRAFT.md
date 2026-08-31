# Base Batches application — draft answers

Prepared offline because the form does not save drafts. Fields that depend on
evidence that does not exist yet are left explicitly blank rather than filled
with an intention. **Nothing here may be submitted ahead of the code.**

## Positioning

**One line.** MovenRun is building a location asset registry backed by verified
physical movement, with a future verified-footfall payments layer for local
businesses.

**Category.** Tokenization.

**Not** move-to-earn, not a fitness rewards app, not a STEPN competitor, and not
a token launch. Those framings are wrong about the product and would invite
questions the code cannot answer.

## The insight

> The map rewards the route you repeat, not simply the distance you cover.

This survives the code audit: decay and defence mechanics already make repeated
presence meaningful, and that is what distinguishes a location registry from a
distance tracker.

**Do not** lead with enclosure capture. It is not built.

## What exists

- An H3 cell registry contract: one permanent, transferable deed per cell,
  claimable only against an EIP-712 oracle authorization, with no token
  dependency and no path for any role to mint, seize or destroy a deed.
- Server-side movement verification that computes distance and traversed cells
  from GPS observations, with per-session idempotency.
- A mobile app that records foreground movement sessions and submits completed
  sessions for verification.
- Deterministic ERC-721 metadata on a MovenRun-controlled domain.

## What does not exist, and must not be implied

- No liquid reward economy. No token has been deployed to mainnet.
- No footfall payments. The verified-footfall layer is a direction, not a
  feature.
- No deed income, revenue share, or yield of any kind.
- No PvP, no live clubs, no enclosure capture.
- No embedded wallets and no sponsored gas.

## Evidence layer 1 — safe to state today

Each of these is proven and can be pointed at:

- A tested DeedRegistry implementation exists in an open pull request: one
  permanent, transferable ERC-721 deed per H3 resolution-8 cell.
- Claims are authorized by EIP-712 oracle signatures bound to claimant, cell,
  a single-use claim id, a deadline, the chain and the deployment.
- No MOVE token, balance, allowance or burn is required to claim.
- No role can mint, seize, or destroy a deed; there is no reclaim path.
- A deterministic ERC-721 metadata endpoint exists in an open pull request.
- A correct EIP-712 backend signer and an operator claim-issuance bridge exist
  in an open pull request.
- The full path — verified movement record → eligible traversed cell →
  EIP-712 authorization → minted, transferable deed — has been proven
  end-to-end on a local chain.

**Open PR code is not deployed product.** Say "implemented and tested, in
review", never "live".

## Evidence layer 2 — safe only once Base Sepolia is complete

Sepolia is a **test network**. Completing it proves the path works; it proves
nothing about mainnet, and the wording has to keep those apart. Use these only
after the Sepolia evidence table is filled in and reviewed:

- MovenRun has built and tested a standalone DeedRegistry.
- It uses EIP-712 oracle-authorized claims, with admin and oracle held by
  separate keys.
- One H3 resolution-8 cell can map to only one deed, enforced by the contract.
- A claim requires verified-movement eligibility; the cell must appear in the
  server-derived traversal for that session.
- No MOVE token is required to claim in the new registry design.
- The full deed path has been exercised **on Base Sepolia**: deployment, a real
  participant claim, replay rejection, duplicate-cell rejection, and transfer.
- **Mainnet deployment remains pending.**

Say "exercised on Base Sepolia", never "live". A reviewer who checks Basescan
and finds a testnet address behind the word "live" has learned something worse
about the project than a pending mainnet would have told them.

## Evidence layer 3 — safe only after mainnet deployment

One sentence, and only once it is on chain and verified:

> The MovenRun DeedRegistry is deployed on Base mainnet at `<address>`.

Do **not** imply the other eight contracts moved. They remain on Base Sepolia
unless they are actually redeployed, and conflating the two would turn one true
statement into a false one about the whole system.

Supply and holder counts must be the exact on-chain numbers. Not rounded, not
projected, not inclusive of wallets the project controls.

## Evidence layer 4 — blocked until it exists

Leave these as placeholders. Do not pre-write a number and try to make reality
match it.

- Base Sepolia DeedRegistry address
- Base mainnet DeedRegistry address
- Basescan verification URL and status
- `totalSupply()`
- unique holder count
- pilot claim transaction hashes
- transfer transaction hash

## Fields to leave blank until confirmed

| Field | Fill in only when |
|---|---|
| Mainnet contract address | The registry is deployed **and** source-verified |
| Holder count | Real participants hold deeds they claimed themselves |
| Traction / users | There are numbers that are not internal accounts |
| Demo URL | The demo shows deployed behaviour, not a local build |
| Transaction volume | There are transactions that are not ours |

## Rule

Never write a claim first and try to make the code match it later. The
application must describe the deployed state at the moment of submission. If a
smaller true story is all that is available by the deadline, submit the smaller
true story.
