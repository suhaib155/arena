# Product status: Play v1 versus the full game

The first Google Play build is a smaller, honest Movement Game. That narrows
the first release; it does not cancel the full game. Every pillar below stays
on the roadmap ([PR_QUEUE.md](PR_QUEUE.md)).

| Pillar | In Play v1 | Status | Next packet |
|---|---|---|---|
| Walk, run and cycle sessions with GPS | Yes | Code tested locally; phone test pending (QA0) | QA0 |
| Server verification of sessions | Yes | Code tested locally; live after X-06 | L1 |
| Sign-in: Google or wallet (signature only), guest play | Yes | Code tested locally; providers wait on X-07, X-05 | L2 |
| Account deletion (in app and on the web) | Yes | Code tested locally; the web flow needs X-06, X-07, X-05 | L2, W1 |
| Sealing (a route closing a loop) | Shown as a preview in the app; verified on the server | Engine implemented and tested | G2 |
| Covered ground as map areas | No (the app is on hold) | Server endpoint tested locally (`/movement/coverage`) | G1, UX0 |
| Held, contested and at-risk territory | No | Not built: needs the territory ledger | G2–G3 |
| Clubs, districts, seasons | No (preview mockups only) | Not built server-side | G4 |
| Deeds | No | Prototype contracts on a separate branch, not audited, not in Play v1 | G5 |
| Points, MOVE, wallet balances, payouts | No | Out of the public app until accounting, security and legal gates pass | G6–G7 |
| Mainnet | No | An objective for the official launch, not done | G7 |

**Never shown as live:** anything in the "No" rows. Websites and store
listings label these as planned or preview.
