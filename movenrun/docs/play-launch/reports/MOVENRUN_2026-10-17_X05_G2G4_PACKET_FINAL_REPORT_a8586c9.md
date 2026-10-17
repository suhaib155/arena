# MovenRun 17 Oct 2026: X-05 and G2–G4 packet report

Code commit: a8586c9 (website release candidate, the last code commit in
this packet). Nothing was enabled, published, merged or deployed. Live
account limits were not changed.

## PR heads

| PR | Branch | Head | State |
|---|---|---|---|
| #112 | `security/a10-single-use-google-exchange` | 2192de6 (code), board on top | Live on staging as X-27 |
| #113 | `web/a09-strict-csp` | b20f5ed | Draft |
| #116 | `web/a5-website-repairs` | a8586c9 | Draft, release candidate |
| #114 | `feat/g2-holding-model` | 97bbc0b | Draft |
| #117 | `feat/g2-holding-ledger` | bf13031 | Draft |
| #118 | `feat/g3-strength-settlement` | 8b9b3fa | Draft |
| #119 | `feat/g4-clubs-districts` | 8f83339 | Draft |
| #120 | `feat/sim-pilot-ruleset` | e6cfe42 | Draft, simulation only |
| #115 | `privacy/a2-android-backup-off` | 058c27c | Draft |

## Evidence

- E-69: X-05 reconfirmed read only; Pages URL 404; apex 200; www 308.
- E-70: two-network rate-limit check PASS.
- E-71: #115 tests 914/914; QA0 and free EAS prep.
- E-72: stack fix #114–#119; #120 simulation, shared 233/233.
- E-73: website release candidate; e2e 24/24, axe 0 violations, backend
  290/290.

## X-05 decision: BLOCKED

The prerequisites pass (E-69, E-70). The open blocker is that the pilot's
web sign-in and deletion checks need X-21 published. Other open items:

- the hook switch rests on the owner's 16 Oct confirmation;
- the quota-refusal test needs the owner's approval for a bounded limit
  change and its immediate restoration;
- or the cap must be reached naturally.

## Website readiness for X-21

Release candidate a8586c9. Before approval the owner needs to:

1. send a test mail to info@movenrun.xyz;
2. fill the Supabase publishable key and run `check-launch-placeholders`;
3. wait for the Vercel quota to reset;
4. review #108, #113 and #116, then approve that SHA.

## D1–D23 pilot values and findings

The values are in `docs/SIM_PILOT_RULESET.md` on #120. They are proposals,
not decisions.

**Main finding: ground churns very fast.**

- There are 217.6 flips per 100 held units per day.
- Only 0.24 of casual players still hold ground at day 90.
- No D2–D23 setting moves that by more than 0.05.
- The drivers are A9 (one solid push flips fresh ground) and density.
- The levers are A9, D9 (fortify) and D5 (unit size).

**Credits are set by the ceilings, not the pool.** The season issued 2.6%
of the pool.

## Next safe packet

- Owner-approved X-21 publish of a8586c9 plus the key.
- The X-05 pilot per `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md`.
- A9 and D9 churn variants in the simulator.
- Fixes for the three minor model notes on #119 and #120.
