# Runtime dependency risk ledger

Checkpoint: 22 October 2026
Source heads: lockfile audited = `movenrun/yarn.lock` @ 2326aa6 (#112, this worktree). #125 15f7f87 lockfile compared (section 1). Live API 2192de6; live website 61d30bb.
Claim classes: SOURCE VERIFIED / LOCAL TEST CONFIRMED / REVIEWER REPORTED / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN.

## 1. What was run

| Item | Result | Class |
|---|---|---|
| `yarn npm audit --all --recursive --json` (Yarn 4 from scratchpad, query to the public npm registry, 2026-10-22) | ran, exit 1 (advisories found); 143 JSON rows saved to `c-facts/audit.json` | LOCAL TEST CONFIRMED (registry content as of today) |
| `git diff --stat 2326aa6 15f7f87 -- movenrun/yarn.lock` | 12 deletions only: `expo-clipboard@~8.0.8` removed from mobile deps and its lock block. No version changes. The audit below therefore also applies to 15f7f87, minus expo-clipboard (no advisory in it) | SOURCE VERIFIED |
| Surface classification | static analysis of `yarn.lock` plus package.json roots (version-aware graph walk), not a bundle inspection; no APK, Metro bundle or Render install was produced | NOT RUN for any bundle/install inspection |
| Backend bundle imports | esbuild metafile (in memory, nothing written) for `backend/src/api/server.ts`: external imports are cors, drizzle-orm, ethers, express, express-rate-limit, h3-js, helmet, pg, zod | LOCAL TEST CONFIRMED |

## 2. Counts: advisories are not exploitable shipped vulnerabilities

143 audit rows = 136 advisory rows + 7 deprecation notices. An advisory row is one advisory against one package, so one GHSA can repeat across versions and paths.

| Severity | Advisory rows | Unique GHSA | Unique package@version |
|---|---|---|---|
| critical | 3 | 3 | 2 |
| high | 77 | 63 | 30 |
| moderate | 47 | 39 | 27 |
| low | 9 | 8 | 6 |

Surface of each (GHSA, package@version) pair, each pair counted once at its most-shipped surface:

| Surface | critical | high | moderate | low |
|---|---|---|---|---|
| Android runtime (ships in APK) | 0 | 0 | 1 (decode-uri-component) | 0 |
| Backend runtime (ships to Render and runs) | 0 | 1 (drizzle-orm) | 0 | 0 |
| Backend install-time tooling (installed by `yarn workspaces focus`, not imported by the API bundle) | 0 | 4 | 11 | 3 |
| Mobile build tooling (EAS/Metro/Expo CLI, not in APK) | 1 | 43 | 13 | 1 |
| Contracts and dev tooling (hardhat, mocha, coverage; not installed on Render, not in APK) | 2 | 30 | 25 | 6 |
| Website (static) | 0 | 0 | 0 | 0 |

Website: `movenrun/website/` at 61d30bb has no `package.json` or lockfile (git ls-tree; only `vercel.json`), so the npm audit does not apply; third-party scripts or CDN assets are not covered by this audit (UNKNOWN) (SOURCE VERIFIED for the absence of a manifest).

Headline: of 81 critical/high pairs, **1 sits in code that runs on the live API (drizzle-orm) and 0 sit in the Android runtime by lockfile path**. Whether the one backend advisory is exploitable is assessed in section 4; the other 80 are tooling-only by static path and need a release-build bundle check to close (section 5). Surface assignment is reasoning from the lockfile, class SOURCE VERIFIED for the paths, UNKNOWN for the claim "not bundled" until a build is inspected.

Boundary notes: (a) react-native's own `glob`/`minimatch`/`brace-expansion` and `react-devtools-core > shell-quote` are installed by react-native but used by its Node scripts or dev tools; the only `require` of glob in react-native is `scripts/codegen/generate-artifacts-executor/generateSchemaInfos.js` (grep, SOURCE VERIFIED). (b) Backend `ethers` resolves to 6.17.0 with `ws@8.21.0`, outside the vulnerable ws range, so the ws advisories (ethers 6.14.0 / 5.8.0) are contracts-only (lock:7297-7308). (c) `tar` and `undici@8.7.0` reach the backend install only via `tsx > fsevents > node-gyp`; fsevents is a macOS-only optional package, so whether Render's Linux install fetches it is UNKNOWN.

## 3. Every critical/high package@version

Columns: package@version | severity | advisories | surface | shortest lockfile path from a workspace dependency | vulnerable range(s) from the audit. Source: audit.json + yarn.lock @ 2326aa6.

| package@version | sev | adv. | surface | path | vulnerable range |
|---|---|---|---|---|---|
| @fastify/busboy@2.1.1 | high | 1 | Contracts/dev tooling | @nomicfoundation/hardhat-verify@2.0.0 > undici@5.29.0 > @fastify/busboy@2.1.1 | >=1.0.0 <3.2.1 |
| @xmldom/xmldom@0.8.14 | high | 6 | Mobile build tooling | expo@54.0.36 > @expo/cli@54.0.26 > @expo/plist@0.4.9 > @xmldom/xmldom@0.8.14 | >=0.7.0 <=0.8.14 |
| @xmldom/xmldom@0.9.10 | high | 11 | Mobile build tooling | expo@54.0.36 > @expo/config-plugins@54.0.5 > xcode@3.0.1 > simple-plist@1.4.0 > plist@3.1.1 > @xmldom/xmldom@0.9.10 | >=0.9.0-beta.1 <=0.9.11; >=0.9.0-beta.9 <=0.9.10; >=0.9.0 <=0.9.10; >=0.9.0 <=0.9.11; >=0.9.10 <=0.9.11 |
| adm-zip@0.4.16 | high | 5 | Contracts/dev tooling | hardhat@2.28.6 > adm-zip@0.4.16 | <0.6.0; <0.6.1; <=0.6.0 |
| axios@1.18.1 | high | 7 | Contracts/dev tooling | hardhat-gas-reporter@1.0.8 > eth-gas-reporter@0.2.27 > axios@1.18.1 | >=1.16.1 <1.20.0; >=1.15.0 <1.20.0; >=1.15.1 <1.20.0; >=1.13.0 <1.20.0; >=1.15.2 <1.20.0; >=1.17.0 <1.20.0 |
| brace-expansion@1.1.16 | high | 4 | Mobile build tooling (also reachable via: mobile+contracts) | react-native@0.81.5 > glob@7.2.3 > minimatch@3.1.5 > brace-expansion@1.1.16 | <1.1.17; <1.1.18; <1.1.20; <1.1.19 |
| brace-expansion@2.1.2 | high | 4 | Mobile build tooling (also reachable via: mobile+contracts) | expo@54.0.36 > @expo/cli@54.0.26 > minimatch@9.0.9 > brace-expansion@2.1.2 | >=2.0.0 <2.1.3; >=2.0.0 <2.1.4; >=2.0.0 <2.1.6; >=2.0.0 <2.1.5 |
| brace-expansion@5.0.9 | high | 2 | Mobile build tooling | expo@54.0.36 > @expo/fingerprint@0.15.5 > minimatch@10.2.6 > brace-expansion@5.0.9 | >=4.0.0 <5.0.11; >=4.0.0 <5.0.10 |
| braces@3.0.3 | high | 1 | Mobile build tooling (also reachable via: mobile+contracts) | expo@54.0.36 > @expo/metro@54.2.0 > metro-file-map@0.83.3 > micromatch@4.0.8 > braces@3.0.3 | <=3.0.3 |
| browserslist@4.28.6 | high | 2 | Mobile build tooling | expo@54.0.36 > @expo/metro-config@54.0.17 > @babel/core@7.29.7 > @babel/helper-compilation-targets@7.29.7 > browserslist@4.28.6 | <=4.28.6 |
| compression@1.8.1 | high | 1 | Mobile build tooling | expo@54.0.36 > @expo/cli@54.0.26 > compression@1.8.1 | <1.8.2 |
| drizzle-orm@0.31.4 | high | 1 | Backend runtime | drizzle-orm@0.31.4 | <0.45.2 |
| fast-uri@3.1.3 | high | 7 | Contracts/dev tooling | @nomicfoundation/hardhat-verify@2.0.0 > table@6.9.0 > ajv@8.20.0 > fast-uri@3.1.3 | >=3.0.0 <=3.1.3; >=3.0.0 <3.1.5; >=3.1.3 <3.1.6; >=3.0.0 <3.1.6; >=3.1.2 <3.1.6; >=3.0.0 <3.1.7 |
| follow-redirects@1.16.0 | high | 2 | Contracts/dev tooling | hardhat@2.28.6 > solc@0.8.26 > follow-redirects@1.16.0 | >=1.16.0 <1.16.1 |
| handlebars@4.7.9 | critical | 2 | Contracts/dev tooling | solidity-coverage@0.8.17 > sc-istanbul@0.4.6 > handlebars@4.7.9 | >=4.0.0 <=4.7.9; >=3.0.0 <=4.7.9 |
| image-size@1.2.1 | high | 2 | Mobile build tooling | expo@54.0.36 > @expo/metro@54.2.0 > metro@0.83.3 > image-size@1.2.1 | >=1.2.0 <=2.0.2; >=0.6.3 <=2.0.2 |
| js-yaml@3.15.0 | high | 2 | Mobile build tooling (also reachable via: mobile+contracts) | react-native@0.81.5 > babel-jest@29.7.0 > babel-plugin-istanbul@6.1.1 > @istanbuljs/load-nyc-config@1.1.0 > js-yaml@3.15.0 | >=3.0.0 <3.15.1; >=3.0.0 <3.15.2 |
| js-yaml@4.3.0 | high | 2 | Mobile build tooling (also reachable via: mobile+contracts) | expo@54.0.36 > @expo/cli@54.0.26 > @expo/xcpretty@4.4.4 > js-yaml@4.3.0 | >=4.0.0 <4.3.1; >=4.0.0 <4.3.2 |
| lodash@4.17.21 | high | 1 | Contracts/dev tooling | @nomicfoundation/ignition-core@0.15.0 > lodash@4.17.21 | >=4.0.0 <=4.17.23 |
| nanoid@3.3.16 | high | 1 | Mobile build tooling | expo@54.0.36 > @expo/metro-config@54.0.17 > postcss@8.4.49 > nanoid@3.3.16 | <3.3.18 |
| node-forge@1.4.0 | high | 1 | Mobile build tooling | expo@54.0.36 > @expo/cli@54.0.26 > node-forge@1.4.0 | <=1.4.0 |
| postcss@8.4.49 | high | 2 | Mobile build tooling | expo@54.0.36 > @expo/metro-config@54.0.17 > postcss@8.4.49 | <=8.5.11; <=8.5.17 |
| serialize-javascript@6.0.2 | high | 1 | Contracts/dev tooling | hardhat@2.28.6 > mocha@10.8.2 > serialize-javascript@6.0.2 | <=7.0.2 |
| shell-quote@1.10.0 | critical | 1 | Mobile build tooling | react-native@0.81.5 > react-devtools-core@6.1.5 > shell-quote@1.10.0 | >=1.8.4 <1.11.0 |
| source-map-js@1.2.1 | high | 1 | Mobile build tooling | expo@54.0.36 > @expo/metro-config@54.0.17 > postcss@8.4.49 > source-map-js@1.2.1 | >=1.0.0 <1.2.2 |
| tar@7.5.20 | high | 1 | Mobile build tooling (also reachable via: mobile+contracts+backend-install) | react-native@0.81.5 > babel-jest@29.7.0 > @jest/transform@29.7.0 > jest-haste-map@29.7.0 > fsevents@2.3.3 > node-gyp@13.0.1 > tar@7.5.20 | <=7.5.20 |
| tmp@0.0.33 | high | 1 | Contracts/dev tooling | hardhat@2.28.6 > solc@0.8.26 > tmp@0.0.33 | <0.2.6 |
| undici@5.29.0 | high | 3 | Contracts/dev tooling | @nomicfoundation/hardhat-verify@2.0.0 > undici@5.29.0 | <6.24.0; <6.27.0 |
| undici@6.28.0 | high | 1 | Mobile build tooling | expo@54.0.36 > @expo/cli@54.0.26 > undici@6.28.0 | >=6.7.0 <6.28.1 |
| undici@8.7.0 | high | 3 | Mobile build tooling (also reachable via: mobile+contracts+backend-install) | react-native@0.81.5 > babel-jest@29.7.0 > @jest/transform@29.7.0 > jest-haste-map@29.7.0 > fsevents@2.3.3 > node-gyp@13.0.1 > undici@8.7.0 | >=8.0.0 <8.9.0; >=8.0.0 <8.10.2 |
| ws@8.17.1 | high | 1 | Contracts/dev tooling | ethers@6.14.0 > ws@8.17.1 | >=8.0.0 <8.21.0 |
| ws@8.18.0 | high | 1 | Contracts/dev tooling | hardhat-gas-reporter@1.0.8 > eth-gas-reporter@0.2.27 > ethers@5.8.0 > @ethersproject/providers@5.8.0 > ws@8.18.0 | >=8.0.0 <8.21.0 |

Common columns by surface (they apply to every row of that surface unless the row is called out in section 4):

| Surface | Entry point | Attacker-controlled input reachable in supported flows? | Mitigation in place | Update feasibility | Priority | Verification method | Exception expiry |
|---|---|---|---|---|---|---|---|
| Mobile build tooling (@expo/cli, metro, postcss, babel, xmldom, node-forge, undici, react-devtools-core, react-native scripts) | `eas build` / `expo prebuild` on the EAS builder or the owner's machine | No. Inputs are the repo's own files and config; no user data reaches these tools. Dev-server advisories (compression, shell-quote via devtools) need a running dev server, which a release build does not start | EAS builds are isolated per build; `enableScripts: false` in `.yarnrc.yml` | Mostly transitive pins inside Expo SDK 54; UNKNOWN which patch releases exist. Use Yarn `resolutions` only after testing a build | P4 (monitor; revisit at the next Expo patch) | After the release AAB build, run `expo export --platform android` once with `--dump-sourcemap` and grep the module list for these package names (expect none); NOT RUN | none requested; re-audit 21 Nov 2026 |
| Contracts and dev tooling (hardhat, mocha, solidity-coverage, hardhat-verify, gas reporter) | `hardhat test/compile/verify`, `mocha`, coverage; developer machines or CI only | No. Inputs are the repo's contracts and tests. The adm-zip, undici, axios and follow-redirects advisories concern hostile archives or servers that these tools do not receive in normal use | Not installed on Render (`yarn workspaces focus @movenrun/backend`, render.yaml); not in the APK | Dev-only; bump hardhat toolchain when convenient | P4 | Confirm `yarn why <pkg>` shows only contracts/dev roots; `yarn workspaces focus @movenrun/backend --production` then re-audit; NOT RUN | none requested |
| Backend install-time tooling (tar, undici 8.7.0 via tsx/node-gyp) | Render build step install | No (build-time fetch of packages; not request handling) | API start is `node dist/api.cjs` (bundle, deps external); these packages are not imported | Bump tsx or node-gyp chain when upstream moves | P4 | Check the bundle metafile imports (done, section 1) and Render install log after the next deploy; NOT RUN on Render | none requested |

## 4. Rows that need individual treatment

### 4.1 drizzle-orm@0.31.4, GHSA-gpj5-g38j-94v9 (high, backend runtime)
- Path: `@movenrun/backend > drizzle-orm@0.31.4` (backend/package.json `^0.31.0`). Entry point: every database call in the live API (identity stores, handoffs, events).
- Advisory: SQL injection through improperly escaped SQL identifiers; vulnerable `<0.45.2` (audit).
- Attacker-controlled input reachable? **Not found.** Non-test source under `backend/src` has no `sql.raw` or `sql.identifier` (grep, SOURCE VERIFIED); the `sql` template uses (e.g. signInStores.ts:219,250; drizzle/stores.ts:119,503,566-585) interpolate typed columns and parameter values, not caller-supplied identifier names. Column and table names come from the static schema. Reasoning, not a runtime test; whether other drizzle APIs take identifiers (dynamic `orderBy` column names, aliases) is covered only by that grep (no dynamic column selection was found).
- Mitigation: static identifiers; parameterised values; API reachable only via the rate-limited routes.
- Update feasibility: UNKNOWN. 0.31 to 0.45 is a large minor jump on a live API with 0 accounts today; it needs the backend test suite and a staging run. Because the API has 0 accounts, now is the cheapest time.
- Priority: P2, fix or formally accept before accounts exist at scale. Verification: bump in a branch, run `yarn workspace @movenrun/backend test` and `test:api`, then Render staging smoke; NOT RUN. Exception expiry: none granted here; owner decision.

### 4.2 handlebars@4.7.9 (2 critical GHSA: GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f)
Path: `solidity-coverage > sc-istanbul > handlebars`. Contracts coverage tooling only; the attack needs an attacker-supplied template, and sc-istanbul renders its own bundled report templates. Surface: contracts/dev tooling. Priority P4. Verification: `yarn why handlebars` shows no backend or mobile root (LOCAL, path analysis above).

### 4.3 shell-quote@1.10.0 (critical, GHSA-pqg4-j6r4-53mv)
Path: `react-native > react-devtools-core > shell-quote`. Used by developer tooling that builds editor-launch commands; not part of an app's release JS. Mobile build/dev tooling. Priority P4. Verification: release bundle module list (section 3, NOT RUN).

### 4.4 decode-uri-component@0.2.2, GHSA-vcc3-ghjq-m6fr: time-limited exception
- Severity in today's audit: **moderate**, not high or critical (audit.json: "Denial of service via exponential decoding of malformed percent-encoded input", vulnerable `<=0.4.2`). It is recorded here because it is the only advisory whose package ships in the Android runtime by lockfile path.
- Path (15f7f87 lock:6385-6388, 11193-11197, 3983, 7468; same at 2326aa6 apart from expo-clipboard): `mobile > expo-router@6.0.24 > query-string@7.1.3 > decode-uri-component@0.2.2`, and `@react-navigation/core@7.21.12 > query-string@7.1.3`. Entry point: `main: expo-router/entry`, so the packages are in the bundle.
- Is the movenrun://auth/wallet?code= route fed through `query-string.parse`? **No, by source reading of the installed packages (SOURCE VERIFIED, plus 3 pinning tests LOCAL TEST CONFIRMED):**
  - expo-router 6.0.24 supplies its own `getStateFromPath` to the navigation container (`build/getLinkingConfig.js:90`). Its forked implementation parses the query with `new URL(path, 'https://phony.example').searchParams` (`build/fork/getStateFromPath-forks.js:372`); the original `queryString.parse` call is commented out (`build/fork/getStateFromPath.js:538`).
  - expo-router's remaining query-string use is `queryString.stringify` when building paths from state (`build/fork/getPathFromState.js:276`, `getPathFromState-forks.js:71`); stringify does not call decode-uri-component.
  - `build/fork/extractPathFromURL.js:87,99` uses the built-in `decodeURI`/`decodeURIComponent`, not the vulnerable package.
  - `@react-navigation/core@7.21.12` `getStateFromPath` does call `queryString.parse(query)` (lib/module/getStateFromPath.js:586). It is the default only when no linking config supplies one; expo-router always supplies its own. So the vulnerable call exists in the bundle but is not on the inbound deep-link path in the supported flow. Exception rationale wording: **"bundled package, call path not on the supported inbound route per source; not proven absent at runtime"**. It is not claimed unreachable: a future expo-router or react-navigation update, or a feature using the core default, could route attacker-influenced URLs into `queryString.parse`.
  - App code: the Google callback parser uses `decodeURIComponent` on a hand-written split, not query-string; `authAssurance.test.ts:191-203` exercises it. Finding recorded there: a malformed `%` escape throws URIError in `parseGoogleCallback` (signInProviders.ts:82, not in a try). That is an app robustness issue, not the advisory.
- Attacker-controlled input: the app owns the `movenrun` scheme, so any app or web page can launch `movenrun://...` with an arbitrary query (bounded by Android intent size). Reachable in principle; the parser that receives it is URL.searchParams.
- Bounded negative evidence: `research/play-assurance/tests/queryStringExposure.test.ts` (8 tests, all pass): 9 inputs, each at most 64 characters, fed to the installed `query-string.parse` and `decode-uri-component`; each returns or throws within 50 ms. Observed ad hoc: 50-char input 1.4 ms, 62-char input 7.3 ms, so cost grows with repeated malformed escapes; the test deliberately does not test long inputs (no DoS payloads). The test also pins the expo-router source facts above, so an upgrade that changes the path fails the test.
- Mitigation: none beyond the above; effect of a successful hit is a UI-thread stall in a single-user app (denial of service of the user's own session), no data exposure.
- Update feasibility: query-string 7.1.3 is pinned by expo-router and react-navigation (`^7.1.3`); upgrading means waiting for Expo SDK patch or using a Yarn resolution to query-string 9 (API-compatible? UNKNOWN). Priority P3.
- Verification when closing: after any expo-router upgrade, rerun the test file; after the release build, grep the exported module list for decode-uri-component. **Exception expiry: 21 November 2026** (30 days from this checkpoint). Renew only with a new audit run and an owner decision.

## 5. Gaps (NOT RUN / UNKNOWN)
- No release bundle or APK inspected: tooling-only claims rest on lockfile paths (NOT RUN).
- Render install contents not inspected (NOT RUN).
- Website third-party assets not audited (UNKNOWN).
- `yarn npm audit` reflects registry data of 2026-10-22; advisories change daily; rerun before any release.
- Update feasibility for each tooling package is UNKNOWN beyond "transitive, dev-only".

## Integration digest
- Affected paths: this file; `research/play-assurance/tests/queryStringExposure.test.ts`; `c-facts/audit.json`. No lockfile or package change proposed or made.
- Evidence: audit run 2026-10-22 on 2326aa6; lock diff to 15f7f87 = 12 deletions (expo-clipboard); tests 8/8 pass; 11/11 together with the acceptance-script tests.
- Conflicts: if #125 later changes expo-router or react-navigation versions, section 4.4 pins may fail by design.
- Next decisions (max 3): (1) drizzle-orm 0.31.4 upgrade or acceptance (P2); (2) approve the decode-uri-component exception to 21 Nov 2026; (3) inspect the release bundle once to close the tooling-only claim.
