# ADR-0001 — Canonical MovenRun identity

Status: Accepted · Scope: identity foundation (PR: security-identity-wallet-foundation)

## Context

MovenRun must support multiple sign-in methods (email OTP, Google, Base
Account) and multiple wallets per person, while never fragmenting a person into
several profiles or accidentally merging two people into one.

## Decision

The permanent identity is the row in `users` (`users.id`). Everything else —
email addresses, Google `sub`s, Base Accounts, embedded wallets, external
wallets — is a **linked authentication or signing method** keyed to that user,
never a profile in its own right.

- Auth methods live in `auth_identities`, keyed by `(provider, providerSubject)`
  with a **partial unique index on active rows** so one provider identity maps
  to exactly one user; revoked rows are retained for audit without blocking a
  future re-link.
- Resolution is by `(provider, providerSubject)` **only** — never by email.
  `IdentityService.authenticate` is idempotent and concurrency-safe: repeated or
  concurrent provider callbacks converge on one user, and first-time creation is
  atomic (`createUserWithIdentity`) so a lost race re-resolves to the winner
  rather than leaving an orphan user.
- Two auth methods that share an email do **not** merge. Linking is always an
  explicit, authenticated, recently-verified action (ADR uses step-up).

## Consequences

- No "same email ⇒ same account" magic — this is the primary defense against
  account-link hijacking and cross-provider collision.
- Switching wallets or adding/removing an auth method never changes the
  canonical `userId`, so rewards, progression, and ownership history stay put.
- Merging two real users later (if ever desired) is a deliberate, audited
  operation, not an emergent side effect.

## Evidence

`identity.service.test.ts` (idempotency, concurrency, provider-subject
collision, no-silent-merge), `memory.test.ts` and the Postgres migration
constraint checks (active-unique on `(provider, providerSubject)`).
