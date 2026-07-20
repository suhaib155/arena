# MovenRun Identity & Wallet — Threat Model

Scope: the identity, session, and wallet foundation
(`backend/src/identity/**`, `mobile/src/{lib,services,store}` + `app/account/**`).
This models the security-critical flows established in this PR. Flows that are
architected but not yet wired (Google OIDC, Base Account, email delivery,
embedded-wallet provider, ERC-1271/6492 verifier) are marked **(follow-up)** in
"Residual risk / evidence" — their controls exist as interfaces/gates and fail
closed until wired.

Each threat lists: **asset · actor · entry point · trust boundary · mitigation ·
detection · recovery · residual risk · evidence**.

---

### 1. OTP brute force
- **Asset**: an account's email-OTP login. **Actor**: remote attacker. **Entry**: `/auth/email/complete`. **Boundary**: API ↔ OTP store.
- **Mitigation**: hashed (peppered) codes, short expiry, per-challenge attempt cap, single-use atomic consume, resend throttle; rate-limit hooks by account/source. **Detection**: `login_failed` audit events; attempt counter. **Recovery**: challenge expiry/lockout; user re-requests. **Residual**: distributed guessing across many emails (needs network-source rate limiting at the edge — follow-up). **Evidence**: `emailOtp.service.test.ts` (cap, single-use, wrong-code).

### 2. Email enumeration
- **Asset**: existence of an account. **Actor**: remote attacker. **Entry**: email begin/complete. **Boundary**: API responses.
- **Mitigation**: uniform `202` on begin regardless of existence; identical `verification_failed` for wrong-code / no-challenge / used-code; no `user_not_found`-style code exists. **Detection**: n/a (prevented). **Recovery**: n/a. **Residual**: timing side channels (constant-time compare used; further hardening possible). **Evidence**: `emailOtp.service.test.ts`, `securityControls.test.ts` (no enumerating codes).

### 3. OAuth callback replay
- **Asset**: a Google session. **Actor**: attacker replaying a callback. **Entry**: `/auth/google/complete`. **Boundary**: API ↔ Google.
- **Mitigation** (architecture): authorization-code + PKCE, state + nonce validation, exact redirect-URI allowlist, issuer/audience checks, single-use callback. **Detection**: nonce reuse rejection. **Recovery**: re-auth. **Residual**: **(follow-up)** provider not wired — endpoint fails closed today. **Evidence**: ADR-0002; `config.test.ts` (redirect allowlist, fail-closed).

### 4. Malicious deep links
- **Asset**: session/handoff integrity. **Actor**: malicious app/link. **Entry**: mobile deep link. **Boundary**: OS ↔ app.
- **Mitigation**: server-authoritative flows; tokens only in secure store; no security decision is made from deep-link params; SIWE message is server-built. **Detection**: signature/nonce mismatch. **Recovery**: challenge expiry. **Residual**: deep-link hardening in native config (follow-up). **Evidence**: ADR-0007 (server-authoritative message), `secureSession.ts`.

### 5. Redirect-URI manipulation
- **Asset**: OAuth code delivery. **Actor**: attacker. **Entry**: Google auth. **Boundary**: API ↔ Google.
- **Mitigation**: exact redirect-URI allowlist in config; partial/misconfigured Google provider fails closed. **Detection**: config validation error at startup. **Recovery**: fix config. **Residual**: **(follow-up)** wiring. **Evidence**: `config.test.ts`.

### 6. Account-link hijacking
- **Asset**: victim's user record. **Actor**: attacker linking their identity to a victim (or vice versa). **Entry**: link flow. **Boundary**: IdentityLinkService.
- **Mitigation**: linking requires an authenticated, recently-verified session; an identity owned by another user is rejected; no email-based merge. **Detection**: `security_policy_denied` audit. **Recovery**: unlink + session revoke. **Residual**: none identified for wired (email) path. **Evidence**: `identity.service.test.ts` (owned-by-another rejection, recent-auth).

### 7. Email collision between providers
- **Asset**: account separation. **Actor**: attacker with a Google account matching a victim's email. **Entry**: signup. **Boundary**: identity resolution.
- **Mitigation**: resolution keyed by `(provider, providerSubject)`, never email — same email under two providers ⇒ two users. **Detection**: n/a (prevented). **Recovery**: n/a. **Residual**: none. **Evidence**: `identity.service.test.ts` (no-silent-merge).

### 8. Session theft
- **Asset**: an active session. **Actor**: attacker with a stolen access token. **Entry**: any authed endpoint. **Boundary**: session verification.
- **Mitigation**: short-lived access tokens; instant invalidation on revoke or `securityVersion` bump; tokens only in secure store on device. **Detection**: anomaly ⇒ revoke-all. **Recovery**: revoke-all bumps `securityVersion`, killing all tokens. **Residual**: theft within the short access-token window. **Evidence**: `session.service.test.ts` (expiry, revoke, security-version).

### 9. Refresh-token replay
- **Asset**: a session family. **Actor**: attacker replaying a refresh token. **Entry**: `/auth/refresh`. **Boundary**: session store.
- **Mitigation**: rotation with reuse detection; replay revokes the whole family (fail closed). **Detection**: `refresh_replay_detected` audit event. **Recovery**: family revoked; user re-authenticates. **Residual**: race between legitimate rotation and replay within one round trip (contained by family revoke). **Evidence**: `session.service.test.ts` (replay → family revocation).

### 10. Lost device
- **Asset**: sessions + wallet access on the device. **Actor**: finder/thief. **Entry**: device. **Boundary**: OS keystore.
- **Mitigation**: tokens in OS-secure storage; `revoke-all` from another device; short access-token TTL. **Detection**: user-reported. **Recovery**: sign-out-everywhere (revoke-all + security bump). **Residual**: window before the user revokes. **Evidence**: `session.service.test.ts` (revoke-all), `security.tsx` (sign-out-everywhere).

### 11. Compromised email account
- **Asset**: the account (email is a login method). **Actor**: email-account attacker. **Entry**: email OTP. **Boundary**: recovery policy.
- **Mitigation**: sensitive changes need step-up beyond email; final-method removal blocked; no support-only override. **Detection**: audit trail; `recovery_method_changed`. **Recovery**: revoke-all; re-secure via another factor. **Residual**: if email is the ONLY factor, its compromise = account compromise (mitigated by encouraging multiple methods; final-method protection prevents lockout). **Evidence**: ADR-0010; `identity.service.test.ts`.

### 12. Compromised Google account
- **Asset**: the account. **Actor**: Google-account attacker. **Entry**: Google auth. **Boundary**: recovery policy.
- **Mitigation**: same as (11); step-up for sensitive ops; no merge-by-email. **Detection**: audit. **Recovery**: revoke-all; unlink the compromised method (if not final). **Residual**: **(follow-up)** provider wiring. **Evidence**: ADR-0010.

### 13. Base Account signature replay
- **Asset**: wallet link / Base login. **Actor**: attacker replaying a signature. **Entry**: link/base complete. **Boundary**: challenge store.
- **Mitigation**: single-use nonce, domain/URI/chain binding, validity window, server-built message, atomic consume. **Detection**: consume returns null on replay. **Recovery**: challenge expiry. **Residual**: none for the wired EOA path. **Evidence**: `walletLink.service.test.ts` (consumed-replay, replay-after-restart).

### 14. ERC-1271 / 6492 verification failure
- **Asset**: correctness of smart-account ownership. **Actor**: n/a (correctness risk). **Entry**: link complete (smart account). **Boundary**: verifier adapter.
- **Mitigation**: separate `SmartAccountSignatureVerifier`; never assume `verifyMessage` covers all wallets; fail-closed default rejects until a real verifier is wired. **Detection**: invalid result. **Recovery**: n/a. **Residual**: **(follow-up)** real ERC-1271/6492 verifier needs RPC. **Evidence**: `walletLink.service.test.ts` (fail-closed default; verifier-double path).

### 15. Wallet-link replay
- **Asset**: wallet-ownership claim. **Actor**: attacker. **Entry**: link complete. **Boundary**: challenge store. **Mitigation/Detection/Recovery**: as (13). **Residual**: none. **Evidence**: `walletLink.service.test.ts`.

### 16. Duplicate wallet ownership
- **Asset**: exclusive wallet ownership. **Actor**: attacker claiming a victim's address. **Entry**: link complete. **Boundary**: `wallets` constraints.
- **Mitigation**: `wallets_verified_address_unique` — a verified address maps to one user; second user rejected; same user idempotent. **Detection**: unique-violation → typed error. **Recovery**: n/a. **Residual**: none. **Evidence**: `walletLink.service.test.ts` + Postgres constraint validation.

### 17. Active-wallet switching during pending operations
- **Asset**: consistency of a pending sensitive op. **Actor**: user/attacker mid-operation. **Entry**: `/wallets/active`, `/wallets/revoke`. **Boundary**: policy hook.
- **Mitigation**: `WalletChangePolicy` blocks switch/revoke while flagged → `wallet_operation_locked` + audit. **Detection**: `security_policy_denied`. **Recovery**: retry after the op clears. **Residual**: policy source not yet populated by a settlement subsystem (boundary provided). **Evidence**: `walletLink.service.test.ts` (policy denial).

### 18. Provider webhook replay
- **Asset**: default-wallet uniqueness. **Actor**: attacker/replayed webhook. **Entry**: provisioning. **Boundary**: `wallets` constraint + state machine.
- **Mitigation**: idempotent `request()`/`provision()`; `wallets_embedded_per_user_provider_unique`; provider replay returns same address. **Detection**: unique-violation backstop. **Recovery**: converge on existing row. **Residual**: **(follow-up)** real webhook signature verification when a provider is wired. **Evidence**: `walletProvisioning.service.test.ts`.

### 19. Wallet provisioning race
- **Asset**: single default wallet. **Actor**: concurrency. **Entry**: concurrent signup/provision. **Boundary**: DB.
- **Mitigation**: unique constraint + idempotent request; active-set-once. **Detection**: constraint. **Recovery**: converge. **Residual**: none. **Evidence**: `walletProvisioning.service.test.ts` (concurrent requests, active-set-once).

### 20. Embedded-wallet provider outage
- **Asset**: wallet availability. **Actor**: n/a. **Entry**: provision. **Boundary**: provider adapter.
- **Mitigation**: transient vs terminal failure states; safe retry; sign-in not blocked by provisioning. **Detection**: `wallet_provisioning_failed` audit + `provisioningState`. **Recovery**: `retry()` for transient; support path for terminal. **Residual**: prolonged outage delays wallet creation (observable). **Evidence**: `walletProvisioning.service.test.ts` (transient retry, terminal observability).

### 21. Malicious/compromised support operator
- **Asset**: accounts + funds. **Actor**: insider. **Entry**: support tooling. **Boundary**: recovery policy + custody.
- **Mitigation**: no support-only recovery; no email-only override; non-custodial (support can't move funds). **Detection**: immutable audit. **Recovery**: n/a (prevented). **Residual**: insider with DB write access (mitigated by non-custody; audit). **Evidence**: ADR-0010, ADR-0008.

### 22. Telemetry leakage
- **Asset**: secrets/PII in logs. **Actor**: log reader / analytics. **Entry**: audit/log writes. **Boundary**: audit service.
- **Mitigation**: audit redaction (secret-shaped keys and non-scalars stripped; raw email blocked); no OTP/token/signature logged. **Detection**: redaction test. **Recovery**: n/a. **Residual**: a new call site logging directly (linting/review). **Evidence**: `securityControls.test.ts` (redaction), `audit.service.ts`.

### 23. Seed-phrase / private-key phishing
- **Asset**: wallet secret. **Actor**: phisher. **Entry**: any input; support. **Boundary**: non-custodial boundary.
- **Mitigation**: MovenRun never accepts secrets (strict schemas + `assertNoSecretShapedInput`); UI states support never asks for a recovery phrase; export is provider-isolated with anti-phishing copy. **Detection**: prohibited-input rejection. **Recovery**: n/a. **Residual**: user phished off-platform (education only). **Evidence**: `router.test.ts` (secret-shaped input rejected), `security.tsx`/`wallets.tsx` copy.

### 24. Dependency compromise
- **Asset**: build/runtime integrity. **Actor**: malicious package. **Entry**: dependency tree. **Boundary**: install/CI.
- **Mitigation**: no new runtime dependency added (uses `zod`/`ethers`/`drizzle`/`express`/`pg` already present); committed lockfile; `yarn install --immutable`; least-privilege CI. **Detection**: lockfile diff; CI. **Recovery**: pin/rollback. **Residual**: existing-stack supply chain (out of PR scope). **Evidence**: PR "dependency changes" (none); `yarn install --immutable` in CI.

### 25. Insecure development/test bypass reaching production
- **Asset**: production auth integrity. **Actor**: n/a (process risk). **Entry**: code. **Boundary**: import boundary + fail-closed config.
- **Mitigation**: no production import of test doubles (guard test); no hard-coded test user; provider-dependent flows fail closed; dev-only pepper fallback is impossible in production (required there). **Detection**: guard test; `config.test.ts`. **Recovery**: n/a. **Residual**: none identified. **Evidence**: `securityControls.test.ts` (import boundary), `config.test.ts` (fail-closed).

---

## PR #51 additions — provider webhooks, secure mobile storage, configuration

Scope: `backend/src/identity/{providerConfig.ts,webhooks/**}`, `provider_events`,
`mobile/src/lib/secureSession*`. Real authentication and wallet provisioning
remain disabled (ADR-0011 Blocked); these threats cover the newly-added
surfaces. Format as above: asset · actor · entry · boundary · mitigation ·
detection · recovery · residual · evidence.

### 26. Webhook forgery
- **Asset**: identity/wallet state transitions. **Actor**: remote attacker. **Entry**: `POST /identity/webhooks/provider`. **Boundary**: HMAC verifier.
- **Mitigation**: HMAC-SHA-256 over raw bytes with domain-separation context; timing-safe compare; disabled mode fails closed (503). **Detection**: `webhook_rejected` audit (reason class). **Recovery**: n/a (prevented). **Residual**: key theft (see 29). **Evidence**: `hmacVerifier.test.ts`, `router.test.ts`.

### 27. Webhook replay
- **Asset**: duplicate side effects. **Actor**: attacker replaying a captured valid delivery. **Entry**: webhook route. **Boundary**: `provider_events` uniqueness + timestamp window.
- **Mitigation**: unique `(provider, providerEventId)` — replay converges on the same row (idempotent 200, no second side effect); bounded timestamp skew limits the replay window. **Detection**: `webhook_duplicate` audit. **Recovery**: n/a. **Residual**: replay inside the skew window of a not-yet-delivered id is just first delivery. **Evidence**: PG race evidence (200 racing ingests → 1 insert), `eventService.test.ts`.

### 28. Timestamp bypass
- **Asset**: replay window integrity. **Actor**: attacker with stale/future-dated signed payloads. **Entry**: webhook headers. **Boundary**: verifier clock check.
- **Mitigation**: timestamp is bound INSIDE the signed message; stale and future both rejected beyond max skew (default 300 s); server-authoritative clock. **Detection**: `stale_timestamp`/`future_timestamp` classes. **Recovery**: n/a. **Residual**: none. **Evidence**: `hmacVerifier.test.ts`.

### 29. Signing-key compromise
- **Asset**: webhook trust. **Actor**: attacker holding a leaked key. **Entry**: webhook route. **Boundary**: key config + rotation.
- **Mitigation**: rotation with bounded previous-key overlap; emergency closure via the webhook gate; keys ≥32 chars, never logged. **Detection**: anomalous accepted-event patterns; audit trail. **Recovery**: rotate (docs/KEY_ROTATION.md incident procedure). **Residual**: window between compromise and rotation. **Evidence**: `providerConfig.test.ts` (bounded overlap enforced), rotation runbook.

### 30. Provider-event ID collision / same-id payload swap
- **Asset**: event integrity. **Actor**: buggy/malicious/compromised provider reusing ids. **Entry**: ingestion. **Boundary**: DB uniqueness + digest check.
- **Mitigation**: collision = duplicate → idempotent no-op; a same-id delivery with a DIFFERENT payload digest is actively flagged as a **security anomaly** (`webhook_rejected`/digest_mismatch audit, stable 409) rather than silently accepted, and the first delivery's content stays authoritative. **Detection**: `webhook_rejected` (digest_mismatch) audit — distinct from `webhook_duplicate`. **Recovery**: provider-side investigation; the reused id is never reprocessed with new content. **Residual**: a colliding FIRST delivery wins — inherent to provider-scoped ids. **Evidence**: `eventService.test.ts` (digest-mismatch anomaly), `router.test.ts` (409).

### 31. Duplicate / out-of-order delivery
- **Asset**: state-machine integrity. **Actor**: at-least-once provider delivery. **Entry**: ingestion/processing. **Boundary**: state machine CAS.
- **Mitigation**: idempotent ingest; conditional lifecycle transitions (settled states refuse late calls); handlers go through domain services whose invariants are order-safe. **Detection**: audit trail. **Recovery**: redelivery absorbs gaps. **Residual**: none identified. **Evidence**: `eventService.test.ts` (out-of-order test), PG evidence.

### 32. Body tampering / raw-body loss / parser differential
- **Asset**: verified-content integrity. **Actor**: MITM/proxy/middleware. **Entry**: request body path. **Boundary**: raw-body route.
- **Mitigation**: dedicated `express.raw` mount BEFORE (and excluded from) the JSON parser — the verifier sees the exact received bytes; signature verified before parsing; single JSON.parse after verification (no dual-parser differential). **Detection**: `bad_signature` on tamper. **Recovery**: n/a. **Residual**: none. **Evidence**: `hmacVerifier.test.ts` (tamper), `router.test.ts` (raw handling, 415 on wrong content type).

### 33. Oversized-payload DoS
- **Asset**: service availability. **Actor**: attacker posting huge bodies. **Entry**: webhook route. **Boundary**: body limit.
- **Mitigation**: explicit 256 KB raw-body limit → stable 413; app-wide 2 MB limit elsewhere. **Detection**: 413 rate. **Recovery**: n/a. **Residual**: volumetric DoS is an edge/infra concern. **Evidence**: `router.test.ts` (413).

### 34. Stale processing lease / zombie worker
- **Asset**: event liveness + single-processor invariant. **Actor**: crashed or slow worker. **Entry**: processing. **Boundary**: lease CAS + lease token.
- **Mitigation**: leases expire and expired-lease events are atomically reclaimable; live leases block second claims; **each claim mints a fresh lease token and every settle transition matches on that token**, so a slow worker whose lease was reclaimed cannot mark the event processed/terminal/etc. over the newer claim (stale-token settle matches zero rows). **Detection**: attempts counter; stale settle returns null. **Recovery**: automatic reclaim; the newer claim owns settlement. **Residual**: a handler side effect already committed to an EXTERNAL system before the lease-token settle is refused would still have happened once — bounded by requiring handlers to bind mutations to the provider event id / be idempotent (the empty production allowlist means no such handler runs today). **Evidence**: `eventService.test.ts` (lease-token/generation guard, transition table) + real-PG zombie-worker test (25 trials: stale settle refused, current wins).

### 35. Malicious / unknown event type
- **Asset**: processor integrity. **Actor**: attacker or new provider feature. **Entry**: verified event. **Boundary**: explicit allowlist.
- **Mitigation**: unknown types are durably stored, marked `ignored`, audited — never executed; the production allowlist is empty until provider semantics land. **Detection**: `provider_event_ignored` audit. **Recovery**: reprocess after allowlisting (still bounded by state machine). **Residual**: none. **Evidence**: `eventService.test.ts`.

### 36. Provider-account compromise (sender side)
- **Asset**: everything the provider can assert. **Actor**: attacker controlling the provider account. **Entry**: validly-signed webhooks. **Boundary**: domain services.
- **Mitigation**: handlers cannot bypass domain invariants (single wallet owner, ownership scoping); no webhook can persist secret material; blast radius bounded by the empty allowlist today. **Detection**: audit trail of all transitions. **Recovery**: disable webhook gate; rotate provider credentials. **Residual**: with a real provider, validly-signed events are trusted to the extent the domain layer allows — inherent. **Evidence**: `eventService.test.ts` (wrong-user rejection).

### 37. Provider outage
- **Asset**: auth/wallet availability. **Actor**: n/a. **Entry**: provider calls/webhooks. **Boundary**: fail-closed adapters.
- **Mitigation**: all provider flows already fail closed; webhook redelivery + idempotent ingest recover the stream; readiness reports disabled features honestly and performs no live provider call. **Detection**: rejection rates, readiness. **Recovery**: automatic on provider recovery. **Residual**: unavailability during outage (accepted). **Evidence**: `router.test.ts` (disabled 503), KEY_ROTATION.md.

### 38. Secure-store extraction (device compromise / rooted device)
- **Asset**: persisted session tokens. **Actor**: attacker with device access. **Entry**: OS keystore. **Boundary**: platform keystore.
- **Mitigation**: tokens live only in Keystore/Keychain (never AsyncStorage/Zustand — guard-tested); short access TTL; refresh rotation with family revocation; revoke-all + security-version kill switch. **Detection**: refresh-replay detection server-side. **Recovery**: sign out everywhere. **Residual**: a rooted device weakens keystore guarantees — bounded by token lifetimes and server-side revocation. **Evidence**: `secureSession.test.ts` guards; PR #50 session tests.

### 39. Secure-store unavailability / local session corruption
- **Asset**: session integrity. **Actor**: OS/storage faults. **Entry**: keystore reads. **Boundary**: fail-closed core.
- **Mitigation**: read failure → treated as signed-out (deny); malformed/expired data deleted, never returned; write/clear failures propagate — nothing silently succeeds; no insecure fallback exists (registry throws uninstalled). **Detection**: surfaced errors. **Recovery**: re-authenticate. **Residual**: none. **Evidence**: `secureSession.test.ts` (unavailable, malformed, expired, write/clear failure, no-fallback).

### 40. App downgrade
- **Asset**: stored session format integrity. **Actor**: user installing an older build. **Entry**: versioned storage key. **Boundary**: key versioning.
- **Mitigation**: `movenrun.session.v1` — an older build reading a future format treats it as malformed and deletes it (fail closed → re-auth); format changes bump the version with a documented migration. **Detection**: n/a. **Recovery**: re-authenticate. **Residual**: none. **Evidence**: ADR-0012, malformed-deletion test.

### 41. Secret-rotation failure / development credentials in production
- **Asset**: production trust anchors. **Actor**: operator error. **Entry**: configuration. **Boundary**: strict config validation.
- **Mitigation**: production startup fails closed on missing/short secrets, unknown providers, http URLs, debug/tunnel hosts, wildcard redirects, or an unbounded previous key; no dev fallback exists in production paths; errors name fields, never values. **Detection**: startup failure; `config_invalid` audit hook. **Recovery**: fix config, redeploy (rollback is config-only). **Residual**: none identified. **Evidence**: `providerConfig.test.ts` (13 cases), `config.test.ts`.

### 42. Redirect misconfiguration
- **Asset**: future OAuth code delivery. **Actor**: attacker exploiting a loose redirect. **Entry**: redirect origins config. **Boundary**: exact-origin allowlist.
- **Mitigation**: exact https origins only — wildcards, paths, queries, and http (non-loopback) all rejected at config time, before any provider exists to misuse them. **Detection**: config validation. **Recovery**: fix config. **Residual**: none until a provider is wired; re-verify then. **Evidence**: `providerConfig.test.ts`.

## PR #53 additions — session & device management

New attack surface introduced by the session inventory, per-session
revocation, and revoke-others endpoints, plus the device label. Each entry:
asset · attacker · precondition · attack · impact · controls · detection ·
residual risk · evidence.

### 43. Session-ID enumeration
- **Asset**: existence/metadata of other users' sessions. **Attacker**: any authenticated user probing `/sessions/:id/revoke` with guessed or harvested ids. **Precondition**: a valid account of their own. **Attack**: sweep well-formed ids and read responses as an oracle. **Impact**: confirming a session exists (reconnaissance for targeted attacks).
- **Controls**: session ids are random UUIDs (nothing sequential to sweep); ownership is inside the conditional UPDATE, so foreign and nonexistent ids return byte-identical 404s; malformed ids get a stable 400 before any lookup; no bulk arbitrary-ID lookup exists. **Detection**: audit trail of revocation attempts per user. **Residual**: response-timing differences bounded by normal DB behavior (not intentionally data-dependent). **Evidence**: `router.test.ts` (identical 404 bodies), `sessionManagement.test.ts` (foreign = nonexistent), PG evidence R1.

### 44. Cross-user session revocation (IDOR)
- **Asset**: other users' session availability. **Attacker**: authenticated user substituting another user's session id in the path. **Precondition**: a leaked/guessed victim session id. **Attack**: `POST /sessions/<victim-id>/revoke`. **Impact**: denial of service against the victim (forced sign-out).
- **Controls**: the bearer's userId is bound into the UPDATE's WHERE clause — a path id can never widen authorization; list endpoint queries by owner only. **Detection**: `not_found` outcomes in audit. **Residual**: none identified. **Evidence**: `router.test.ts` (foreign 404, victim session unaffected), `memory.test.ts` + PG evidence (ownership-scoped transitions).

### 45. Device-label injection
- **Asset**: UI integrity and log hygiene. **Attacker**: malicious client sending a crafted `deviceLabel` at login. **Precondition**: ability to call the API directly. **Attack**: control characters, ANSI escapes, overlong strings, or misleading text ("Support — tap here"). **Impact**: log spoofing or misleading session lists.
- **Controls**: server sanitization (whitespace collapse, control chars rejected, 64-char cap, generic fallback); the label is never trusted for authorization and never written to audit metadata; the UI re-sanitizes before display; React Native renders text, not markup. **Detection**: n/a (rejected at write). **Residual**: a plausible-but-false label ("iPhone" from a script) — labels are display hints, never evidence. **Evidence**: `deviceLabel.test` cases in `sessionManagement.test.ts` (backend) and mobile `sessionManagement.test.ts`.

### 46. Stale-session UI
- **Asset**: correctness of the user's security decisions. **Attacker**: n/a (integrity hazard) or an attacker relying on the victim seeing stale state. **Precondition**: cached list after network loss or app suspend. **Attack**: user believes a device was signed out (or still is) when it wasn't. **Impact**: wrong security posture; missed compromise.
- **Controls**: the list re-fetches after every server-confirmed action (no optimistic deletion), on app resume, and on pull-to-refresh; transient failures keep the last confirmed list but surface an explicit error state; sessions are never fabricated locally. **Detection**: error banner in UI. **Residual**: staleness within one refresh interval while backgrounded. **Evidence**: mobile `sessionManagement.test.ts` (re-list after revoke, retained-list-on-error, no fabrication).

### 47. Revoke/refresh race
- **Asset**: revocation finality. **Attacker**: stolen-refresh-token holder racing the victim's revoke-others/revoke-all. **Precondition**: attacker holds a valid refresh token and times the request. **Attack**: refresh concurrently with revocation so the freshly minted session escapes the sweep. **Impact**: a "revoked" family stays usable — revocation silently fails.
- **Controls**: refresh re-reads its old session after minting; if revoked meanwhile, the whole family (including the new session) is revoked and the refresh fails closed; sweeps match `revoked_at IS NULL`, covering rotated chain links; revoke-all additionally bumps `securityVersion`. **Detection**: `session_revoked` audit with `raceGuard: refresh_vs_revocation`. **Residual**: none found across interleavings. **Evidence**: `session.service.test.ts` (interposed race), PG evidence R3/R4 (10 rounds each, 0 escapes/survivors).

### 48. Lost device (updated for session management)
- **Asset**: the sessions on the lost device. **Attacker**: finder/thief with the unlocked device. **Precondition**: device loss before revocation. **Attack**: use the app's live session. **Impact**: account access until revoked.
- **Controls**: the victim can now revoke *just that device* from the inventory (per-session revoke) or "Sign out other devices" — no longer only the all-or-nothing revoke-all; revocation invalidates the device's access tokens immediately (live-row check) and its refresh token permanently. **Detection**: inventory shows the unfamiliar session's label and last-used time. **Residual**: window before the user notices; coarse labels may make the device hard to identify. **Evidence**: `router.test.ts` (revoked bearer 401s immediately), PG evidence R5.

### 49. Stolen refresh token (updated for session management)
- **Asset**: session family continuity. **Attacker**: holder of an exfiltrated refresh token. **Precondition**: token theft (e.g. device backup, malware). **Attack**: refresh in parallel with the legitimate device, or race a revocation (see 47). **Impact**: persistent account access.
- **Controls**: rotation + reuse detection revokes the family on replay; per-session revoke and revoke-others now let the user kill the stolen family specifically; the race guard prevents revocation escapes; revoked sessions cannot refresh (`refresh_reuse_detected`). **Detection**: `refresh_replay_detected` audit; unfamiliar session in the inventory. **Residual**: an attacker refreshing *faster* than the victim revokes rotates the family but stays visible in the inventory as the same session lineage. **Evidence**: `session.service.test.ts` (replay, concurrent refresh), PG evidence R5.

### 50. Misleading session metadata
- **Asset**: the user's trust in the inventory. **Attacker**: attacker whose session hides among legitimate ones. **Precondition**: an attacker-held session (from any prior compromise). **Attack**: blend in via a familiar-looking self-reported label and plausible timestamps. **Impact**: the victim fails to revoke the attacker's session.
- **Controls**: timestamps (`issuedAt`, `lastUsedAt`, `expiresAt`, `revokedAt`) are server-recorded and cannot be forged by the client; the label is the only client-influenced field and is sanitized; the current session is flagged server-side, so an attacker session can never masquerade as "this device"; when in doubt, revoke-others/revoke-all end everything else regardless of labels. **Detection**: user review of the inventory. **Residual**: labels remain self-reported — documented as display hints. **Evidence**: `sessionManagement.test.ts` (server-authoritative `isCurrent`, public-field exclusion), `router.test.ts`.
