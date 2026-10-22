# Candidate fixes: before/after on the synthetic corpus

SYNTHETIC / NOT LIVE. PROPOSED fixes only; none is applied to the app.

- **before**: Today's code
- **P1**: Server: drop legacy 10-point floor for sessions with metadata
- **P2**: Shared: no straight bridge from the anchor after a speed rejection
- **P3**: Client: Save/XP duration from fix timestamps, not the wall clock
- **P4**: Client: future-dated fixes degrade the signal chip
- **P5**: Shared: 60 s drift guard (net < 25% of path over >= 40 m)
- **all**: P1 to P5 together

| Fixture | before | P1 | P2 | P3 | P4 | P5 | all |
|---|---|---|---|---|---|---|---|
| S01-stationary-90s | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| S02-stationary-5min | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| S03-stationary-5min-overconfident | FAIL 632 m, 53 XP, verified | FAIL 632 m, 53 XP, verified | FAIL 632 m, 53 XP, verified | FAIL 632 m, 53 XP, verified | FAIL 632 m, 53 XP, verified | FAIL 456 m, 43 XP, verified | FAIL 456 m, 42 XP, verified |
| W01-walk-100m | PASS 109 m, 0 XP, not_submitted | PASS 109 m, 0 XP, not_submitted | PASS 109 m, 0 XP, not_submitted | PASS 109 m, 0 XP, not_submitted | PASS 109 m, 0 XP, not_submitted | PASS 109 m, 0 XP, not_submitted | PASS 109 m, 0 XP, not_submitted |
| W02-walk-300m | PASS 290 m, 29 XP, verified | PASS 290 m, 29 XP, verified | PASS 290 m, 29 XP, verified | PASS 290 m, 28 XP, verified | PASS 290 m, 29 XP, verified | PASS 290 m, 29 XP, verified | PASS 290 m, 28 XP, verified |
| W03-walk-750m-block | PASS 742 m, 74 XP, verified | PASS 742 m, 74 XP, verified | PASS 742 m, 74 XP, verified | PASS 742 m, 73 XP, verified | PASS 742 m, 74 XP, verified | PASS 742 m, 74 XP, verified | PASS 742 m, 73 XP, verified |
| W04-walk-220m-urban-accuracy | FAIL 216 m, 25 XP, rejected | PASS 216 m, 25 XP, verified | FAIL 216 m, 25 XP, rejected | FAIL 216 m, 25 XP, rejected | FAIL 216 m, 25 XP, rejected | FAIL 216 m, 25 XP, rejected | PASS 216 m, 25 XP, verified |
| W05-figure-eight | PASS 542 m, 54 XP, verified | PASS 542 m, 54 XP, verified | PASS 542 m, 54 XP, verified | PASS 542 m, 53 XP, verified | PASS 542 m, 54 XP, verified | PASS 542 m, 54 XP, verified | PASS 542 m, 53 XP, verified |
| W06-slow-stroll-150m-6min | FAIL 146 m, 27 XP, rejected | PASS 146 m, 27 XP, verified | FAIL 146 m, 27 XP, rejected | FAIL 146 m, 26 XP, rejected | FAIL 146 m, 27 XP, rejected | FAIL 146 m, 27 XP, rejected | PASS 146 m, 26 XP, verified |
| T01-v3-threshold-599s | PASS 750 m, 76 XP, verified | PASS 750 m, 76 XP, verified | PASS 750 m, 76 XP, verified | PASS 750 m, 75 XP, verified | PASS 750 m, 76 XP, verified | PASS 750 m, 76 XP, verified | PASS 750 m, 75 XP, verified |
| T02-brief-pause-walked-across | PASS 312 m, 30 XP, verified | PASS 312 m, 30 XP, verified | PASS 312 m, 30 XP, verified | PASS 312 m, 29 XP, verified | PASS 312 m, 30 XP, verified | PASS 312 m, 30 XP, verified | PASS 312 m, 29 XP, verified |
| T03-legitimate-stop | PASS 302 m, 39 XP, verified | PASS 302 m, 39 XP, verified | PASS 302 m, 39 XP, verified | PASS 302 m, 38 XP, verified | PASS 302 m, 39 XP, verified | PASS 302 m, 39 XP, verified | PASS 302 m, 38 XP, verified |
| A01-delayed-acquisition | PASS 311 m, 30 XP, verified | PASS 311 m, 30 XP, verified | PASS 311 m, 30 XP, verified | PASS 311 m, 30 XP, verified | PASS 311 m, 30 XP, verified | PASS 311 m, 30 XP, verified | PASS 311 m, 30 XP, verified |
| A02-no-fixes | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| A03-permission-denied | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| A04-approximate-only | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| A05-services-off | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| G01-accuracy-spikes | FAIL 440 m, 41 XP, verified | FAIL 440 m, 41 XP, verified | FAIL 440 m, 41 XP, verified | FAIL 440 m, 41 XP, verified | FAIL 440 m, 41 XP, verified | FAIL 440 m, 41 XP, verified | FAIL 440 m, 41 XP, verified |
| G02-unknown-accuracy | PASS 337 m, 33 XP, verified | PASS 337 m, 33 XP, verified | PASS 337 m, 33 XP, verified | PASS 337 m, 32 XP, verified | PASS 337 m, 33 XP, verified | PASS 337 m, 33 XP, verified | PASS 337 m, 32 XP, verified |
| G03-tracker-error | PASS 346 m, 36 XP, verified | PASS 346 m, 36 XP, verified | PASS 346 m, 36 XP, verified | PASS 346 m, 33 XP, verified | PASS 346 m, 36 XP, verified | PASS 346 m, 36 XP, verified | PASS 346 m, 33 XP, verified |
| I01-teleport | PASS 300 m, 29 XP, verified | PASS 300 m, 29 XP, verified | PASS 272 m, 28 XP, verified | PASS 300 m, 28 XP, verified | PASS 300 m, 29 XP, verified | PASS 300 m, 29 XP, verified | PASS 272 m, 26 XP, verified |
| I02-vehicle-speed | FAIL 2103 m, 144 XP, verified | FAIL 2103 m, 144 XP, verified | PASS 287 m, 35 XP, verified | FAIL 2103 m, 143 XP, verified | FAIL 2103 m, 144 XP, verified | FAIL 2103 m, 144 XP, verified | PASS 287 m, 27 XP, verified |
| I04-slow-vehicle-under-cap | FAIL 2009 m, 137 XP, verified | FAIL 2009 m, 137 XP, verified | FAIL 2009 m, 137 XP, verified | FAIL 2009 m, 137 XP, verified | FAIL 2009 m, 137 XP, verified | FAIL 2009 m, 137 XP, verified | FAIL 2009 m, 137 XP, verified |
| I03-overlap-cowalk | PASS 296 m, 29 XP, verified | PASS 296 m, 29 XP, verified | PASS 296 m, 29 XP, verified | PASS 296 m, 28 XP, verified | PASS 296 m, 29 XP, verified | PASS 296 m, 29 XP, verified | PASS 296 m, 28 XP, verified |
| C01-clock-rollback | FAIL 175 m, 0 XP, not_submitted | FAIL 175 m, 0 XP, not_submitted | FAIL 175 m, 0 XP, not_submitted | FAIL 175 m, 0 XP, not_submitted | PASS 175 m, 0 XP, not_submitted | FAIL 175 m, 0 XP, not_submitted | PASS 175 m, 0 XP, not_submitted |
| C02-clock-fast-forward | FAIL 82 m, 191 XP, rejected | FAIL 82 m, 191 XP, verified | FAIL 82 m, 191 XP, rejected | PASS 82 m, 0 XP, not_submitted | FAIL 82 m, 191 XP, rejected | FAIL 82 m, 191 XP, rejected | PASS 82 m, 0 XP, not_submitted |
| L01-background-mid-walk | PASS 309 m, 37 XP, verified | PASS 309 m, 37 XP, verified | PASS 309 m, 37 XP, verified | PASS 309 m, 29 XP, verified | PASS 309 m, 37 XP, verified | PASS 309 m, 37 XP, verified | PASS 309 m, 29 XP, verified |
| L02-process-kill | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted | PASS 0 m, 0 XP, not_submitted |
| L03-finish-while-paused | PASS 305 m, 29 XP, verified | PASS 305 m, 29 XP, verified | PASS 305 m, 29 XP, verified | PASS 305 m, 29 XP, verified | PASS 305 m, 29 XP, verified | PASS 305 m, 29 XP, verified | PASS 305 m, 29 XP, verified |
| D01-across-utc-midnight | PASS 405 m, 39 XP, verified | PASS 405 m, 39 XP, verified | PASS 405 m, 39 XP, verified | PASS 405 m, 39 XP, verified | PASS 405 m, 39 XP, verified | PASS 405 m, 39 XP, verified | PASS 405 m, 39 XP, verified |

before: 8 fixtures failing; P1: 6 fixtures failing; P2: 7 fixtures failing; P3: 7 fixtures failing; P4: 7 fixtures failing; P5: 8 fixtures failing; all: 3 fixtures failing
