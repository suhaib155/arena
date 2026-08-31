# Founder video pitch

Three lengths. All three are constrained by
`BASE_BATCHES_004_SAFE_CLAIMS_MATRIX.md` — nothing here may say the registry is
live, name a holder count, or describe income that does not exist.

Speak it, don't read it. The 2-minute version is the one to record.

---

## 60 seconds

> Most of us generate location data all day and get nothing from it. It gets
> collected, sold on, and we never hold any of it.
>
> MovenRun turns that around. You move through the real world, our server
> verifies the movement actually happened, and the map cells your route passed
> through become claimable — one cell, one deed, yours, on Base.
>
> The thing that makes it work is that it rewards the route you repeat, not the
> distance you cover. Distance is easy to fake and tells you nothing about a
> place. Going back to the same street every week is expensive to fake, and it
> is exactly what makes that street mean something.
>
> The registry is built and tested — one cell can only ever have one deed,
> claims need a signed authorization from a verified session, and there is no
> way for us to take a deed back. We're deploying to Base next, and running a
> small pilot with real people claiming real ground.

---

## 2 minutes — record this one

**Problem (~20s)**

> Location is the most valuable data most people produce and the one they get
> least from. It gets collected constantly and sold onward, and the person who
> actually walked there never holds any of it.
>
> And it cuts the other way too. A shop that wants to know whether real people
> walk past its door can't find out honestly — footfall is modelled, inferred,
> or bought from the same intermediaries.

**Insight (~20s)**

> Both of those are a verification problem before they're a product problem.
> You can't build anything honest on movement data until you can verify
> movement without just trusting the phone that reported it.
>
> And the signal that matters isn't distance. It's repetition. The map should
> reward the route you repeat, not the distance you cover — because going back
> to the same place is hard to fake and it's what makes a place meaningful.

**Product (~30s)**

> So: you record a session in the app. Our server verifies it — it computes the
> distance, checks the route is plausible, and works out which map cells you
> actually passed through. It never takes the app's word for any of that.
>
> Then one of those cells can be claimed. You get an authorization tied to your
> wallet and that specific cell, and you claim it yourself. You end up holding
> a deed for a piece of ground you actually walked.

**Why a location asset (~20s)**

> A deed is the right shape because it's permanent and it's genuinely yours.
> There's no reclaim in our contract — we can't take it back because you
> stopped running. It's an ordinary NFT: transfer it, sell it, hold it, we
> don't get a say.
>
> Later, that's what a footfall layer would be built on. A business paying to
> reach people who actually walk past needs a trustworthy record of who does.
> That part isn't built yet.

**Why Base (~15s)**

> Fees low enough that claiming a cell you walked through is worth doing, and
> the consumer wallets our participants already have.

**What's built (~20s)**

> The registry is implemented and tested. One cell maps to exactly one deed,
> enforced by the contract. Claims need an EIP-712 authorization from a
> separate oracle key — the admin key can't issue them and the oracle key can't
> administer anything. No token is required to claim.
>
> We've run the whole path end to end on a local chain: verified session,
> authorization, mint, transfer, and we proved replays and duplicate claims
> fail.

**Next (~15s)**

> Deploying to Base, then a pilot with real participants claiming real ground
> from real routes. Small and honest rather than large and manufactured.

---

## 5 minutes — outline only

Same spine, with room to add:

1. **Problem** — the two-sided version, with a concrete example of a local
   business that cannot verify footfall.
2. **Insight** — why repetition beats distance, and how decay already makes
   holdings depend on going back.
3. **Product walkthrough** — show the app recording a session; describe what
   the server computes and what it refuses to accept from the client.
4. **The contract, honestly** — what it deliberately cannot do. No reclaim, no
   admin mint, no seizure, no token dependency. An earlier version had all of
   those and they were removed on purpose.
5. **Privacy** — the route never goes on-chain. What goes on-chain is the
   conclusion: this cell has this holder.
6. **Why Base.**
7. **State of play** — what is built, what is in review, what is deployed
   (currently nothing), what is planned. Be specific about the boundary.
8. **The pilot** — what a real participant does, why they need their own
   wallet and their own gas, and why we would rather report four real holders
   than fifteen that dissolve under a block-explorer check.
9. **Team and why now.**

---

## Do not say

- "live on mainnet" — until it is
- any holder or supply number — until it is on chain
- that deeds earn, yield, or pay anything — they do not
- that PvP, clubs, or enclosure capture exist — they do not
- that a token economy is running — it is not
