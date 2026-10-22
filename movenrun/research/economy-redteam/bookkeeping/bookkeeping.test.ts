/**
 * Bookkeeping invariant tests for the reference G0/G3 models. Properties run
 * with the seeds in seeds.json; defect fixtures are named "documents defect: …"
 * and assert the problematic behaviour so the suite stays green while the
 * defect stands. Source code is never patched here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  dayBooksProblems,
  dayCloseCharges,
  economyRulesFor,
  sessionToll,
  settleDay,
  MICRO_PER_MOVE,
  type EconomyRules,
} from "@movenrun/shared/economy-v3";
import { newUnit } from "@movenrun/shared/holding";
import { applyLedger } from "@movenrun/shared/holdingLedger";
import { settleCreditsSeason } from "@movenrun/shared/holdingSettlement";
import { mulberry32 } from "./lib/prng";
import { HARNESS_HOLDING_RULES } from "./lib/gen";
import { PROPERTIES, RULES, runProperty, settledG3Day } from "./properties";

const manifest = JSON.parse(readFileSync(join(__dirname, "seeds.json"), "utf8")) as { properties: Record<string, { seed: number; cases: number }> };
const MOVE = (n: number) => Math.round(n * MICRO_PER_MOVE);

/** Properties whose failure is a documented defect (asserted separately below). */
const DOCUMENTED_FAILURES = new Set(["P11"]);

for (const p of PROPERTIES) {
  const m = manifest.properties[p.id];
  test(`${p.id} ${p.title}`, () => {
    assert.ok(m, `${p.id} has no seed in seeds.json`);
    assert.ok(m.cases >= 1000, `${p.id} runs at least a thousand cases`);
    const r = runProperty(p, m.seed, m.cases, mulberry32);
    if (DOCUMENTED_FAILURES.has(p.id)) return;
    assert.equal(r.failures, 0, `${p.id} seed ${m.seed}: ${r.firstFailure}`);
  });
}

test("determinism: same seed gives byte-identical property output; another seed differs", () => {
  for (const id of ["P01", "P10", "P14"]) {
    const p = PROPERTIES.find((x) => x.id === id)!;
    const a = runProperty(p, 4242, 200, mulberry32);
    const b = runProperty(p, 4242, 200, mulberry32);
    const c = runProperty(p, 4243, 200, mulberry32);
    const strip = ({ ms: _ms, ...r }: typeof a) => JSON.stringify(r);
    assert.equal(strip(a), strip(b), `${id} is not deterministic`);
    assert.notEqual(JSON.stringify(a.metrics), JSON.stringify(c.metrics), `${id}: seed has no effect`);
  }
});

/* ── documented defects ─────────────────────────────────────────────────── */

test("documents defect: settleDay accepts an unsafe-integer pool and the reconciler passes inexact books (BK-D1)", () => {
  const s = settleDay(RULES, {
    poolMicro: 2 ** 62,
    players: [{ playerId: "a", sessions: [{ minutes: 30, meters: 3000 }], activeDaysThisWeek: 1, trustWeight: 1, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [] }],
    deedOwnerByCell: new Map(),
  });
  assert.deepEqual(dayBooksProblems(RULES, s), [], "the reconciler sees nothing wrong");
  assert.ok(!Number.isSafeInteger(s.books.poolMicro), "an unsafe pool is accepted without a RangeError");
  const exactReturned = 2n ** 62n - BigInt(s.books.mintedMicro);
  assert.notEqual(BigInt(s.books.returnedToSeasonPoolMicro), exactReturned, "yet the returned figure is not exact");
  // P11 finds the same class: only poolMicro (≥ 2^53 or MAX_VALUE) and absurd zonesHeld pass unbalanced.
  const p11 = PROPERTIES.find((x) => x.id === "P11")!;
  const m = manifest.properties.P11!;
  const r = runProperty(p11, m.seed, m.cases, mulberry32);
  const bad = Object.keys(r.metrics).filter((k) => k.endsWith("ACCEPTED_UNBALANCED")).map((k) => k.split("=")[0]);
  assert.ok(bad.length > 0);
  assert.deepEqual([...new Set(bad)].sort(), ["poolMicro", "zonesHeld"]);
});

test("documents defect: dayBooksProblems trusts the rules object it is handed; a forged 5% toll passes (BK-D2)", () => {
  const forged: EconomyRules = { ...RULES, tollBasisPoints: 500 };
  assert.equal(forged.rulesVersion, 1);
  const s = settleDay(forged, {
    poolMicro: MOVE(100),
    players: [{ playerId: "a", sessions: [{ minutes: 40, meters: 4000, crossedCells: ["x"] }], activeDaysThisWeek: 1, trustWeight: 1, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [] }],
    deedOwnerByCell: new Map([["x", "owner"]]),
  });
  const a = s.players[0]!;
  assert.equal(a.tollPaidMicro, (a.dayRewardMicro * 500) / 10_000, "5% taken");
  assert.deepEqual(dayBooksProblems(forged, s), [], "the reconciler, given the same forged rules, passes it");
  assert.notDeepEqual(dayBooksProblems(economyRulesFor(1)!, s), [], "a reconciler using its own registry refuses it");
});

test("documents defect: settleCreditsSeason sums a tampered 'settled' day without re-checking its books (BK-D3)", () => {
  const rng = mulberry32(9001);
  const one = settledG3Day(rng, 10);
  const tampered = {
    ...one.r,
    poolMicro: one.r.poolMicro * 2,
    lines: one.r.lines.map((l, k) => (k === 0 ? { ...l, netMicro: l.netMicro + MOVE(1_000) } : l)),
  };
  const s = settleCreditsSeason(1, 1, [tampered, { ...one.r, day: 400 }]);
  assert.equal(s.status, "settled", "accepted");
  if (s.status === "settled") {
    const net = s.byPlayer.reduce((a, x) => a + x.netMicro, 0);
    assert.notEqual(net, s.issuedMicro - s.burnedMicro, "season balances no longer equal issued − burned");
    assert.equal(s.daysSettled, 2, "day 400 of a 90-day season is accepted as well");
  }
});

test("documents defect: sessionToll and dayCloseCharges return NaN/Infinity on non-finite input instead of refusing (BK-D4)", () => {
  assert.ok(Number.isNaN(sessionToll(RULES, Number.NaN, ["a"], new Map([["a", "o"]]), new Set(["r"])).paidMicro));
  assert.equal(sessionToll(RULES, Number.POSITIVE_INFINITY, ["a"], new Map([["a", "o"]]), new Set(["r"])).paidMicro, Number.POSITIVE_INFINITY);
  const c = dayCloseCharges(RULES, { dayRewardMicro: MOVE(5), scoringSessions: 2, kitLevel: 1, dayShareMicro: Number.NaN, zonesHeld: 3, unvisitedZoneLevels: [1] });
  assert.ok(Number.isNaN(c.upkeepTakenMicro));
  // Through settleCreditsDay these cannot arise (pool and day-share are derived), and a NaN kit level is refused by the books check.
});

test("documents gap: the ledger accepts a push dated a day that may already be settled (BK-G1)", () => {
  const unit = { ...newUnit("z0/a", 20), holderId: "h", strength: 100 };
  const r = applyLedger({ states: new Map([["z0/a", unit]]), events: [{ eventId: "late", unitId: "z0/a", walkerId: "w", push: { kind: "solid" }, day: 20 }], rules: HARNESS_HOLDING_RULES });
  assert.equal(r.results[0]!.status, "applied", "no closed-day watermark exists");
});

test("documents defect (legacy prototype contract, static read): the season 'burn' transfers to a treasury (BK-D5)", () => {
  const sol = readFileSync(join(__dirname, "../../../contracts/src/SeasonController.sol"), "utf8");
  const body = sol.slice(sol.indexOf("function greatBurn"), sol.indexOf("function weeklyKeeperRun"));
  assert.match(body, /transferFrom\(owner, daoTreasury, burnAmount\)/, "tokens move to the treasury; supply is unchanged");
  assert.match(body, /catch \{\}/, "failed transfers are skipped and the rest proceeds: partial books");
  assert.doesNotMatch(body, /_burn\(|burnFrom\(/);
});

/* ── source worked examples ─────────────────────────────────────────────── */

test("V3 §19 Dan: stated inputs reproduce (40 zones unvisited, no reward, day-share 2.50)", () => {
  const c = dayCloseCharges(RULES, { dayRewardMicro: 0, scoringSessions: 0, kitLevel: 1, dayShareMicro: MOVE(2.5), zonesHeld: 40, unvisitedZoneLevels: Array(40).fill(2) });
  assert.ok(Math.abs(c.upkeepOwedMicro - MOVE(7.55)) <= MOVE(0.01));
  assert.equal(c.upkeepTakenMicro, 0);
  assert.equal(c.upkeepPaidInConditionMicro, c.upkeepOwedMicro);
});

test("V3 §18 Meera: charges reproduce from stated inputs; the toll reproduces only on the day basis or an unstated 6/6 cell split", () => {
  const c = dayCloseCharges(RULES, { dayRewardMicro: MOVE(3.68), scoringSessions: 2, kitLevel: 1, dayShareMicro: MOVE(2.5), zonesHeld: 6, unvisitedZoneLevels: [2, 2, 2, 2] });
  assert.equal(c.rechargeMicro, MOVE(0.92));
  assert.ok(Math.abs(c.upkeepTakenMicro - MOVE(0.47)) <= MOVE(0.005));
  const deeds = new Map([["c0", "ravi"], ["c1", "ravi"], ["c2", "sam"]]);
  const twelve = Array.from({ length: 12 }, (_, i) => `c${i}`);
  // Stated: 3.68 × 2% × 3/12 on the day total = 0.0184.
  const dayBasis = sessionToll(RULES, MOVE(3.68), twelve, deeds, new Set(["meera"]));
  // Per-owner floors give Ravi 12,266 + Sam 6,133 = 18,399: one micro under 18,400 stays with the runner (§20 rounding rule).
  assert.ok(dayBasis.paidMicro === MOVE(0.0184) || dayBasis.paidMicro === MOVE(0.0184) - 1);
  // §20 per session (evening reward 1.84): depends on how many of the 12 cells the evening loop crossed, which the source does not state.
  const perSession = (evening: number) => sessionToll(RULES, MOVE(1.84), twelve.slice(0, evening), deeds, new Set(["meera"])).paidMicro;
  assert.ok(Math.abs(perSession(6) - MOVE(0.0184)) <= 1, "matches only if the evening loop crossed exactly 6 distinct cells");
  assert.ok(Math.abs(perSession(12) - MOVE(0.0092)) <= 1, "half the stated toll if all 12 cells were the evening loop");
  assert.ok(Math.abs(perSession(3) - MOVE(0.0368)) <= 1, "double it if the evening loop was only the 3 deeded cells");
  // Credited: 3.68 − 0.0184 − 0.92 − upkeep ≈ 2.27 on the day basis.
  const credited = MOVE(3.68) - dayBasis.paidMicro - c.rechargeMicro - c.upkeepTakenMicro;
  assert.ok(Math.abs(credited - MOVE(2.27)) <= MOVE(0.005));
});
