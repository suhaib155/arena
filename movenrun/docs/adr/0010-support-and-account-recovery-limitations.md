# ADR-0010 — Support and account-recovery limitations

Status: Accepted · Scope: recovery / support policy

## Context

Account recovery is a classic attack surface: "compromised email + helpful
support" is how many accounts (and wallets) get stolen. Our recovery model must
be safe against a malicious or compromised support operator.

## Decision

- **No support-only recovery.** Support staff alone can never complete a
  recovery, re-point an identity, or move funds. There is no email-only override.
- **Recovery requires the user's cryptographic/possession factors**, not just
  knowledge of an email address. Adding/removing a login method and authorizing
  export all require an authenticated, recently-verified session (step-up).
- **Final login method is protected**: `unlinkIdentity` refuses to remove a
  user's last viable login/recovery method (`final_login_method`), preventing
  self-lockout and a class of takeover-then-lockout attacks.
- **Removing a login method is a material security event**: it revokes all of
  the user's sessions (and bumps `securityVersion`).
- **Immutable audit trail**: every sensitive transition (link/unlink, recovery
  method change, session revoke, replay detection, export begin, policy denial)
  is recorded append-only, with secrets redacted.
- Wallet custody is non-custodial (ADR-0008), so even a fully compromised
  support tool cannot move user funds.

## Consequences

- Some genuinely-locked-out users cannot be recovered by support fiat — this is
  the intended trade-off for not being trivially social-engineerable. A future
  self-service, multi-factor recovery flow (not support-driven) is the path to
  improve this without weakening the boundary.

## Evidence

`identity.service.test.ts` (final-method refusal, unlink revokes sessions),
`securityControls.test.ts` (audit events on sensitive transitions), audit
redaction tests.
