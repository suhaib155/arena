# MovenRun — Partner Briefs

Two PDFs written for a partner with **no crypto background**, which also serve
as supporting material for the Base Batches 004 application.

| File | What it is |
| --- | --- |
| `MovenRun-Partner-Brief.pdf` | **24 pages** — the product, the technology from zero, and the plan. Read first. |
| `MovenRun-Economy-and-Investment-Brief.pdf` | **32 pages** — tokens from zero, our token economy, revenue model, costs, and the investment case. |
| `movenrun-partner-brief.html` | Source for the first. Edit, then regenerate. |
| `movenrun-economy-brief.html` | Source for the second. Edit, then regenerate. |

## Economy brief — what it adds

Supersedes the earlier *Revenue Economy Blueprint*. Four parts: **A** teaches
tokens from zero (what a token is, where supply comes from, how a price forms,
why economies collapse); **B** covers the MovenRun token economy (two reward
states, season pools, the four valves, sinks, land as an asset); **C** covers
the business (four revenue engines, sponsors, premium, **costs**, city and
scale models with a conservative column, unit economics); **D** covers the
investment case (what investors score, an honest scorecard, the Base thesis,
use of funds, ten Q&A, proof metrics).

Two things it fixes versus the earlier blueprint:

- **Emission vs allocation do not reconcile.** Pools shrinking 20%/season
  converge to ~45M $MOVE issued ever, but the stated distribution reserves
  600M (60%) for players — 13× apart. Flagged as an open item to resolve
  before any public tokenomics.
- **The deployed contract does not implement season pools.** It mints a fixed
  10 $MOVE/km with halvings. Moving to pools needs a V2 contract.

It also adds the cost side the blueprint omitted (sponsored gas at ~$1.20 per
player per year, infrastructure, the unknown wallet-provider cost) and a
conservative revenue column alongside the optimistic one.

## Labelling convention

Every figure in the economy brief is tagged **From our code** (a real contract
parameter, verifiable on-chain), **Illustrative** (a model, not a forecast), or
**Planned** (designed, not live). All revenue figures are illustrative — there
are no paying customers and no validated pricing.

## Contents

1. MovenRun in one page · 2. The problem we are solving · 3. The core loop ·
4. What using the app feels like · 5. Crypto explained from zero · 6. What Base
is and why we chose it · 7. The three-layer architecture · 8. Two users, two
experiences · 9. Zone Deeds and the $MOVE economy · 10. Proof of movement ·
11. What is already built (honest status table) · 12. Roadmap · 13. How we get
users · 14. Why us, why now · 15. Risks · 16. Glossary · Appendix: first two weeks

All diagrams are inline SVG using the **Daylight Cartography** palette shared
with `movenrun/website/css/style.css` and `movenrun/mobile/src/theme.ts`.

## Sources

Content is drawn from this repository, so it stays consistent with what we ship:

- `movenrun/docs/ROADMAP.md` — phases, guardrails, current state
- `movenrun/docs/TOKENOMICS.md` — emission, burns, zone tax, distribution
- `movenrun/docs/ARCHITECTURE.md` — oracle flow, GPS pipeline, H3 grid
- `movenrun/docs/CONTRACTS_AUDIT.md` — the eight deployed Base Sepolia contracts
- `movenrun/docs/IDENTITY_WALLET_FOUNDATION.md` — identity/session/wallet status
- `movenrun/shared/src/constants/{h3,emission}.ts` — the live parameters
- `movenrun/website/` and `movenrun/website/docs/` — public product narrative

Section 11's status table is the reconciliation between the public docs (which
describe the protocol **as designed**) and what is actually built today. Keep it
current — it is the part that protects our credibility.

## Regenerating either PDF

```bash
cd movenrun/docs/partner-brief
chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=MovenRun-Partner-Brief.pdf \
  --virtual-time-budget=6000 \
  file://$PWD/movenrun-partner-brief.html

chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=MovenRun-Economy-and-Investment-Brief.pdf \
  --virtual-time-budget=6000 \
  file://$PWD/movenrun-economy-brief.html
```

Any Chromium/Chrome build works. The HTML is self-contained — no external fonts,
scripts, or images — so the output is deterministic. A4, print colours forced on.
