# Dependency security exceptions

Internal register of time-limited, documented exceptions to dependency
advisories. An exception is not a fix. It records why an advisory is not
upgraded now, why the vulnerable code path is believed unreachable, when the
exception expires, and what ends it early. Each exception is reviewed on its
expiry date or earlier if a trigger in the last column occurs.

Do not add advisory text to Play Data safety answer files.

| ID | Advisory | Package path | Scope | Reachability verdict and evidence | Owner-decision status | Expiry / review date | What would end the exception |
|---|---|---|---|---|---|---|---|
| DEP-EXC-2026-001 | GHSA-vcc3-ghjq-m6fr (moderate). Denial of service through exponential decoding of malformed percent-encoded input. Affected `decode-uri-component` <= 0.4.2. Patched in 0.5.0. | `query-string@7.1.3` -> `decode-uri-component@0.2.2`. Pulled in by `@react-navigation/core@7.21.12` and `expo-router@6.0.24`. Ships in the mobile app bundle. | Mobile app (Android QA0 preview candidate). Build-time and bundled, not server-side. | **Reachable package, unreachable vulnerable call path.** No compatible upstream fix exists: `query-string@7.1.3` pins `decode-uri-component ^0.2.2`, and the only fixed release is 0.5.0, so no Yarn resolution is forced. (1) expo-router parses deep-link query strings with `URL.searchParams` in `node_modules/expo-router/build/fork/getStateFromPath-forks.js` line 372 (`parseQueryParams`). (2) expo-router overrides React Navigation's default parser in `node_modules/expo-router/build/getLinkingConfig.js` lines 90-91. (3) The only `query-string` parse call in `@react-navigation/core` is `lib/module/getStateFromPath.js` line 586. That call is therefore not used on the deep-link path. (4) `query-string` is used only for stringify in path building. (5) The app's own `decodeURIComponent` calls in `mobile/src/lib/signInMethods.ts` lines 111-112 are the built-in JavaScript function, not the vulnerable library. Verdict: not exploitable through the current route set. | Pending owner decision. Recorded as a provisional exception based on the reachability analysis. Owner sign-off is not recorded here. | 21 November 2026, or sooner (see last column). | (a) A compatible upstream release of `query-string` or `@react-navigation/core` that moves off `decode-uri-component` <= 0.4.2, or an expo-router release that stops pulling it. (b) Any route, linking-config, or dependency change that makes `@react-navigation/core`'s `query-string` parse call reachable from deep-link or untrusted input. (c) Any change to `expo-router`'s `parseQueryParams` that stops using `URL.searchParams`. (d) Any new use of `query-string` parse on untrusted input in app code. Re-run the reachability checks above on every Expo SDK or expo-router upgrade. |

## Review checklist for DEP-EXC-2026-001

- [ ] Confirm the owner decision and record the approver and date.
- [ ] Re-check the four file and line references above after any expo-router or React Navigation upgrade.
- [ ] Re-check whether a compatible upstream fix exists before the expiry date.
- [ ] Remove this exception once the vulnerable version is no longer in the resolved tree.
