# MovenRun Track A final report: product truth, movement integrity and geography

Date: 22 October 2026. Branch `research/parallel-a-product-playability`, content
SHA `350268f`, draft PR #137 (base `preview/android-qa0-candidate`, do not merge).

Labels: LIVE (hosted or real phone), LOCAL (repo code run here), SYNTHETIC
(generated routes), PROPOSED (not applied). Verdicts: PASS, FAIL, BLOCKED, NOT RUN.
Track A has no LIVE result.

## 1. Outcome

| Deliverable | Status |
|---|---|
| V1 feature truth matrix, feature register, forbidden-claims checker | Done (LOCAL) |
| Synthetic route generator, 30 fixtures, CI-ready command, fixture spec and triage | Done (SYNTHETIC) |
| Session state machine doc and transition tests | Done (LOCAL) |
| Map geography spec, GEO-01 to GEO-12, privacy threat model | Done (SYNTHETIC, PROPOSED) |
| Android QA0 device matrix | Written; every check NOT RUN or BLOCKED |
| First-walk UX research, task scripts, rubric, metric definitions | Done (PROPOSED) |
| Severity-ranked fix list | Done |
| Independent review | A separate reviewer checked 46 claims; 5 were wrong or unsupported and are corrected in `350268f` |
| One draft research PR | #137 |

## 2. Test evidence

| Command (from `movenrun/`) | Result |
|---|---|
| `research/product-playability/run-tests.sh` | 89 tests: 80 PASS, 0 FAIL, 9 todo (known defects, each paired with a "still reproduces" check) |
| `node_modules/.bin/tsc -p research/product-playability/tsconfig.json --noEmit` | PASS (exit 0) |
| Mobile suite (`mobile`, `node --import tsx scripts/run-tests.ts`) | 931/931 PASS, before and after |
| Shared suite | 156/156 PASS, before and after |
| `node scripts/check-secrets.mjs` | PASS |
| `claims-checker/check.ts` | Exit 1: 16 unlabelled fail-severity hits, 56 review hits, 0 stale allowlist entries |
| Android build, device, hosted service | NOT RUN |

## 3. Before and after (SYNTHETIC)

| Measure | Before | After (PROPOSED fix in the harness) |
|---|---|---|
| Corpus fixtures failing | 8 of 30 | 6 with P1; 3 with P1 to P5 |
| Honest 220 m city walk (W04) | Server rejects, 7 points | Verified (P1) |
| Walk with a 2-min vehicle leg (I02) | 2,103 m, 144 XP, verified | 287 m (P2) |
| 1 h clock jump on an 82 m walk (C02) | Saveable, 191 XP | Not saveable, 0 XP (P3) |
| Clock set back (C01) | Chip green for 200 s while all fixes are dropped | Chip degrades (P4) |
| Still phone, overconfident accuracy (S03) | 632 m, 53 XP, verified | 456 m (P5). Still open |

## 4. Integration digest

**Affected paths** (new only):
`movenrun/research/product-playability/**`, `movenrun/docs/parallel/product-playability/**`.
`git diff 15f7f87..350268f` touches nothing else: no app, shared, backend,
workflow, lockfile, evidence board or website file.

**Exact SHAs.** Base #125 `15f7f87` (unchanged since the start of the run). Track A head
`350268f` plus this report's commit. Heads recorded at the start: main `d344c3b`,
release/android-v1-cxfdbd `991ac6a`, deploy/render-free-staging `2192de6`,
feat/g34-server-holdings `cb27318` (now `850bf64`), #127 `384150e`, #128 `49c9fe9`.
#129, #126 and #124 are no longer in the open PR list.

**Conflicts.** None at file level. Two overlaps to coordinate:
- #132 (QA0 physical-handset worksheet, H-1 to H-10) covers some of the same device checks as `ANDROID_QA0_DEVICE_MATRIX.md`. Merge the two into one protocol before QA0 runs.
- #135 (storage lifecycle) and this track's threat model both touch retention. The threat model notes that no retention period for `movement_verifications` exists in code.

**Mirrors that can drift.** `synthetic-routes/clientPipeline.ts` replays lines from
`app/move/session.tsx` and `summary.tsx`; `serverPipeline.ts` copies the router's
`toValidatable`. `tests/pipelineDrift.test.ts` fails if either side changes.

## 5. Next small decisions

1. P1 (backend, no UI): drop the legacy 10-point floor for sessions with metadata.
2. P2 (shared, no UI): start a new stretch after a speed rejection.
3. MR-A-10: approve a copy-only UX0 change for 10 rendered claims, and hide the Technical info contracts drawer behind the `wallets` flag.
4. MR-A-09: keep XP banked at Save (local, no value), or bank after the server verdict.
5. Merge #132 and the QA0 device matrix into one handset protocol.

## 6. Top five

1. **MR-A-01**: the server rejects honest short and slow walks ("Too few GPS points"). One backend change fixes both fixtures.
2. **MR-A-02**: a bus or car leg is credited as walking, and the server agrees.
3. **MR-A-10**: the release UI still shows "$MOVE token contract", "Own your season." and "Move → Capture → Own".
4. **S2-1 and S2-7**: no outdoor-safety line and no hint that locking the screen stops recording.
5. **MR-A-03**: Save and XP follow the wall clock, so a clock change alters them.

## 7. Owner question

Should the next step be small draft PRs for P1 and P2 (backend and shared only, no UI change) on top of the QA0 line?
