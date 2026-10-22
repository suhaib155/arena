# Authentication security gap assessment

Checkpoint: 22 October 2026
Source heads: 2326aa6 (board, #112). Backend, mobile and shared source are byte-identical at 2192de6 (live API) and, for `backend/` and `mobile/src/lib/signInMethods.ts`, at #125 15f7f87, so every finding here applies to the deployed API and the Android candidate.

Claim classes: **SV** source verified · **LT** local test confirmed (`research/play-assurance/tests/authAssurance.test.ts`) · **LO** live observed (passive, 22 Oct 09:24Z) · **RR** earlier review, not re-run · **OG** needs a genuine provider, wallet or device · **NR** not run.

Scope: Google browser PKCE, the one-time Google exchange, Supabase refresh, wallet SIWE and web handoff, Android token storage, session refresh and revocation, account deletion, CORS and canonical host, deep-link interception. No live provider writes, no live `/identity` calls with tokens, no user creation.

## 1. Findings

| ID | Finding | Class | Severity | Status |
|---|---|---|---|---|
| A-1 | One environment variable turns HS256 trust back on | SV + LT | Medium (latent) | Proven in code; not live (Render variable removed 16 Oct, RR E-45) |
| A-2 | Provider deletion queue row is never cleared when the erased person signs in again while deletion is pending | SV + LT | Low–medium (operational) | Proven in code |
| A-3 | JWKS outage and a forged token return the same public error | SV + LT | Low (availability/UX) | Proven in code |
| A-4 | Malformed percent-escape in the Google callback URL throws `URIError` | SV + LT | Low (robustness) | Proven in code |
| A-5 | Retrying a refresh after a lost response signs the player out everywhere | SV + LT | Low (by design) | Documented trade-off |
| A-6 | Website deletion page shows "deleted" even when the provider sign-in record is still pending | SV (fact sheet) | Low–medium (Play/privacy truthfulness) | Proven in code |
| A-7 | Custom scheme `movenrun://` can be claimed by another app (F-06) | SV, RR | Low (PKCE protects the codes) | Accepted for v1; App Links design is X-23 |

### A-1 Legacy HS256 can be re-enabled by configuration

`resolveApiConfig` (`backend/src/api/config.ts:42`) calls `supabaseAuthConfigFrom`, which accepts `SUPABASE_LEGACY_JWT_SECRET` (`backend/src/identity/providers/supabaseAuth.ts:330,341`); the verifier then accepts any HS256 token signed with it (`supabaseAuth.ts:103-109`). The only signal is the startup log line (`api/server.ts:11`). The legacy secret was revoked at Supabase (X-26), so Supabase no longer issues HS256 tokens; the remaining risk is that anyone who saw the old secret could mint a token for any subject, including an `amr` `oauth` entry that passes the 10-minute exchange window, if a merge, a blueprint edit or a dashboard paste restored the variable. The local test builds the production config with the variable and verifies a forged token.

Recommendation (small, for the owning workstream): in `resolveApiConfig`, refuse to start when `SUPABASE_LEGACY_JWT_SECRET` is set, or require a second explicit variable with a dated expiry. Add a `renderBlueprint.test.ts` assertion that `render.yaml` never names it. Until then, NO-GO check 3 in LAUNCH_GATES is an owner read of the Render variable names (names only).

### A-2 Stuck provider-deletion queue row

`removeProviderUsers` skips a subject that is mapped to an active MovenRun identity without removing its pending row or marking an attempt (`backend/src/identity/services/supabaseSignIn.service.ts:310-312`). Sequence: account erased → provider delete fails (queued, `accountDeletion.ts:98-101`) → the same Google account signs in before the retry → Supabase still has that user, so a new MovenRun account is mapped to it → every retry skips it, and `due()` keeps returning it first (`repositories/signInStores.ts:214-221`, ordered by `requestedAt`, limit 50). Fifty such rows would starve genuine retries. The test reproduces the stuck row with the in-memory stores.

Recommendation: when the subject is mapped, `pendingAuthDeletions.remove(subject)` (the new account owns it now) and count it as "kept". Add an operator metric for pending rows older than one day (OPERATIONS_METRIC_CATALOGUE).

### A-3 Outage looks like a bad token

If the JWKS cannot be fetched, `keyFor` returns null and the verifier throws `bad_signature` (`supabaseAuth.ts:112-114, 185-188`); `verifyGoogle` maps every verifier failure to `verification_failed` / 401 (`supabaseSignIn.service.ts:156-160`). The JWKS refresh is also limited to once a minute, so a key rotation seen less than 60 s after a failed fetch is refused (`supabaseAuth.ts:158-159`). Fail-closed is right; the cost is that the app tells the person their sign-in failed instead of "try again". A Render cold start (42.4 s observed, LO) plus a Supabase blip lands here.

Recommendation: have the verifier distinguish `jwks_unavailable` and map it to 503 `provider_unavailable`; the token stays unspent (the exchange is only claimed after admission), so a retry with the same token inside the window is safe.

### A-4 Callback parser throws on malformed escapes

`queryOf` calls `decodeURIComponent` without a guard (`mobile/src/lib/signInMethods.ts:108-109`); `signInWithGoogle` calls it directly (`mobile/src/services/signInProviders.ts:82`). A URL such as `movenrun://auth/callback?x=%E0%A4%A` throws `URIError` instead of returning `{kind:"error"}`. The redirect normally comes from Supabase, so this needs a crafted link or an interception (A-7). Effect: an untyped exception reaches the sign-in screen's handler. Fix: wrap each decode and return `unexpected_redirect` on failure. Mobile UI is frozen, but this is a library change, not a screen change; it belongs to the #125 owner.

### A-5 Refresh retry after a lost response

Refresh rotation with reuse detection revokes the whole family on a second use of a rotated token (`identity/services/session.service.ts:207-246`). The app single-flights refresh (`mobile/src/services/__tests__/refreshSingleFlight.test.ts`, SV), so concurrent refreshes are not the risk; a lost response on a flaky network is. The player must sign in with Google again. This is the safer choice; record it in the closed-test script as an expected, explainable sign-out and watch `refresh_reuse_detected` counts.

### A-6 Deletion "pending" is not shown

The API returns `signInRecord: "pending"` when the provider user could not be removed yet (`identity/http/router.ts:366-374`); the live website ignores the field and shows "deleted" (WEBSITE_FACTS, 61d30bb). The data is erased and the provider user is retried every five minutes, but Play's account-deletion policy expects an accurate statement. Fix in the next approved website release: show "Your data is deleted; your sign-in record is being removed and will be gone shortly" for `pending`. Check the mobile deletion screen on #125 for the same field during H-tests.

### A-7 Custom scheme interception (F-06)

Both returns use `movenrun://` (no `intentFilters`/`autoVerify`, SV ANDROID_FACTS). A malicious app claiming the scheme could receive the Google `code` or the wallet handoff `code`, but neither is usable without the verifier that stays in the MovenRun app (Google: PKCE verifier in memory; wallet: verifier in SecureStore `movenrun.walletSignIn.v1`; server check `supabaseSignIn.service.ts:279-284`, LT control). Residual risk is denial (the person's sign-in does not complete) and phishing UI. Future fix X-23: verified HTTPS App Link on `https://movenrun.xyz/auth/...`, `/.well-known/assetlinks.json` served as `application/json` with no redirect, containing the Play App Signing SHA-256 from Play Console (not a local keystore), `autoVerify="true"`, plus the preview signing SHA-256 for internal tests. Needs the owner's Play account and an app change.

## 2. Controls confirmed

| Property | Evidence | Class |
|---|---|---|
| Signature algorithm pinned by key; `none`, unknown `alg`, missing `kid`, `crit` refused | `supabaseAuth.ts:98-124`; existing tests `supabaseAuth.test.ts:86-130` | SV, RR |
| `iss`, `aud`, `role`, `exp`, `nbf`, `iat`, `sub` UUID, anonymous refused | `supabaseAuth.ts:126-135` | SV, RR |
| Production config without a legacy secret refuses all HS256 | `authAssurance.test.ts` control | LT |
| Exchange time from the single `oauth` amr entry; `token_refresh` ignored; two `oauth` entries → refused | `supabaseAuth.ts:145-149`; `supabaseSignIn.service.ts:163-167` | SV, RR |
| One exchange per Supabase session, record kept 30 days; concurrent completes → one winner | `supabaseSignIn.service.ts:169,187-192`; existing tests lines 198-293 | SV, RR |
| Wallet message is the server's exact text, single-use nonce consumed before verification, 5-minute expiry | `supabaseSignIn.service.ts:217-235` | SV |
| Wallet handoff: hash stored, PKCE S256, wrong verifier does not burn the code, single use | `authAssurance.test.ts` control | LT |
| Wallet signs a message only: no transaction, no chain switch, no token scope | `WALLET_SIGN_IN_STATEMENT`, `supabaseSignIn.service.ts:34-37` | SV |
| CORS apex-only, `*` and non-HTTPS refused at startup | `middleware/security.ts:30-47`; `api/config.ts:45-50`; test control | SV, LT |
| Live CORS: apex allowed, `www` and others not; `www` 308 to apex | 22 Oct 09:24Z | LO |
| Tokens never in URLs of the API; responses `Cache-Control: no-store` | `router.ts:92-96` | SV |
| Website strips `?code=` with `history.replaceState` before exchange; Google verifier in `sessionStorage` only | WEBSITE_FACTS (61d30bb) | SV |
| App: session tokens in SecureStore; Google verifier in memory; Android backup and device transfer excluded | ANDROID_FACTS (15f7f87) | SV |
| No `console.*` in mobile app code outside tests | ANDROID_FACTS | SV |
| Email OTP routes are not mounted in the deployed API | `api/app.ts:25-31,91` | SV |

## 3. What only a genuine provider, wallet or phone can prove (OG)

1. Supabase issues `amr: [{method:"oauth", timestamp}]` and keeps that timestamp across refresh (A10_GOOGLE_EXCHANGE_PLAN: confirm on a real token in the X-05 window).
2. The Before User Created hook actually runs and enforces 1,000 total / 50 per hour (X-07b). The SQL limits are tested; the live denial is not.
3. Supabase's Web3 grant checks the SIWE URI/domain against the redirect allow list (`https://movenrun.xyz/sign-in/`).
4. Admin delete removes the Google identity so the next consent creates a fresh user.
5. Chrome Custom Tab returns to the app and the code exchange works on a real device (H-tests 15a–15h).

## 4. Local test plan and results

Run from `movenrun/` after `yarn install`:

```
node --import tsx --test 'research/play-assurance/tests/*.test.ts'
```

`authAssurance.test.ts`: 10 tests, 10 pass (22 Oct, Node 22.22.0, lockfile 2326aa6 immutable). Five are controls, five pin findings A-1 to A-5. Tests named `finding:` assert today's behaviour; when a fix lands the test fails and should be inverted.

Further negative cases worth adding by the owning workstream (not added here because they need the shared test harness or a database): concurrent `/account/delete` from two devices; erase during an in-flight Google exchange (the row lock in `accountDeletion.ts:80-84` is the guard); orphan sweep racing a first sign-in at minute 59.

## Integration digest

- Affected paths: this file; `research/play-assurance/tests/authAssurance.test.ts` (imports `backend/src` and `mobile/src/lib`, changes nothing there).
- Evidence: 10/10 local tests at 2326aa6; source lines cited above; passive live check 22 Oct 09:24Z.
- Conflicts: none. Fix A-1/A-2/A-3 belong on the security board branch (#112 lineage, not #111, which is held). A-4 belongs to #125's owner. A-6 needs a website release.
- Next decisions: (1) accept A-1 fix as a pre-X-05 hardening item; (2) owner confirms by name only that Render has no `SUPABASE_LEGACY_JWT_SECRET`.
