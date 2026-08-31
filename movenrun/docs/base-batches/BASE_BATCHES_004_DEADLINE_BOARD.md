# Deadline board — through 9 September

Three tracks that run in parallel. Track C is the long pole: recruiting real
people takes calendar time that no amount of engineering shortens.

Deliberate slack before the deadline. Nothing lands on the 9th.

---

## Track A — technical

| # | Task | Owner | Blocked by |
|---|---|---|---|
| A1 | Review and merge #73 | you | verdict below — integration proven clean |
| A2 | Stand up an environment with Base RPC egress | you | — |
| A3 | Configure deployer + oracle keys **there** | you | A2 |
| A4 | Create/confirm admin Safe (mainnet needs contract code) | you | — |
| A5 | Run backend with `DATABASE_URL`, migrations through 0003 | you | A1 |
| A6 | Deploy to Base Sepolia | me, on your go | A2–A4 |
| A7 | Verify source on Basescan | me | A6 |
| A8 | First real Sepolia claim by a real participant | you + me | A6, C4 |
| A9 | Negative proofs on Sepolia: replay, duplicate, expiry | me | A8 |
| A10 | Human review of Sepolia evidence | you | A9 |
| A11 | Mainnet approval gate — I stop and wait | you | A10 |
| A12 | Mainnet deploy, verify, role-check | me, on explicit approval | A11 |
| A13 | First mainnet claim — only if a genuine participant is ready | you + me | A12, C5 |

**A1 unblocks A5, which unblocks everything about a real pilot.** Do it first.

## Track B — application

| # | Task | Owner | Blocked by |
|---|---|---|---|
| B1 | Fill in `FOUNDER_INPUTS_REQUIRED` | you | — |
| B2 | Paste founder answers into the application draft | me | B1 |
| B3 | Record the 2-minute video | you | — |
| B4 | Fill evidence placeholders as facts land | me | A6/A12/A13 |
| B5 | Final pass against the safe-claims matrix | me | B2, B4 |
| B6 | Submit | you | B5 |

**B1 and B3 are not blocked by anything.** They can be done today and are the
most common reason applications go in late.

## Track C — people

| # | Task | Owner | Blocked by |
|---|---|---|---|
| C1 | Draft your shortlist of real candidates | you | — |
| C2 | Send the recruitment message | you | C1 |
| C3 | Collect wallet **addresses** (never keys) | you | C2 |
| C4 | Confirm each has gas on the target network | you | C3 |
| C5 | Schedule the actual walks/runs | you | C3 |
| C6 | Record each claim in the tracker | you + me | A8/A13 |

---

## Suggested shape

- **Now → +2 days.** B1, B3, C1–C2 (nothing blocks these). A1 review. A2 arranged.
- **+2 → +5 days.** A3–A5. C3–C4. Sepolia deploy A6–A7.
- **+5 → +8 days.** A8–A10, first real claims. B2, B4.
- **+8 → +10 days.** A11–A13 if the Sepolia evidence justifies it.
- **Final 2 days.** B5, B6. No deployments, no new participants, no code.

## Not in scope before the deadline

Mobile PR integration, observability, Kubernetes, sharding, multi-region, PvP,
clubs, governance, staking, seasons, gear, embedded wallets, sponsored gas,
mainnet MOVE, and the guard-suite mutation audit. All recorded, all after.

## If time runs out

Ship the smaller true story. A tested registry deployed to Sepolia with three
real holders is a better application than a mainnet address with fifteen
project-controlled wallets behind it, and it is the version that survives
someone actually checking.
