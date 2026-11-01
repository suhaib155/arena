# DEP-EXC-2026-001 reassessment (29 Oct 2026)

Scope: `decode-uri-component@0.2.2` via `query-string@7.1.3` (advisory GHSA-vcc3-ghjq-m6fr), on `integration/android-qa0-28oct` at `a2a3eec`. The exception text is on `docs/decode-uri-exception-22oct` (`docs/security/DEPENDENCY_EXCEPTIONS.md`); it expires 21 Nov 2026. Nothing was merged or published. Facts are marked VERIFIED (how) or UNVERIFIED.

## Dependency path (VERIFIED: yarn.lock parse, run by the new test)

- `decode-uri-component` resolves once, to 0.2.2. Its only dependent is `query-string` (7.1.3, one resolution).
- `query-string` is required by exactly two packages: `@react-navigation/core@7.21.12` and `expo-router@6.0.24`.
- `yarn why` could not be run (the package manager download is blocked in this environment), so the lockfile was parsed directly.

## Reachability with outside input (VERIFIED: installed sources read; pinned by test)

Only the parse side of query-string reaches the decoder (`parse`, and `parseUrl`, `pick`, `exclude`, which call it). `stringify` never decodes.

| Call site in shipped code | Method | Reached by outside input? |
|---|---|---|
| `expo-router/build/fork/getPathFromState.js`, `getPathFromState-forks.js` | `stringify` | No decoding |
| `@react-navigation/core/lib/module/getPathFromState.js` | `stringify` | No decoding |
| `@react-navigation/core/lib/module/getStateFromPath.js` line 586 | `parse` | Only if React Navigation's default parser runs. expo-router always supplies its own `getStateFromPath` (`getLinkingConfig.js` lines 90-91), which reads query strings with `new URL(...).searchParams` (`parseQueryParams`). So not on the deep-link path |
| App code (`mobile/app`, `mobile/src`) | none | The app imports neither query-string nor decode-uri-component, builds no linking config, and its own `decodeURIComponent` calls are the built-in |

Input surfaces: the app has only the `movenrun` scheme and no https intent filters (`app.json`), so a deep link is the only outside URL. The sign-in return is parsed by the app's own code. Verdict unchanged: reachable package, unreachable vulnerable call, with one caveat: the default parser is a latent site that is safe only because of the override.

Pinned by `mobile/src/lib/__tests__/queryStringReachability.test.ts` (8 cases). Mutation checks: adding an app file that imports query-string fails the app-code case; adding an `intentFilters` entry fails the scheme case; a changed lockfile dependent list, a second decoding call site, a changed linking override or a changed `parseQueryParams` also fail. The case for the override fails if expo-router stops supplying its parser.

## Does an upgrade remove the need? (VERIFIED by experiment in the worktree; not committed)

1. **decode-uri-component 0.5.x by resolution: no.** 0.5.0 and 0.5.1 (23 Oct) are ESM-only with a default export. Under `query-string@7.1.3` the call fails with `decodeComponent is not a function` (checked in Node on a scratch copy). 0.2.2 on a long malformed input overflows the stack (checked), confirming the advisory is real in the library.
2. **`@react-navigation/core` 7.22.1 or later: yes for the call site, not for the package.** Those releases drop `query-string`; `@react-navigation/native@7.3.16` accepts `core ^7.21.12`, so no resolution is needed, only a lockfile refresh of one entry (core 7.21.12 to 7.24.0, 13 Oct). In the worktree I swapped core 7.24.0 into `node_modules`: mobile suite 964/964 pass, 0 fail, 0 skipped (includes the 8 new cases), `tsc --noEmit` clean, `expo export --platform android` produced a Hermes bundle (4.42 MB against 4.41 MB). `expo-router@6.0.24` still depends on `query-string ^7.1.3`, so `decode-uri-component` stays in the tree and an audit still lists it. Lockfile diff size: the true diff needs `yarn` to compute the checksum, which could not run here; expected shape is the core entry (version, resolution, checksum, dependency list minus `query-string` and `nanoid`) plus the lines of packages no longer needed. Treat the size as UNVERIFIED until `yarn up @react-navigation/core` is run where yarn works.
3. **Removing the package entirely** needs `expo-router` that no longer depends on query-string (58.0.28 and `next`; 55-57 still depend on it, and 58 is a newer Expo SDK than the app's SDK 54), or forcing `query-string@10.0.0` (21 Oct 2026, ESM-only, no decode dependency). Forcing 10.0.0 under CJS `require` in expo-router 6.0.24 was not tried: UNVERIFIED, and a risky resolution for an exception this narrow.

## Recommendation: amend, keep the date

- **Amend** the exception now: the vulnerable call site can be removed by a one-entry lockfile refresh (option 2), after which the exception rationale becomes "installed, never called" (stringify only) instead of "called only behind an override". Open that as its own reviewed change; the reachability test already accepts both states.
- **Keep the 21 Nov 2026 expiry** (23 days away). Do not renew yet and do not shorten: the finding is not worse than on 22 Oct, no exploitable path exists, and a shorter date adds review work without risk reduction.
- **Date logic:** on or before 14 Nov re-run `queryStringReachability.test.ts` and check for an Expo SDK 54 compatible expo-router without query-string. If the core refresh has merged, renew once to at most 21 Dec 2026 with the narrower wording; if an SDK upgrade is not planned by then, record an owner decision. Retire the exception when the resolved tree no longer contains `decode-uri-component` below 0.5.0.
- The owner sign-off line in the exception register (approver and date) is still blank; it is an owner action.
