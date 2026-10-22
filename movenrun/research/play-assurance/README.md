# Play assurance research harness (Track C)

Local, read-only checks. Nothing here calls a live service, uploads a binary or builds an app.

| Path | What it does |
|---|---|
| `tests/authAssurance.test.ts` | Negative and control tests against the real sign-in code (`backend/src`, `mobile/src/lib`). Tests named `finding:` pin a reported gap and are expected to fail once it is fixed |
| `tests/queryStringExposure.test.ts` | Bounded inputs to the installed `query-string` / `decode-uri-component` (GHSA-vcc3-ghjq-m6fr exception evidence) |
| `tests/androidAcceptanceScript.test.ts` | Proves the artifact script reports NOT RUN rather than PASS without a real artifact |
| `tools/android-artifact-acceptance.sh` | Inspects an existing APK/AAB the owner supplies; `--self-test` checks its own discipline |

Run from `movenrun/` after `yarn install`:

```
node --import tsx --test 'research/play-assurance/tests/*.test.ts'
```

Reports live in `docs/parallel/play-assurance/`.
