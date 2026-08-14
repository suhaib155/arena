# Contributing to MovenRun

Thanks for working on MovenRun. This document is the working agreement for the
repository: how changes get made, what has to pass before they land, and the few
rules that exist because breaking them is expensive.

## Ground rules

1. **Feature branches and pull requests only.** Never commit directly to `main`.
2. **Every feature must serve the core loop** — Move → Capture → Defend → Own.
   If a change does not advance it, it is almost certainly out of scope. The
   canonical scope document is [`movenrun/docs/ROADMAP.md`](movenrun/docs/ROADMAP.md);
   read it before making a product-scope decision.
3. **Never commit secrets.** No `.env` files, private keys, API tokens, mnemonics,
   or credentials — in code, tests, fixtures, docs, or commit messages. Use
   `.env.example` to document a variable's *shape*, never its value.
4. **Say what is true.** If a screen shows simulated data, label it. If a document
   describes something that does not exist yet, say so in the same breath. No
   feature claim, status, or number goes into the app, the site, or the docs
   unless it is accurate at the moment it ships.

## Setup

```bash
cd movenrun
corepack enable          # provisions the pinned Yarn 4.9.1
yarn install
```

The package manager is pinned by `package.json` → `packageManager` and enforced
by `scripts/verify-package-manager.mjs`. Use Yarn 4 — not npm, pnpm, or Yarn 1.
`movenrun/yarn.lock` is committed and deterministic; CI installs with
`--immutable`, so a dependency change **must** include the regenerated lockfile.

## Before you open a pull request

Run the checks for whatever you touched, from `movenrun/`:

```bash
yarn workspace @movenrun/mobile lint      # tsc --noEmit
yarn workspace @movenrun/mobile test
yarn workspace @movenrun/backend typecheck
yarn workspace @movenrun/backend test
yarn verify:contracts                     # compile + full Hardhat suite
```

CI runs the same checks. New behaviour needs a test alongside it — the mobile
tests are deliberately offline (no device, no network, no native modules), and
backend tests run on the node test runner.

## Pull requests

- Keep a PR to one coherent change. Split unrelated cleanups out.
- Fill in the pull request template: what changed, why, how it was verified, and
  anything that is deliberately out of scope.
- Update the documentation in the same PR as the behaviour it describes —
  including `movenrun/docs/`, the relevant `README.md`, and
  `movenrun/docs/SECURITY_CHECKLIST.md` when a security control changes.
- Add an ADR under `movenrun/docs/adr/` for a decision that constrains future
  work (a provider choice, a security boundary, a storage model).

### Commit messages

Conventional commits, scoped by workspace:

```
feat(mobile): add route trust review to the session summary
fix(backend): reject webhook replays outside the freshness window
docs(contracts): record the Base Sepolia verification status
```

## Areas with extra rules

### Contracts

The suite in `movenrun/contracts/` is **deployed to Base Sepolia**. Treat the
deployment as a production asset.

- Audit before changing any contract — start from
  [`docs/CONTRACTS_AUDIT.md`](movenrun/docs/CONTRACTS_AUDIT.md).
- Never re-deploy or overwrite deployed contract code casually, and never edit
  `contracts/deployments/baseSepolia.json` or the address registry in
  `shared/src/constants/contracts.ts` to anything the deployment record does not
  support.
- CI is deployment-free by design: no deployer key, no RPC secret, no Basescan
  key. Keep it that way.

### Mobile

- The app targets **Expo SDK 51**. An SDK upgrade is its own PR, made where
  `expo install --fix` and `expo-doctor` can run and the result can be tested on
  a device — never an unverified version bump.
- Anything that is simulated, local-only, or a preview must be labelled as such in
  the UI, not only in a code comment.
- Demo/fallback routes must never award progress or be saved as territory.
- No wallet signing, token transfer, or chain write ships before the roadmap
  phase that calls for it.

### Dependencies

New dependencies need a reason in the PR description. The app in particular
stays lean: no animation libraries, no analytics SDKs, and no AI provider SDKs
or keys in the client. Server-side additions still need to earn their place.

### Preserved directories

`contracts/`, `backend/`, `shared/`, and `mobile/_legacy/` are preserved, not
dead code. Do not delete them without explicit owner approval — preserve ideas by
writing them into the roadmap, not by deleting the work.

## Reporting a security issue

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
