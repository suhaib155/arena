# Track B economy red-team harnesses

This folder holds stand-alone research harnesses for territory, economy, abuse and contracts work. They read the gameplay, simulation and contract code but never change it. Reports live in `docs/parallel/economy-redteam/`. Everything here is synthetic or offline. Nothing here is a product feature, a live rule or proof that any policy has been approved.

## Run

From `movenrun/` with workspace dependencies installed:

```
node --import tsx --test 'research/economy-redteam/**/*.test.ts'
```

At commit time the suite ran 172 tests: 161 pass, 0 fail, 11 skipped. The skipped tests need one of these:

- `MOVENRUN_TEST_DATABASE_URL`: a throwaway local PostgreSQL. 7 invariant tests need it.
- `BOOKKEEPING_WT122`: a checkout of PR #122's `movenrun` folder. 4 tests need it.

## Contents

| Folder | Section | Re-generate outputs | Report |
|---|---|---|---|
| `catalogue/` | B1 source rules and worked examples | `node --import tsx research/economy-redteam/catalogue/run.ts` | `SOURCE_RULE_CATALOGUE.json`, `SOURCE_TO_IMPLEMENTATION_GAP_MATRIX.md` |
| `sim/` | B2/B3 scenario lab (1001, 1002 and variants) | `node --import tsx research/economy-redteam/sim/run.ts` (about 25 min on 4 cores) | `G2_G4_FAIRNESS_AND_ABUSE_RESULTS.md` |
| `invariants/` | B4 server-authority invariants | `node --import tsx research/economy-redteam/invariants/run.ts` | `SERVER_AUTHORITY_INVARIANTS.md` |
| `capacity/` | B5 cost-driver calculator and local bench | `node --import tsx research/economy-redteam/capacity/run.ts`; bench: `bench/run-matrix.sh` (local loopback only) | `PILOT_CAPACITY_REDTEAM.md` |
| `farming/` | B6 linked-account review and appeals | `node --import tsx research/economy-redteam/farming/run.ts` | `ANTI_FARMING_APPEALS_RESEARCH.md` |
| `clubs/` | B7 clubs and districts | `node --import tsx research/economy-redteam/clubs/run.ts` | `CLUB_AND_DISTRICT_FAIRNESS_BRIEF.md` |
| `bookkeeping/` | B8 property tests over the credit books | `node --import tsx research/economy-redteam/bookkeeping/run.ts` | `ECONOMIC_BOOKKEEPING_ASSERTIONS.md` |
| `contracts/` | B9 offline contract checks; `vendored-*` folders are frozen read-only copies verified by `SHA256SUMS`, not source of truth | `contracts/reverify.sh` (in-process Hardhat only; refuses if any RPC or key variable is set) | `ONCHAIN_AND_DEED_RISK_REGISTER.md` |

Seeds are kept in versioned manifests. The same seed produces byte-identical output, and the generating folders test this. Tests named `documents defect: …` or `documents finding: …` assert that a known problem exists. They keep the suite green while keeping the problem visible.
