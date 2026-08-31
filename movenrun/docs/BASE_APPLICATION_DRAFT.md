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
