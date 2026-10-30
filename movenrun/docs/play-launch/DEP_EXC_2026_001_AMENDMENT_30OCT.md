# DEP-EXC-2026-001 amendment (30 Oct 2026)

Internal dependency exception text, amended from the version on `docs/decode-uri-exception-22oct` (`docs/security/DEPENDENCY_EXCEPTIONS.md`). Facts come from `docs/security/DEP_EXC_2026_001_REASSESSMENT_29OCT.md` (#178). This is a proposal for the owner. It is **not signed and not in force as amended** until the sign-off block at the end is completed by the owner.

## 1. Identification

| Field | Value |
|---|---|
| Exception | DEP-EXC-2026-001 |
| Advisory | GHSA-vcc3-ghjq-m6fr |
| Package | `decode-uri-component@0.2.2`, single resolution |
| Pulled in by | `query-string@7.1.3`, required by `@react-navigation/core@7.21.12` and `expo-router@6.0.24` |
| Weakness | Denial of service on long malformed percent-encoded input (a stack overflow on 0.2.2 was reproduced in the reassessment) |

## 2. Dates

| Item | Date |
|---|---|
| Expiry | **21 November 2026** |
| Reassessment due by | **14 November 2026** |
| Extension | **None automatic.** On 21 November 2026 the exception lapses unless the owner records a new, dated decision. The reassessment note allows at most one renewal, to 21 December 2026, and only with narrower wording |

## 3. Scope

In scope: this one package and advisory in the mobile app dependency tree, as resolved in `yarn.lock` on the Android integration line (checked at `a2a3eec`). Not in scope: any other advisory, any other package, the backend, the website, and any change to the Play Data safety form (this advisory is not listed there).

The package ships; the exception does not claim it is removed. The finding is "present, not reached", not "fixed".

## 4. Basis and compensating controls

1. Only the parse side of `query-string` reaches the decoder (`parse`, `parseUrl`, `pick`, `exclude`). `stringify` never decodes. Verified by reading installed sources.
2. `expo-router` always supplies its own `getStateFromPath` and reads query strings with `new URL(...).searchParams`, so React Navigation's default parser (the one call to `parse`) is not on the deep-link path.
3. The app imports neither `query-string` nor `decode-uri-component`, builds no linking config of its own, and its own `decodeURIComponent` calls are the built-in.
4. The app has only the `movenrun` scheme and no https intent filters, so a deep link is the only outside URL. The sign-in return is parsed by the app's own code.
5. Test pin: `mobile/src/lib/__tests__/queryStringReachability.test.ts` (8 cases) fails if a lockfile dependent is added, an app file imports `query-string`, an https intent filter is added, the linking override changes, a second decoding call site appears, or `parseQueryParams` changes. It runs in the normal mobile suite.
6. No forced yarn resolution: decode-uri-component 0.5.x is ESM-only and breaks `query-string@7.1.3` (`decodeComponent is not a function`), so a resolution override is not allowed without compatibility and QA proof.

Latent risk, stated openly: the default parser site is safe only because of the override in point 2.

## 5. Earlier reassessment triggers

Any one of these ends the wait for 14 November and requires reassessment within 5 working days (the exception may be revoked early):

1. A new advisory or a public exploit for `decode-uri-component` or `query-string`, or the advisory severity or description changes.
2. A change in reachability: an attacker-controlled path or query string can reach `query-string.parse` or the decoder (for example a new https intent filter or App Link, X-23; an app-side linking config; a new use of `query-string`).
3. Any change touching the affected code path: `expo-router`, `@react-navigation/*`, `query-string`, the linking override, `parseQueryParams`, or the mobile deep-link handling.
4. A compatible upstream fix becomes available: `@react-navigation/core` 7.22.1 or later (drops `query-string`; recorded as one lockfile entry refresh, not committed), or an Expo SDK 54 compatible `expo-router` without `query-string`.
5. The reachability test fails or is changed to accept a new state.

## 6. Planned follow-up (not done by this document)

- Open the one-entry `@react-navigation/core` lockfile refresh as its own reviewed change; the lockfile size is UNVERIFIED until `yarn up` runs where yarn works.
- On or before 14 November: re-run the reachability test, check for an SDK 54 compatible `expo-router` without `query-string`, and record the outcome as a new evidence entry.
- Retire the exception when the resolved tree no longer contains `decode-uri-component` below 0.5.0.

## 7. Owner sign-off

Status: **NOT SIGNED. This block is intentionally blank.** Nothing in this repository records an approval of this amendment.

Decision (accept / amend / reject): ______________________

Name: ______________________________

Date: ______________________________

Signature: __________________________
