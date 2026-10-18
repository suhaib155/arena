# MovenRun execution packet report, 18 October 2026

Code commit described: `b3a39cb` (#124, the last code commit). The other heads
are listed in section 1. Status labels: LIVE VERIFIED, CODE TESTED LOCALLY,
SIMULATION ONLY, REVIEWED UNAPPLIED, OWNER REQUIRED/BLOCKED.

Summary: every independent milestone in the packet is done as a draft PR with
green CI. X-05 is ready and waits only on the owner turning the providers on.
Nothing live was changed. Migration 0011 is unapplied, gameplay is off, the
1,000/50 limits are unchanged, and no build, merge or deployment was made.

## 1. Completed tasks and SHAs

| Work | PR / branch | Head | Status | Evidence |
|---|---|---|---|---|
| X-05 preflight recheck and owner dashboard steps | none (board) | — | READY, NOT ENABLED | E-85, E-86 |
| G3/G4 storage: 0011 revision 2 | #124 `feat/g34-storage-capacity` | b3a39cb | REVIEWED, UNAPPLIED; service CODE TESTED LOCALLY | E-90 |
| G2: 1002 rule fixes | #126 `feat/g34-rules-1002` (on #121) | fb7cd5b | CODE TESTED LOCALLY | E-91 |
| Route farming alternatives | #123 `feat/sim-churn-study` | c428aa0 | SIMULATION ONLY | E-89 |
| Android QA0 integration candidate | #125 `preview/android-qa0-candidate` | 15f7f87 | CODE TESTED LOCALLY; no build | E-87 |
| G5–G7 contract research | #122 `research/g5-g7-economy` | 6eea3b4 | CODE TESTED LOCALLY (local Hardhat) | E-88 |

All five PRs are drafts with green CI. All commits are authored by suhaib155.
The board was updated on `security/a10-single-use-google-exchange`:
EVIDENCE_REGISTER E-86 to E-91, EXTERNAL_ACTIONS X-04/X-05/X-29,
PR_QUEUE, EXECUTION_STATUS and reports/INDEX.

## 2. Tests and evidence

| PR | Tests |
|---|---|
| #124 | backend 381/381; both 0011 PostgreSQL suites 27/27, including flag off without 0011 (routes 404, no gameplay tables); api 21/21; tsc clean |
| #126 | backend 382/382 (71 new gameplay tests); api 21/21; shared 247 + 1 skipped; the 1001 config digest and fingerprints match 685852b |
| #123 | shared 265 + 1 skipped; tsc clean; the credit books reconcile exactly |
| #125 | mobile 931/931, shared 156/156, backend 427/427, api 21/21, check-secrets pass, prebuild manifest checks |
| #122 | 43 proofs on the original contracts, 17/17 on the patched ones, shared 256/256 |

Every database test ran on local PostgreSQL 16 in throwaway databases. None
ran against Supabase.

## 3. X-05 readiness

**Status: READY, NOT ENABLED (OWNER REQUIRED).**

Read only at about 19:35Z:
- auth.users 0, auth.identities 0, public.users 0, auth_user_creations 0.
- account_capacity is 1000 total and 50 an hour.
- 20 public tables, 0 without RLS, 0 gameplay tables.
- Website 61d30bb is live, and Render is live at 2192de6.

The owner got the Google Cloud and Supabase click list at about 14:08Z. No
provider is on yet, so there is no live sign-in result and no live 50/hour
refusal proof. None is claimed.

After the owner says "Google on", the checks are:
1. Sign in once at https://movenrun.xyz/sign-in/ with a spare Google account.
2. Expect exactly 1 auth user, 1 google identity, 1 app user, 1 hook row
   (that row is the X-07b proof) and 1 exchange row.
3. A replayed exchange and a refresh-token exchange are both refused.
4. Delete the account at /account-deletion/. The counts go back to 0 and the
   old token is refused.

The wallet comes after that, with an unfunded wallet and a signature only.
Every check reads aggregate counts only. To roll back, the owner turns the
provider off.

## 4. G2 / G3 / G4 progress and proposed decisions

**1002 on #126.** It is a credits-only candidate and not the default; V3 and
the one-push rule are kept.
- Res8/res10 mismatch: the server now builds the res10 path from the
  verified fixes, and the client never sends cells. Recall is 0.96–1.00, with
  0 units off the route.
- Day boundary: the second challenge push must arrive at least 20 hours
  after the first, by server receive time. The midnight straddle exploit
  goes from 4.7 flips to 0.
- Budget: the 13 takes are counted in walk order.
- Zones: each holder gets their own partition, and day close checks it.
- Concurrency: 3 devices sending 30 sessions twice took exactly 13 units.
  30 challengers at once flipped a unit exactly once.
- Same seeds, 1001 vs 1002 (SIMULATION ONLY):

  | | 1001 | 1002 |
  |---|---|---|
  | Area attackers flipped | 530 km² | 0.48 km² |
  | Casual walkers holding ground at the end | 16.7 of 40 | 40 of 40 |

  The costs: attackers hold more empty ground (4.6 km² against 2.9), and
  casual walkers hit the take budget about 3.4 times a session.

**Route farming on #123.** The candidate drops the per-account repeat-route
rule. Instead, 2 or more linked accounts walking together on 4 of 14 days
open an appealable review. The 10 min / 750 m minimum is unchanged.
- Honest accounts are penalised 1.3%, and commutes and loops 0%.
- Colluder trios go from 4.68× to 2.11×, and spoofers from 1.41× to 0.71×.
- It opens about 99 reviews per 1,000 accounts a season.
- Rejected alternatives: taper-12 hits 81% of loops, and a soft ceiling
  hits 47.5% of honest accounts.

**Proposed decisions** (recommended; not adopted):
- Keep 1001 as the default. Take 1002 to a pilot only if V3 §5 is ratified.
- Adopt the review candidate for the pilot with the 2+ threshold.
- Defer the 20-hour value, interpolated units, the partition rule, the
  take-budget size and a limit on empty-ground claims to the owner.

## 5. 0011 storage findings and gate

**Status: REVIEWED, UNAPPLIED.** The drizzle journal still ends at 0010.

Revision 2 changes:
- The push ledger is partitioned by day.
- Units are bigint and players are integer numbers.
- Refused pushes are counters.
- Each player-day gets a sha256 proof.
- Each walker has a 300-unit daily budget.
- A fail-closed capacity guard is added, off unless a quota is set.

Measured on local PostgreSQL:

| | Old shape | Revision 2 |
|---|---|---|
| 1,000 players for 14 days | 317.4 MiB | 127.8 MiB |
| Ledger | 196.1 MiB, 528 B a row | 19.5 MiB, 179 B a row |
| 2× hostile load | 384 MiB | 23.8 MiB |
| Settlement temp spill | 11–23 MiB | 0 B |
| Erasure of 1,000 players | 180 ms | 47 ms |

Dropping a day's partition takes 23 ms and frees the space at once.
DELETE plus VACUUM frees nothing.

Retention compared (players under 85% of 500 MiB, 1 season / 4 seasons; the
projection is SIMULATION ONLY):
- Keep everything: 746 / 195.
- 14-day archived raw partitions plus 120-day compact proofs: 1,611 / 904.
- The same with 2% hostile accounts: 1,224 / 765.

**Gate: NO-GO** until the owner decides the following:
- the real quota;
- the per-table TTLs;
- where the archive lives and who holds its key;
- erasure inside archives;
- the appeal window and legal hold;
- X-25 retention;
- the unit budget and the guard quota;
- a backup before promotion;
- the pilot cap;
- an exact SHA.

The numbers then support a credits-only pilot of up to 200 players for one
season with the guard on. No destructive retention was built.

Open risks:
- `gameplay_unit_challenges` bloats and needs per-table autovacuum settings.
- Over 4 seasons, movement summaries, auth/audit and settled records outgrow
  the ledger.
- #126's `gameplay_session_paths` table, and possibly an
  `opened_received_at` column, must be folded into 0011.
- #124 and #126 both sit on #121 and touch the same service files, so they
  need to be merged into one stack.

## 6. Android / Play status

**Status: candidate verified locally; build OWNER REQUIRED.**

#125 is 2192de6 with #115 merged in.
- The prebuild has backup and transfer off for all 9 domains, cleartext off
  and only MainActivity exported.
- io.movenrun.app, min 24 / target 36, Hermes on.
- Fbjni and Fresco are 16 KB aligned. React-android and hermes-android could
  not be checked here, because the host is blocked; the Play App bundle
  explorer confirms them.
- The only advisory that ships is decode-uri-component 0.2.2 (moderate).

The X04 runbook, the Play worksheet and DATA_INVENTORY are updated. Handset
checks H-1 to H-10 have not been run.

No Play account exists. No EAS quota was used.

## 7. G5–G7 findings

**Status: local research only.** No deployment and no chain call.
- Patches: H1 day-close publication, H2 two-key day scores, H3/M1 2-of-n
  signers and caps, and N1 a void window.
- Deeds: under the source rule, honest players earn 0 Deeds while rings of
  31 or more accounts earn them, and the loosened rule favours farmers.
- Valve: one action can open the full 400M, and tolls are paid liquid even
  with the valve shut.
- The G5-1 to G5-12 recommendations are in G5_CONTRACT_ISSUE_LEDGER §7–12.
- The v3 suite still fails 76 tests against the patched contracts; porting
  it is expected work.

## 8. Owner-only actions

1. **X-05:** do the dashboard steps (Google first), then say "Google on" in
   this thread. After Google passes, do the same for the wallet.
2. **X-29 Vercel:** each push currently builds 5 projects.
   - In movenrun-website, set Settings → Git → Ignored Build Step → Custom to
     `git diff --quiet HEAD^ HEAD -- .`.
   - Disconnect or delete arena, arena-pchb, arena-qg9n and arena-vv61.
   - Today `commandForIgnoringBuildStep` is unset. Production was not touched.
3. **X-28:** in GitHub → Code → Branches, delete `ops/two-network-check`.
   This workspace cannot delete refs.
4. **X-08 / X-04:** restrict the Maps key, set the EAS environment
   variables and EXPO_TOKEN, then approve one preview build of 15f7f87.
5. **Data safety:** confirm the worksheet answers, and accept or fix the
   decode-uri-component advisory.
6. **Decisions:**

   | Topic | Choice needed |
   |---|---|
   | Rules | 1001 vs 1002, and ratifying V3 §5 |
   | Storage | 0011 retention and the pilot gate (section 5) |
   | Anti-farming | the route candidate and its threshold |
   | Contracts | G5-1..12 |
   | Other | X-25 retention; X-01 Play account |

## 9. Next safe tasks

1. Live X-05 verification as soon as the owner says Google is on.
2. Merge #124 and #126 into one stack and fold `gameplay_session_paths` into
   0011, with the tests run again. It stays unapplied.
3. Per-table autovacuum settings and movement-summary retention options for
   0011.
4. Port the v3 contract suite to the patched contracts on #122.
5. Fix the decode-uri-component advisory on #125 if the owner agrees.
6. Prepare the H-1 to H-10 handset worksheet for when a build is approved.
