# Security Policy

MovenRun is a development-stage project. The contract suite is deployed to
**Base Sepolia (testnet) only**, no mainnet deployment exists, and no part of the
product moves real money. Reports are still welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security
problem.**

Report privately through GitHub:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (private security advisory).
3. Include: what the issue is, where it lives (file, endpoint, contract,
   screen), how to reproduce it, and what an attacker gains.

If private advisories are unavailable to you, open a public issue that says only
that you have a security report and asks for a private channel — no details.

Expect an acknowledgement within a few days. Because this is a small,
pre-release project, there is no bounty programme and no formal remediation SLA.
Please give us reasonable time to fix an issue before disclosing it publicly.

## Scope

In scope:

- `movenrun/backend/` — the API, identity/wallet foundation, webhook ingestion,
  workers, and database layer.
- `movenrun/contracts/` — the Solidity suite and its deployment/verification
  scripts.
- `movenrun/mobile/` — the Expo app, especially session storage, token handling,
  and anything touching location data.
- `movenrun/shared/` and the CI workflows in `.github/workflows/`.

Out of scope:

- Findings that depend on a compromised device, a rooted/jailbroken phone, or
  physical access.
- Third-party infrastructure we do not control (Expo/EAS, Vercel, GitHub, public
  RPC endpoints).
- The public Base Sepolia contract addresses being public — they are testnet
  addresses, committed deliberately.
- Reports that a documented preview/simulation is not real. Simulated territory,
  club, and deed data is labelled as such by design.

## What is never in this repository

- `.env` files, private keys, mnemonics, API tokens, or credentials of any kind.
- Deployer keys, RPC secrets, or block-explorer API keys in CI — the contract
  workflow is deployment-free on purpose.
- User data. The app keeps GPS points and route paths on the device.

CI uses exactly one GitHub Actions secret, `EXPO_TOKEN`, and only in the manual
APK build workflow. If you ever see a secret in a diff, treat it as compromised:
report it privately and rotate it. Rotation procedures are documented in
[`movenrun/docs/KEY_ROTATION.md`](movenrun/docs/KEY_ROTATION.md).

## Security documentation

- [`movenrun/docs/THREAT_MODEL.md`](movenrun/docs/THREAT_MODEL.md) — assets,
  actors, attack surfaces.
- [`movenrun/docs/SECURITY_CHECKLIST.md`](movenrun/docs/SECURITY_CHECKLIST.md) —
  each control mapped to its implementation and test.
- [`movenrun/docs/KEY_ROTATION.md`](movenrun/docs/KEY_ROTATION.md) — key and
  secret rotation runbook.
- [`movenrun/docs/adr/`](movenrun/docs/adr/) — decisions on the non-custodial
  boundary, session/refresh security, secure mobile storage, and webhook
  security.
