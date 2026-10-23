# MovenRun continuation: security, movement and gameplay, 23 Oct 2026

Code references:
- `feat/g34-server-holdings` at 6429a309be2fcdef7206dfaef464cdd448a2bc3b (unchanged today);
- Android candidate `preview/android-qa0-candidate` at 15f7f87604759763dfaf0ef583b3e944f7fba3ed;
- board branch `security/a10-single-use-google-exchange`.

Evidence rows E-102 to E-115; owner items X-29 to X-32 in `EXTERNAL_ACTIONS.md`. Evidence labels: LIVE VERIFIED, CODE/CI VERIFIED, LOCAL POSTGRES VERIFIED, SIMULATION ONLY, RESEARCH/PROPOSED, OWNER/PROVIDER GATE, UNKNOWN/REVERIFY.

## A. Executive GO / NO-GO

| Track | Verdict | Why |
|---|---|---|
| Play v1 (public listing) | **NO-GO** | See the Play v1 blockers below. |
| On-device QA0 | **NO-GO until X-04 and X-08** | See the QA0 blockers below. |
| Future 200-person off-chain gameplay pilot | **NO-GO** | See the pilot blockers below. |

**Play v1 blockers:**
- There is no Play developer account (X-01).
- Google and wallet sign-in are off (X-05).
- The P0 fixes from today (A-1, A-2, A-3, A-4) are drafts and are not deployed.
- No build has been run.
- No handset results exist.
- The declarations need owner answers.

**QA0 blockers:**
- The candidate 15f7f87 is ready to build.
- The H-1..H-12 worksheet is written (#142), and every step is NOT RUN.
- A build needs the owner's EAS approval (X-04), plus the Maps key and variables (X-08).

**Pilot blockers:**
- Server sealing, the receipt cutoff, authoritative-only pushes and settlement invariants now exist as reviewed drafts (#150–#152, #156).
- Migration 0011 is unapplied.
- The real Supabase quota is UNKNOWN.
- Retention, erasure and legal-hold decisions are open.
- The drift rule and the 1003 choice are open.
- There is no physical route acceptance.

**What changed today:**
- 19 new draft PRs (#139–#157), plus the storage benchmark PR. Each was reviewed by an agent that did not write it, and reviewer fixes were pushed where needed.
- Nothing was merged anywhere.
- No live system changed: no deploy, provider toggle, migration, build, signature or purchase.

**Pauses and incidents:**
- Work paused twice on usage limits (about 05:20Z, and about 06:00–10:20Z) and resumed from saved state.
- Earlier in the run, a worker used `git stash` in a shared worktree and swapped another worker's uncommitted files. Both branches were rebuilt and re-reviewed, and stash is now banned in the worker rules.

## B. PR manifest

All PRs below are draft and open, with CI green on the listed head unless noted. Rollback for every row is to close the PR. Nothing is merged and nothing is deployed.

| PR | Branch → base | Full head SHA | Gate |
|---|---|---|---|
| #139 | docs/rendered-claims-audit → preview/android-qa0-candidate | f0fb32fd3ce09f41276d90b7c719e89339fec5bc | Mobile UI freeze |
| #140 | security/a4-callback-parser-hardening → preview/android-qa0-candidate | ddf646cc026d90b8e68ebe3cae5759e05d81eff5 | Merge, EAS build |
| #141 | website/truthful-pending-deletion → web/a5-website-repairs | 1a9431d75be362e55c10bf538c65017e89319838 | Website promote |
| #142 | docs/qa0-h1-h12-play-workbook → docs/qa0-handset-worksheet | 4eeeb51803d9a53e51288f2835c26e55c4e74299 | X-01, X-04 |
| #143 | security/a1-legacy-jwt-fail-closed → a10 board branch | 5a06c69e690e6c96d732896ab7e8cf1b3c1e0e83 | Staging deploy |
| #144 | security/a3-jwks-outage-503 → #143 | db929f97ecced3a8a630937ebdeaf42121a6cdb8 | Staging deploy |
| #148 | security/a2-deletion-queue-cas → a10 board branch | b52ae9be6e339fff7234afcd0a06c4c7d5126ed3 | Staging deploy |
| #145 | fix/mr-a-01-metadata-aware-min-evidence → preview/android-qa0-candidate | 7bae38139d0674c780fb3312ac3cc79420ccdd7c | Merge, staging deploy |
| #146 | fix/mr-a-02-no-bridge-after-rejected-jump → preview/android-qa0-candidate | 27fadb5f77a08ae5e69bce1fdb5c9be36bab9d10 | Merge, staging deploy |
| #153 | fix/mr-c-clock-integrity → integration/mr-a-01-02 (814ad74af56b3f0a62fa4632923b059ca061dc18) | 714e04b249b09c93bb1fd2772d62317442a60ece | Merge, UI freeze |
| #154 | fix/mr-c-stationary-drift → #153 | fabeab35870f498b71116e055447c842be82da83 | Owner: 4× rule |
| #155 | fix/mr-xp-estimated-vs-verified → #154 | 6c72a719ea2eff4170db2b5740a2094a74073701 | UI freeze |
| #149 | sim/g34-1003-take-budget-experiment → feat/g34-server-holdings | 38e7251132527e1e089d0a4e8abe0c72fdd362ca | Owner: 1003 |
| #150 | fix/g34-receipt-time-cutoff → feat/g34-server-holdings | 7db6c7a3d94f7ead40eba9620a458a2c7211d8f9 | 0011, gameplay flag |
| #151 | fix/g34-seal-before-territory → #150 | 08a2e523ff39e8864942550e9e3b40827bd0d84d | 0011, gameplay flag |
| #152 | fix/g34-authoritative-push-no-interpolation → #151 | 010d56f25031ca0d623da39814a8f346dd765aa1 | 0011, gameplay flag |
| #156 | fix/g34-settlement-invariants → #152 | 19593fa4ebf57ad93bc3898424e935b202327951 | 0011; erasure decisions |
| #157 | docs/g34-d-register → #156 | 08dfa418841a0f8d733c1b7cb44b4740b86e3ac3 | Owner decisions |
| #147 | research/g5-deed-void-valve-hardening → research/g5-g7-economy-suite-port (#133) | 355b8f558e7052156418f7a284985aa786d64e55 | No onchain action |
| #158 | bench/g34-hot-autovacuum → feat/g34-server-holdings | 5048a53b1667caf9028fd48ffbe627e38bc64b0d | 0011 |

What each PR does:
- **#139:** audits 10 rendered ownership and token claims on the v1 build and proposes copy changes.
- **#140:** malformed or forged auth callbacks fail closed, and Android exports only MainActivity.
- **#141:** the deletion page says "request received / pending", not "deleted".
- **#142:** the H-1..H-12 worksheet, the Play declarations workbook and the short X-05 steps.
- **#143:** A-1. HS256 is never accepted, and startup is refused if a legacy secret variable is set.
- **#144:** A-3. A JWKS outage returns 503 `provider_unavailable`, not 401.
- **#148:** A-2. A compare-and-swap on the deletion queue, plus expiry of the wallet handoff.
- **#145:** MR-A-01. Minimum evidence is metadata-aware, so W04 now verifies.
- **#146:** MR-A-02. No bridge is drawn after a rejected jump, so I02 drops from 2,096 m to 264 m.
- **#153:** uses a monotonic clock, takes health from the age of the last accepted fix, and rejects stamps more than 5 min in the future.
- **#154:** a stationary-drift filter.
- **#155:** splits estimated XP from verified XP.
- **#149:** the 1003 take-budget experiment.
- **#150:** receipt cutoff at day close + 2 h, using the database `created_at`.
- **#151:** the seal gate, returning 409 until a sealed claim exists.
- **#152:** authoritative pushes only, with no interpolation.
- **#156:** settlement invariants, a halt-only switch and append-only proofs.
- **#157:** the D register for the gameplay decisions.
- **#147:** a void-lifecycle design and valve tests.
- **Storage PR:** the HOT and autovacuum benchmark.

Status of earlier PRs at report time:
- #129 and #130 were merged into `feat/g34-server-holdings` on 22 Oct.
- #134 and #135 were merged into the same branch on 23 Oct as ae23471 and 6429a30 (E-101).
- #131, #132, #133, #136, #137 and #138 remain open drafts.
- #136, #137 and #138 are standalone research and are not merged.

## C. P0 security (CODE/CI VERIFIED; none deployed)

**A-1, legacy JWT (#143).**
- Before: the verifier accepted HS256 whenever `SUPABASE_LEGACY_JWT_SECRET` was set. Re-adding the revoked secret to a deploy would have restored trust in it.
- After: the HMAC path is removed. Only ES256/RS256 tokens from the published key set verify.
- Startup now stops if `SUPABASE_LEGACY_JWT_SECRET` or `SUPABASE_JWT_SECRET` is set (even empty), in every environment. The value is never read or reported.
- A source guard test fails if either path returns.
- The live staging API (2192de6) still has the old code. Whether that variable is set on Render is unknown: the owner needs to check the variable **name** only (owner register item 3).

**A-2, deletion queue race (#148).**
- Concurrent deletion processing could act twice on the same request. The queue now claims each row with a compare-and-swap.
- The reviewer added expiry of the wallet handoff (b52ae9b).
- Tests: 320/320 backend, 21/21 API.
- #148 merges cleanly with #144: 332/332.
- Residual: the new 503 sends no `Retry-After` header.

**A-3, JWKS outage (#144).**
- Before: a key-set fetch failure produced 401, which made the client sign the user out.
- After: it returns 503 `provider_unavailable`. 313/313.

**A-4, callback parser (#140).**
- Malformed or forged `movenrun://auth/callback` links are rejected without a crash or a token echo.
- Only MainActivity handles the link.
- The H-7 handset test is NOT RUN.

**Residual risk.** All four fixes are drafts. Production behaviour is unchanged until an owner-approved staging deploy of an exact SHA.

## D. Movement truth

Results come from the copied fixture harness run against the real runtime modules: backend `verifyRun` plus the mobile tracker on integration branch 814ad74 → #153 → #154 → #155. Tests at #155: shared 184, backend 467, mobile 948. The harness and the runtime agree on every fixture (CODE/CI VERIFIED, SIMULATION ONLY for the GPS traces).

| Fixture | Before (m / local XP / server) | After (m / local XP / server) |
|---|---|---|
| W04 short slow walk | 216 / 25 / verified* | 216 / 25 / verified |
| I02 bus leg | 254 / 33 / verified (raw bridge 2,096 m) | 240 / 32 / verified |
| C01 honest 500 m with clock skew | 175 / 0 / not submitted | 501 / 49 / verified |
| C02 clock tamper | 82 / 191 / verified | 161 / 0 / not submitted |
| S03 stationary drift | 632 / 53 / verified | 109 / 25 / verified |

\* Before #145, W04 failed backend minimum evidence on the live rules. #145 verifies it at 207 m / 154 s.

Other movement results:
- **Slow or short walking:** W04 now verifies. Extent is measured per continuous stretch (reviewer fix 7bae381).
- **Vehicle leg:** no distance is bridged after a rejected jump.
- **Clock tampering:** the stopwatch is monotonic. The server rejects stamps more than 5 min in the future. A screen-lock catch-up budget was added (reviewer fix 714e04b).
- **Drift:** S03 still verifies at 109 m. Over 20 seeds the median is 186 m and the maximum 310 m. Stationary drift is reduced but not eliminated.
- **The 4× drift rule needs an owner decision.** It compares path length to ground extent within 2 min. As written it also rejects honest small-loop laps under about 30×speed metres, including a 400 m track at 5.5 m/s.
- **Pauses and offline retries:** estimated XP stays separate from verified XP (#155), and the API never turns pending into earned.
- **Physical handset confirmation:** NOT RUN.

## E. Territory and gameplay (LOCAL POSTGRES VERIFIED / SIMULATION ONLY; flag off)

**Receipt cutoff (#150).**
- Pushes for a day are accepted until day close + 2 h, judged by the database `created_at` and never the client time.
- `verifyDay` refuses late input.

**Server sealing (#151).**
- Territory takes return 409 until the server holds a sealed claim.
- Residual: an out-and-back route can seal, and a gap under 200 m is treated as walked. Sealing v2 needs a minimum-area rule (owner decision).

**Authoritative pushes (#152).**
- `pushInterpolated` is false: no inferred Solid cells are created. 577/577.
- The #150–#152 stack merges onto 6429a30 cleanly: 593/593.
- The inferred-Solid design stays NO-GO.

**Rules digests.**
- 1001 is unchanged at d4199ec6….
- 1002 changed from d9f35588… to 92e8e3cb… (#152).
- The economy rules pin is 8af5766c….

**1003 experiment (#149, SIMULATION ONLY, 564/564).**
- 1002 blocks 56.1% of honest walker-days.
- 1003B at 5/day blocks 13.1% (4.70 flips per day).
- 1003B at 3/day blocks 23.8% (3.29 flips per day).
- Candidate range: 1003B at 3–5/day.
- These numbers predate #152 and need a re-run.

**Settlement (#156, 594/594).**
- Credits are exact, rules are pinned, and the daily and season books reconcile under invariants.
- The switch can only halt, never resume silently, and proofs are append-only.
- Owner decisions:
  - an erasure currently trips the reconciler halt (tombstones?);
  - resume is unchecked;
  - legal hold.

**Unresolved SOURCE decisions** are listed in #157 (D register). D25 and D27 have open wording nits.

## F. Storage (LOCAL POSTGRES VERIFIED on PG16; bench branch 5048a53b1667caf9028fd48ffbe627e38bc64b0d)

**Method.** The gameplay storage bench replays push workloads against local PostgreSQL 16 and records table size, WAL and throughput.

**Variance.** The same workload measures 54.5–250 MiB depending on when autovacuum runs. The earlier 146.9 and 116.8 MiB figures reproduce. A single storage number should therefore always carry its autovacuum state. WAL is 979–1,003 MiB.

**Scale.** 5,000 players at 0% hostile comes to 521.8 MiB. The 200/500/1,000 profiles are in #135 (E-101).

Burst results:

| Metric | Baseline | Targeted autovacuum | HOT fillfactor 80 | Diff-only writes |
|---|---|---|---|---|
| WAL, paced (MiB) | 115 | 121 | 76 | 49 |
| WAL, saturated (MiB) | 505 | 490 | 282 | 137 |
| Throughput, 8 clients (batches/s) | 682 | 733 | 797–846 | 1,137–1,243 |

- There were no lock timeouts or deadlocks (E-111).
- An independent rerun reproduced the shape: diff-only WAL fell 52%, and 200 players at day 14 measured 33.7 MiB against 33.6.
- Before adopting diff-only writes: the service re-stamps kept rows with the holding rules version (`service.ts:726`), so a diff must also compare that column and `first_day`.
- VACUUM FULL is not recommended on hosted production.

**Why 0011 is still off.**
- The real Supabase quota is UNKNOWN; the owner has not confirmed it.
- Retention, erasure and archive decisions are open.
- 0011 has been amended twice today:
  - #150: up 9a62dc7f…, down 34d13e92…;
  - #156, the latest:
    - up e3f355a994657e143e875a55a3892bfd16561c1cc67144c19778b1e80850b59e;
    - down c134da41a828c4175d598551295bba5260870088bbbc05aa7c3265504902d69a.
- These supersede b87f2e2f… and 184fffa7…, which earlier board text cites.
- 0011 stays outside the applied Drizzle chain (0000–0010).

## G. Contracts (RESEARCH/PROPOSED; not audited, not deployed)

**#147** is a Deed void lifecycle design with tests: 152 passing in-process Hardhat tests on the patched prototypes.

Findings:
- The valve's epoch boundary allows twice the cap across two adjacent epochs. A rolling-window design is proposed (owner decision).
- The approver role can be self-administered.
- Still open:
  - `greatBurn` transfers to the treasury instead of destroying supply;
  - liquid tolls can escape the closed valve;
  - locked MOVE can buy a transferable deed.
- Deed IDs as H3 cells leak locations. That risk stays documented.

No RPC transaction, signature, deploy or allowance took place. The Base Sepolia suite remains historic owner-supplied evidence only.

## H. Android and Play

**Candidate.** 15f7f87 (#125). Expo SDK 54, package `io.movenrun.app`, target SDK 36 expected (unconfirmed until a built APK is inspected).

**Status:**

| Item | Status |
|---|---|
| EAS build | **NOT RUN** (X-04) |
| Handset H-1..H-12 | **NOT RUN** |
| 16 KB page-size and manifest checks | **NOT RUN** (H-11, needs an APK) |

**Signing and keys.**
- The preview signing SHA-1 and the Play App Signing SHA-1 are both prerequisites for the restricted Maps key (X-08, X-11).
- No private credential is in public `EXPO_PUBLIC_*` variables.

**Declarations (#142, PLAY_DECLARATIONS_WORKBOOK.md).** Owner answers are required. Official pages were fetched on 23 Oct:
- Data safety: support.google.com/googleplay/android-developer/answer/10787469
- Health apps declaration: answer/14738291. It is required on every track; Activity and Fitness is the likely fit.
- New personal accounts: answer/14151465. 12 opted-in testers for 14 continuous days.
- Account deletion: answer/13327111
- Maps SDK disclosure: developers.google.com/maps/documentation/android-sdk/play-data-disclosure

**Old worksheet answers withdrawn.** The earlier unconditional "Health = No" and "location = approximate" answers are withdrawn.

**Dependency exception.** DEP-EXC-2026-001 (#131) expires 21 Nov 2026 and needs an owner decision.

**Release date.** 2 Nov remains an engineering and pre-listing target only. There is no promise of a public release date.

## I. Hosted state

| Surface | Last verified | Label |
|---|---|---|
| Vercel production | 23 Oct 00:31Z, dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD (61d30bb) | LIVE VERIFIED at that time (E-100) |
| Render staging API `/health`, `/ready` | 18 Oct, at 2192de6 | UNKNOWN/REVERIFY |
| Website pages | 18 Oct | UNKNOWN/REVERIFY |
| Supabase providers (Google, wallet) | 18 Oct 19:35Z: OFF, caps 1000/50 | UNKNOWN/REVERIFY |

**Re-check attempt.** A read-only re-check at 11:40Z on 23 Oct was refused twice: the remote sandbox returned 403, and this workspace's egress proxy refused onrender.com and movenrun.xyz. Neither was retried by another route.

**Vercel daily cap.** The Hobby limit of 100 deployments per day (`api-deployments-free-per-day`) was reached on `arena` at 00:35Z. By 10:43Z it had also been reached on `movenrun-website`, `arena-pchb`, `arena-qg9n` and `arena-vv61`. Preview builds fail; production is untouched. This makes X-29 more urgent.

## J. Blocked operations, owner items, adoption order, roadmap

**Refused or blocked this session:**
- The hosted HTTP re-check (two refusals, above).
- Workers cannot push to branches they did not create. Reviewers pushed `rev/*` branches, which were fast-forwarded after an ancestry check.

**Finding: test globs.**
- The backend `test` script globs miss about 121 tests under plain `sh`, where `**` does not recurse.
- CI may therefore under-run. A small fix PR is a candidate.

**Owner register.** Ask only when one of these is needed for the next guarded step:
1. **X-01:** choose the Play account type truthfully, then register.
2. **X-05:** turn on the Google provider in the dashboards. Turn on the wallet provider only after a genuine Google test.
3. **X-30 Render:** confirm that the variable **names** `SUPABASE_LEGACY_JWT_SECRET` and `SUPABASE_JWT_SECRET` are absent. Then approve one staging deploy of an exact SHA carrying #143, #144 and #148.
4. **X-08 / X-04:** set the EXPO variables and the restricted Maps key, then approve one EAS preview build of an exact SHA.
5. **Play declarations:** Activity and Fitness, location precision, fitness info and SDK flows, from #142.
6. **0011 later:** the real quota, retention and erasure (tombstones), legal hold, backups, and the new 0011 hashes. This does not block Play v1.
7. **X-29 Vercel:** set the ignored-build step, then disconnect Git for `arena`, `arena-pchb` and `arena-qg9n`. Delete nothing.
8. **X-32 DEP-EXC-2026-001:** accept, amend or reject before 21 Nov.
9. **X-31 gameplay decisions:** the 4× drift rule, 1003B at 3–5/day, a minimum seal area, and a rolling-window valve.

**P0 adoption order:**
1. #143, then #144 and #148, onto the board branch.
2. One approved staging deploy.
3. #140 and #145/#146 into the Android candidate.
4. #153–#155 after the drift decision.
5. The gameplay stack #150 → #152 → #156 stays behind the flag and 0011.

**Next two weeks:**
- **Week 1:**
  - land the P0 security drafts after review;
  - fix the test globs;
  - re-run 1003 and fairness on #152;
  - owner decisions on the drift rule and X-29;
  - staging deploy (if approved).
- **Week 2:**
  - an EAS preview build (if approved);
  - H-1..H-12 on a real handset;
  - X-05 Google live test (if enabled);
  - sealing v2 minimum area;
  - storage decisions.

**Next safe continuation prompt:**
"Continue from the 23 Oct report. Without owner gates:
- fix the backend test glob;
- address the open nits on #139, #141, #157 and the #148 Retry-After header;
- re-run the 1003 and fairness study on top of #152;
- rebase stacks as bases move.

Wait for owner answers on register items 1–9 before any guarded operation."
