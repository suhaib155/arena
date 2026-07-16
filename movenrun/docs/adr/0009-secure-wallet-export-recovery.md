# ADR-0009 — Secure wallet export / recovery

Status: Accepted (architecture) · Scope: wallet export

## Context

Users must eventually be able to export/recover their embedded wallet's secret,
but that secret must never pass through MovenRun.

## Decision

Export is a **provider-isolated** flow. MovenRun's role is limited to
authorizing the handoff and never seeing the secret:

- Requires **recent high-assurance re-authentication** (step-up); the export
  endpoint calls `SessionService.assertRecentAuth` before doing anything.
- Requires MFA/passkey or equivalent step-up where the provider supports it.
- The secret is revealed **only inside the provider's isolated surface** — never
  returned to MovenRun servers, clients, analytics, logs, crash reporting,
  support tooling, or API payloads.
- The client shows strong warnings about irreversible loss and phishing and
  requires explicit user confirmation; temporary export state is invalidated
  immediately afterward.
- `EmbeddedWalletProvider.beginExport` returns only a short-lived opaque handoff
  reference — never secret material.

This PR ships the **entry point and gate** only: `/wallets/export/begin`
enforces step-up, writes a `wallet_export_initiated` audit event, and then fails
closed (`provider_not_configured`) because no provider is wired. The mobile
export button shows a secure-handoff placeholder and explicit anti-phishing
copy, exposing no secret.

## Consequences

- The export UX and authorization gate exist and are testable now; wiring the
  provider surface later exposes secrets only within that surface.

## Evidence

`router.test.ts` (export begins with step-up, returns 503, leaks no secret).
