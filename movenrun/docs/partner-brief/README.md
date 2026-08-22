# MovenRun — Partner Onboarding Brief

A 24-page PDF that explains MovenRun end to end for a partner with **no crypto
background**, and doubles as supporting material for the Base Batches 004
application.

| File | What it is |
| --- | --- |
| `MovenRun-Partner-Brief.pdf` | The deliverable. Share this. |
| `movenrun-partner-brief.html` | The source. Edit this, then regenerate. |

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

## Regenerating the PDF

```bash
cd movenrun/docs/partner-brief
chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=MovenRun-Partner-Brief.pdf \
  --virtual-time-budget=6000 \
  file://$PWD/movenrun-partner-brief.html
```

Any Chromium/Chrome build works. The HTML is self-contained — no external fonts,
scripts, or images — so the output is deterministic. A4, print colours forced on.
