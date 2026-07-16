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
