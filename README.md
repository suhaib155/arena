# MovenRun

**A GPS territory game you play by moving.** Walk or run through the real world,
capture the map tiles you pass through, hold them against other players, and own
the ground you cover.

The whole product is one loop:

> **Move → Capture → Defend → Own**

Everything in this repository exists to serve that loop. If a feature doesn't
advance it, it doesn't ship.

---

## What's here

This is a Yarn 4 workspace monorepo. Everything lives under [`movenrun/`](movenrun/).

| Workspace | What it is | State |
| --- | --- | --- |
| [`mobile/`](movenrun/mobile) | The Expo React Native app | Active — the app you run |
| [`backend/`](movenrun/backend) | Express API, BullMQ workers, Drizzle ORM | Active — GPS, zones, battles, sessions |
| [`contracts/`](movenrun/contracts) | Hardhat + Solidity | **Deployed to Base Sepolia** |
| [`shared/`](movenrun/shared) | Types and constants used by all of the above | Active |
| [`website/`](movenrun/website) | Marketing site | Active |
| [`docs/`](movenrun/docs) | Product scope, audits, architecture | Read before scope decisions |

Two directories are deliberately parked, not dead — do not delete them:

- `movenrun/mobile/_legacy/` — the GPS/map/wallet scaffold the territory build
  will draw from.
- `movenrun/contracts/deployments/` — the record of what is live on Base Sepolia.

## Run the app

Requires Node 20+ and Corepack (`corepack enable`).

```bash
cd movenrun
yarn install
yarn workspace @movenrun/mobile start
```

Scan the QR code with **Expo Go for SDK 51** on Android. Full device-testing
notes are in [`movenrun/mobile/README.md`](movenrun/mobile/README.md).

```bash
yarn workspace @movenrun/mobile lint   # tsc --noEmit
yarn workspace @movenrun/mobile test   # node --test
```

For an installable Android APK, run the **EAS APK Build** workflow from the
Actions tab. It needs one secret, `EXPO_TOKEN`, and nothing else.

## How the app is organised

The mobile app is deliberately shallow — screens read state, pure functions
decide what to show, and services own the outside world.

```
mobile/
  app/          Expo Router routes. One file = one screen. No business logic.
  src/
    components/ Presentational only. Card, TaskRow, TaskHero, StatTrio, …
    lib/        Pure functions. No React, no I/O — this is where decisions live.
    services/   Everything that talks to the outside world (API, GPS, storage).
    store/      Zustand state. Two stores: game progress and auth session.
    theme.ts    Every colour, space, radius, shadow and type style.
```

**The rule that keeps it understandable:** a screen never decides anything. It
calls one function from `lib/`, gets back a plain object, and renders it. That
is why the logic is testable without a simulator — the test suite runs on plain
Node in about four seconds.

`src/lib/tasks.ts` is the clearest example. Home shows a list of tasks; one
pure function builds that list; a test file pins its behaviour.

## Guardrails

These are hard limits, not preferences.

- **No liquid token economy** ships before reliable GPS verification, real tile
  density, and genuine sponsor demand. In-app rewards are XP and Locked MOVE —
  progress, not payouts.
- **Audit before touching contracts.** The Base Sepolia deployment is a
  production asset. Never re-deploy casually.
- **No new dependencies casually**, and no wallet connection or token rewards
  ahead of the phases above.
- **Feature branches and pull requests** — never commit straight to `main`.

## Documentation

- [`docs/ROADMAP.md`](movenrun/docs/ROADMAP.md) — canonical product scope. Read
  this before any scope decision.
- [`docs/ARCHITECTURE.md`](movenrun/docs/ARCHITECTURE.md) — contract interaction
  and oracle flow.
- [`docs/CONTRACTS_AUDIT.md`](movenrun/docs/CONTRACTS_AUDIT.md) — what is
  deployed, where, and at which transaction.
- [`docs/MOBILE_TO_TERRITORY_PLAN.md`](movenrun/docs/MOBILE_TO_TERRITORY_PLAN.md)
  — how the app grows into the full territory loop.
- [`docs/TOKENOMICS.md`](movenrun/docs/TOKENOMICS.md) — emission and burn sinks.
- [`docs/THREAT_MODEL.md`](movenrun/docs/THREAT_MODEL.md) and
  [`docs/SECURITY_CHECKLIST.md`](movenrun/docs/SECURITY_CHECKLIST.md).

## Continuous integration

| Workflow | Runs on |
| --- | --- |
| `mobile-checks` | Every PR and push to `main` |
| `backend-checks` | PRs touching `backend/`, `shared/`, or the deployment record |
| `contracts-checks` | PRs touching `contracts/` or `shared/` — compile and test only, never deploys |
| `eas-apk-build` | Manual dispatch only |

None of them require secrets except the APK build.
