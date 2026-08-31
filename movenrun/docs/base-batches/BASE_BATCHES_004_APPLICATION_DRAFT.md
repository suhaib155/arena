# Base Batches 004 — application master draft

Every answer, in one place, because the form does not save drafts. **Do not
submit from this file — paste, re-read against the safe-claims matrix, then
submit.**

Placeholders in `[BRACKETS]` are unresolved. Do not fill them with an
intention. Items marked **[FOUNDER]** need a human answer and are listed in
`BASE_BATCHES_004_FOUNDER_INPUTS_REQUIRED.md`.

---

## Company

**Project name.** MovenRun

**What are you building?**

> MovenRun is building a location asset registry backed by verified physical
> movement, with a future verified-footfall payments layer for local
> businesses.

People move through the real world. A server verifies the movement actually
happened, and the H3 map cells a verified route passed through become
claimable: one cell, one permanent transferable deed, issued only against an
oracle authorization tied to that person and that cell.

**Website.** [FOUNDER — production URL]

**X.** [FOUNDER]

**Category.** Tokenization

---

## Team

**[FOUNDER]** — every field in this section. Not inferred, not guessed.

- Founder full name: [FOUNDER]
- Role: [FOUNDER]
- Location: [FOUNDER]
- Team size: [FOUNDER]
- Legal entity: [FOUNDER — exists? jurisdiction, name, date; or the intended plan]
- Prior experience: [FOUNDER]
- Hardest technical or business problem you have solved: [FOUNDER]
- Email / Telegram / X / LinkedIn: [FOUNDER]

---

## Product and traction

### The problem

Location is the most valuable data most people generate and the one they get
least from. It is collected constantly, sold onward, and never held by the
person who produced it. Meanwhile a business that wants to know whether real
people actually walk past its door has no trustworthy source for that — footfall
data is inferred, modelled, or bought from the same intermediaries.

Both sides of that are a verification problem before they are a product
problem. Nobody can build an honest market on movement data until movement can
be verified without simply trusting the device that reported it.

### The insight

> **The map rewards the route you repeat, not simply the distance you cover.**

Distance is easy to fake and tells you nothing about a place. Repeated presence
in a specific cell is expensive to fake and is exactly what makes a location
meaningful — to the person who keeps going there, and eventually to a business
that wants to reach the people who do.

This is already how the product behaves: holdings decay without return visits,
so ground is kept by going back rather than by having once passed through.
Enclosure capture is deliberately **not** the pitch, because it is not built.

### Why this team

[FOUNDER]

### Time spent

[FOUNDER]

### Product status

An Android app records foreground movement sessions. A backend verifies a
completed session server-side — it computes distance, route plausibility and
the traversed H3 cells itself, and never trusts client-supplied values.

The registry layer is implemented, tested and **in review**, not deployed:

- **DeedRegistry** — one permanent transferable ERC-721 deed per H3
  resolution-8 cell. Uniqueness enforced on-chain. No burn, no reclaim, no
  admin seizure, no MOVE dependency. 9,290 bytes of runtime bytecode, 93
  contract tests.
- **EIP-712 claim authorization** — bound to claimant, cell, a single-use claim
  id, a deadline, the chain and the deployment. Admin and oracle are separate
  keys and the constructor refuses a deployment where they match.
- **Metadata endpoint** — deterministic ERC-721 JSON, no price or yield
  language anywhere, enforced by tests.
- **Claim bridge** — an operator tool that converts one verified movement
  record into one public claim authorization for one traversed cell.

The complete path — verified movement record → eligible traversed cell →
EIP-712 authorization → minted transferable deed — has been proven end-to-end
**on a local chain**, 22 of 22 checks, including on-chain rejection of replay,
duplicate-cell minting, expired authorizations and wrong signatures.

### What is in review vs deployed

Nothing in the registry layer is deployed to any public chain. Eight older
contracts from an earlier design exist on Base Sepolia only; they are not the
registry and are not part of this claim.

### Traction

[TRACTION] — currently none that is honest to report. `totalSupply()` is 0
because no registry is deployed. There are no holders.

### Demo

[DEMO_URL]

### Contracts

- Base Sepolia DeedRegistry: `[BASE_SEPOLIA_DEED_REGISTRY_ADDRESS]`
- Base mainnet DeedRegistry: `[BASE_MAINNET_DEED_REGISTRY_ADDRESS]`
- Basescan verification: `[BASESCAN_VERIFICATION_URL]`
- `totalSupply()`: `[TOTAL_SUPPLY]`
- Unique holders: `[UNIQUE_HOLDER_COUNT]`
- Pilot claim transactions: `[PILOT_CLAIM_TXS]`

### Capital raised / runway / fundraising goals

[FOUNDER]

---

## Why Base

**Why Base.** A location deed is only meaningful if it is cheap to issue, cheap
to hold, and genuinely the holder's. Base gives low enough fees that a person
can claim a deed for a place they actually walk through without the fee
outweighing the point, and it is where the consumer wallets our participants
already have will be.

**What specifically becomes onchain.** The registry, and only the registry: one
deed per H3 cell, who holds it, and the authorization that issued it.
Verification stays off-chain because it depends on GPS observations that should
not be public. What goes on-chain is the *conclusion* — this cell has this
holder — never the route.

**Current Base deployment state.** Eight contracts from an earlier design are on
Base Sepolia. The DeedRegistry is not deployed to Sepolia or mainnet yet.

**Why the registry benefits from Base.** Deeds should be ordinary property:
transferable, viewable in any wallet, tradeable without our permission. That
requires a real chain with real wallet and marketplace support, not a private
ledger. The registry has no admin seizure path precisely so that "yours" means
what it normally means on Base.

**Token status.** No token is deployed on mainnet and none is required to claim
a deed. Earlier designs coupled deed minting to burning a MOVE token; that
dependency was deliberately removed so the registry could ship without an
economy attached to it.

**Anything else.** The single most important design decision here is what the
contract *cannot* do. There is no `reclaimDormant`, no admin mint, no forced
transfer, and no way for us to take a deed back because someone stopped using
the app. An earlier version of this contract had all of those.

---

## Final pass before submitting

1. Re-read every sentence against `BASE_BATCHES_004_SAFE_CLAIMS_MATRIX.md`.
2. Confirm no `[BRACKET]` remains unfilled or filled with an aspiration.
3. Confirm every number matches the chain.
4. Confirm nothing says "live" that is only "in review" or "on testnet".
