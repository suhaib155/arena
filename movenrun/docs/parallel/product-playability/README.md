# Track A: product truth, movement integrity and geography

Research track for Play v1 (Movement Game). Nothing in this folder or in
`movenrun/research/product-playability/` changes the app, the backend, a hosted
service or a device. Every result is labelled:

- **LIVE**: observed on a hosted service or a real phone. Track A has no LIVE results.
- **LOCAL**: produced by running the repository code in this checkout.
- **SYNTHETIC**: produced from generated routes in the open Atlantic (0.5° N, 25.5° W). No real person walked them.
- **PROPOSED**: a change that is not applied anywhere.

Test verdicts are PASS, FAIL, BLOCKED or NOT RUN.

Base: `preview/android-qa0-candidate` at `15f7f87` (PR #125). The app code is unmodified.

## Documents

| Document | What it answers |
|---|---|
| [V1_FEATURE_TRUTH_MATRIX.md](V1_FEATURE_TRUTH_MATRIX.md) | What each v1 screen really does, its evidence, and the copy that overclaims |
| [GPS_INTEGRITY_FIXTURE_SPEC.md](GPS_INTEGRITY_FIXTURE_SPEC.md) | The 30 synthetic routes, what each must do, what fails today, and the triage |
| [SESSION_STATE_MACHINE.md](SESSION_STATE_MACHINE.md) | The full movement lifecycle, from permission through verification, deletion and process kill |
| [MAP_GEOGRAPHY_PRODUCT_SPEC.md](MAP_GEOGRAPHY_PRODUCT_SPEC.md) | How a future territory overlay shows real geography, not a hex board |
| [GEOGRAPHY_ACCEPTANCE_FIXTURES.md](GEOGRAPHY_ACCEPTANCE_FIXTURES.md) | GEO-01 to GEO-12, each backed by a test |
| [MAP_PRIVACY_THREAT_MODEL.md](MAP_PRIVACY_THREAT_MODEL.md) | Who could learn where a player lives, and the controls |
| [ANDROID_QA0_DEVICE_MATRIX.md](ANDROID_QA0_DEVICE_MATRIX.md) | The device protocol for QA0 (all NOT RUN) |
| [FIRST_WALK_UX_RESEARCH.md](FIRST_WALK_UX_RESEARCH.md) | First-walk journeys, task scripts, severity rubric, metrics |
| [V1_RELEASE_FIX_PRIORITIES.md](V1_RELEASE_FIX_PRIORITIES.md) | One severity-ranked list of every defect this track found |
| [reports/](reports/) | The track's final report and integration digest |

## How to run

From the `movenrun/` folder, after `yarn install` (Yarn 4.9.1):

```sh
research/product-playability/run-tests.sh
```

This runs every test in `research/product-playability/tests/` with Node's test
runner through `tsx`. It needs no network, device or credentials. Expected
result at this commit: 80 pass, 0 fail, 9 todo. Each todo is a known defect;
its message names the finding id. When a todo starts passing, the paired
"defect still reproduces" test fails, so a fix cannot land silently.

Other commands, all run from `movenrun/research/product-playability/` with
`TSX_TSCONFIG_PATH=$PWD/tsconfig.json node --import tsx --import ./support/nodeShims.ts <script>`:

| Script | Output |
|---|---|
| `synthetic-routes/report.ts --write` | `synthetic-routes/corpus/corpus.json` and `measurements.md` |
| `synthetic-routes/proposals.ts --write` | `synthetic-routes/corpus/candidates.md` (before and after each proposed fix) |
| `claims-checker/check.ts [--json] [--all]` | Unlabelled overclaims on release surfaces. Exit 1 when a fail-severity claim or a stale allowlist entry exists |
| `geography/conceptDataset.ts --write` | `geography/concept-dataset.json` and `concept-coverage.svg`, stamped SIMULATED / NOT LIVE |
| `tools/redactLog.ts < log.txt` | The log with coordinates, tokens, emails, ids, cells, wallets and IPs removed |

Typecheck, from `movenrun/`: `node_modules/.bin/tsc -p research/product-playability/tsconfig.json --noEmit`.

## What this track did not do

It did not build an APK, touch a phone, call a hosted API, change a setting or
use a real GPS track. Every device check is in
[ANDROID_QA0_DEVICE_MATRIX.md](ANDROID_QA0_DEVICE_MATRIX.md) as NOT RUN.
