# Summary

<!-- What changed, and why. One or two paragraphs. -->

## Scope

- **Workspace(s):** <!-- mobile / backend / contracts / shared / website / docs / ci -->
- **Roadmap link:** <!-- which part of Move → Capture → Defend → Own this serves -->

## Verification

<!-- What you actually ran, and what it said. Delete rows that don't apply. -->

| Check | Result |
| --- | --- |
| `yarn workspace @movenrun/mobile lint` | |
| `yarn workspace @movenrun/mobile test` | |
| `yarn workspace @movenrun/backend typecheck` | |
| `yarn workspace @movenrun/backend test` | |
| `yarn verify:contracts` | |
| Manual / on-device | |

## Checklist

- [ ] No secrets, keys, tokens, or `.env` files added — including in tests and fixtures.
- [ ] Simulated, local-only, or preview behaviour is labelled as such in the UI, not only in comments.
- [ ] Documentation updated in this PR (README / `docs/` / `SECURITY_CHECKLIST.md` / ADR) where behaviour changed.
- [ ] Dependency changes are justified below and include the regenerated `yarn.lock`.
- [ ] Deployed contracts and `contracts/deployments/` are untouched, or the change is explained below.

## Out of scope / follow-ups

<!-- Anything deliberately left for later. -->
