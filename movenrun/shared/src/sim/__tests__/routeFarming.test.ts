/**
 * The route-farming study: every route rule is a named, versioned,
 * simulation-only config; the baseline is V3 settlement unchanged; no rule
 * changes territory, XP, streaks or achievements; the books balance; the
 * fingerprint keeps no unit ids. Small synthetic population so the suite
 * stays fast.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { economyRulesFor, settleDay } from "../../domain/economyV3";
import { SIM_ONLY, SIM_PILOT_1, SIM_PILOT_2 } from "../pilotRuleset";
import {
  fingerprintSimilarity,
  REPEAT_ROUTE_UNSCORED_3,
  ROUTE_BASELINE,
  ROUTE_DAILY_BOUND,
  ROUTE_FINGERPRINT_PILOT,
  ROUTE_LINKED_AS_ONE,
  ROUTE_TAPER_10,
  RouteCreditState,
  routeFingerprint,
  routeRuleProblems,
  settleRouteDay,
  taperFactor,
  type RouteCreditRuleset,
  type RouteDayPlayer,
} from "../routeCredit";
import { HONEST, measure, routeFarmingPlan, runRouteStudy, type RoutePopulation } from "../routeFarmingStudy";

const SMALL: Record<RoutePopulation, number> = {
  commuter: 4, rural: 3, low_mobility: 3, laps_runner: 3, park_walker: 3, gps_jitter: 3, household: 4, route_farmer: 3, spoofer: 2, colluder: 6,
};
const run = (rule: RouteCreditRuleset, days = 21, regime: "launch" | "binding" = "launch") => runRouteStudy({ seed: 3, rule, population: SMALL, days, regime });
const econ = economyRulesFor(1)!;

test("every route rule is named, versioned, simulation only and valid; sim-pilot-1 and -2 are untouched", () => {
  for (const c of routeFarmingPlan()) {
    assert.equal(c.rule.status, SIM_ONLY, c.label);
    assert.ok(c.rule.name.startsWith("sim-route-"), c.label);
    assert.ok(c.rule.version >= 1);
    assert.deepEqual(routeRuleProblems(c.rule), [], c.label);
    assert.ok(Object.isFrozen(c.rule));
  }
  assert.equal(new Set(routeFarmingPlan().map((c) => c.rule.name)).size, routeFarmingPlan().length);
  assert.ok(new Set(routeFarmingPlan().map((c) => c.comparator)).size >= 4, "at least four comparators");
  assert.ok(!("routeCredit" in SIM_PILOT_1) && !("routeCredit" in SIM_PILOT_2));
  assert.equal(SIM_PILOT_2.churn?.repeatRouteUnscoredDays, null);
  assert.equal(econ.minSessionMinutes, 10, "V3 minimum session unchanged");
  assert.equal(econ.minSessionMeters, 750);
});

test("rule checks catch unusable settings, including a taper that could reach zero", () => {
  const bad = (rule: RouteCreditRuleset["rule"]) => routeRuleProblems({ ...ROUTE_BASELINE, rule }).length > 0;
  assert.ok(bad({ kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 10, stepPerRepeat: 0.1, floor: 0 }));
  assert.ok(bad({ kind: "marginal_taper", windowDays: 30, similarity: 0.8, freeRepeats: 10, stepPerRepeat: 0.1, floor: 0.25 }), "window beyond retention");
  assert.ok(bad({ kind: "unscored_identical", days: 0 }));
  assert.ok(bad({ kind: "identical_daily_bound", similarity: 1.2, boundMicro: 1 }));
  assert.ok(bad({ kind: "linked_identical_as_one", similarity: 0 }));
  assert.ok(routeRuleProblems({ ...ROUTE_BASELINE, name: "route" }).length > 0);
});

test("the taper is gradual, never below its floor, and free up to its threshold", () => {
  const r = ROUTE_TAPER_10.rule as Extract<RouteCreditRuleset["rule"], { kind: "marginal_taper" }>;
  let prev = 1;
  for (let n = 0; n < 40; n++) {
    const f = taperFactor(r, n);
    assert.ok(f <= prev && f >= r.floor);
    if (n < r.freeRepeats) assert.equal(f, 1);
    prev = f;
  }
  assert.equal(taperFactor(r, 100), r.floor);
});

test("the fingerprint is a fixed-size MinHash with no unit or zone ids, and tracks set overlap", () => {
  const a = routeFingerprint(ROUTE_FINGERPRINT_PILOT, ["z1_1", "z1_2", "z2_2", "z3_2"]);
  assert.equal(a.length, ROUTE_FINGERPRINT_PILOT.hashes);
  assert.ok(a.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff));
  assert.ok(!JSON.stringify(a).includes("z"));
  assert.equal(fingerprintSimilarity(a, routeFingerprint(ROUTE_FINGERPRINT_PILOT, ["z3_2", "z2_2", "z1_2", "z1_1", "z1_1"])), 1, "order and repeats do not matter");
  assert.ok(fingerprintSimilarity(a, routeFingerprint(ROUTE_FINGERPRINT_PILOT, ["z9_9", "z8_9"])) < 0.2);
  const salted = routeFingerprint({ ...ROUTE_FINGERPRINT_PILOT, salt: "other-season" }, ["z1_1", "z1_2", "z2_2", "z3_2"]);
  assert.ok(fingerprintSimilarity(a, salted) < 0.2, "another season's salt gives unrelated signatures");
});

test("the baseline settles exactly as the V3 reference model", () => {
  const players: RouteDayPlayer[] = [
    { playerId: "a", linkedPlayerIds: [], sessions: [{ minutes: 30, meters: 2400, stepped: ["u0_0", "u1_0"], parents: ["z0_0"] }, { minutes: 11, meters: 800, stepped: ["u0_0"], parents: ["z0_0"] }], activeDaysThisWeek: 3, trustWeight: 1 },
    { playerId: "b", linkedPlayerIds: [], sessions: [{ minutes: 9, meters: 800, stepped: ["u5_0"], parents: ["z2_0"] }], activeDaysThisWeek: 1, trustWeight: 0.5 },
  ];
  const r = settleRouteDay(econ, ROUTE_BASELINE, new RouteCreditState(), 0, 50_000_000, players);
  const v3 = settleDay(econ, { poolMicro: 50_000_000, deedOwnerByCell: new Map(), players: players.map((p) => ({ playerId: p.playerId, linkedPlayerIds: p.linkedPlayerIds, sessions: p.sessions.map((s) => ({ minutes: s.minutes, meters: s.meters, crossedCells: s.stepped })), activeDaysThisWeek: p.activeDaysThisWeek, trustWeight: p.trustWeight, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [] })) });
  assert.deepEqual(r.players.map((p) => p.dayCreditsMicro), v3.players.map((p) => p.dayRewardMicro));
  assert.equal(r.withheldByRuleMicro, 0);
  assert.equal(r.creditedMicro + r.returnedMicro, r.poolMicro);
});

test("linked accounts on one walk earn as one; a single account is never changed", () => {
  const walk = { minutes: 30, meters: 2400, stepped: ["u0_0", "u1_0", "u2_0"], parents: ["z0_0", "z1_0"] };
  const p = (id: string, linked: string[]): RouteDayPlayer => ({ playerId: id, linkedPlayerIds: linked, sessions: [walk], activeDaysThisWeek: 1, trustWeight: 1 });
  const r = settleRouteDay(econ, ROUTE_LINKED_AS_ONE, new RouteCreditState(), 0, 1_000_000_000, [p("x", ["y", "z"]), p("y", ["x", "z"]), p("z", ["x", "y"]), p("solo", [])]);
  const solo = r.players.find((q) => q.playerId === "solo")!;
  assert.equal(solo.dayCreditsMicro, econ.sessionCeilingMicro);
  const group = r.players.filter((q) => q.playerId !== "solo").reduce((a, q) => a + q.dayCreditsMicro, 0);
  assert.ok(group <= econ.sessionCeilingMicro && group >= econ.sessionCeilingMicro - 3, "three linked phones on one walk earn one walk's credits");
  assert.equal(r.creditedMicro + r.returnedMicro, r.poolMicro);
});

test("same seed, same result: the study is deterministic", () => {
  assert.deepEqual(run(ROUTE_TAPER_10, 14), run(ROUTE_TAPER_10, 14));
});

test("no rule changes territory, XP, streaks or achievements, and every day's books balance", () => {
  const base = run(ROUTE_BASELINE);
  assert.ok(base.territory && base.territory.claimed > 0 && base.territory.reinforced > 0);
  for (const c of routeFarmingPlan()) {
    const r = c.rule === ROUTE_BASELINE ? base : run(c.rule);
    assert.deepEqual(r.territory, base.territory, `${c.label}: territory`);
    assert.deepEqual(r.movement, base.movement, `${c.label}: XP, streaks, achievements`);
    assert.ok(r.books.ok, `${c.label}: books`);
    assert.equal(r.books.credited + r.books.returned, r.books.pool);
    const m = measure(r, base);
    assert.equal(m.movementUnchanged, true);
    assert.equal(m.territoryUnchanged, true);
    for (const v of Object.values(m.vsBaseline)) assert.ok(c.comparator === "2" || v <= 1 + 1e-9, `${c.label}: comparators 3–5 only ever withhold`);
  }
});

test("no retroactive change: a rule acts only on the day it settles", () => {
  for (const rule of [REPEAT_ROUTE_UNSCORED_3, ROUTE_TAPER_10, ROUTE_DAILY_BOUND, ROUTE_LINKED_AS_ONE]) {
    const short = run(rule, 10);
    const long = run(rule, 20);
    assert.deepEqual(long.dailyCreditedMicro.slice(0, 10), short.dailyCreditedMicro, rule.name);
  }
});

test("each rule moves what it claims to move", () => {
  const base = run(ROUTE_BASELINE);
  const m = (rule: RouteCreditRuleset) => measure(run(rule), base);
  const unscored = m(REPEAT_ROUTE_UNSCORED_3);
  assert.ok(unscored.unscoredShare.route_farmer > 0.5, "the identical-route rule unscores farm loops");
  assert.ok(unscored.penalised.low_mobility > 0, "and also honest short loops");
  const linked = m(ROUTE_LINKED_AS_ONE);
  assert.ok(linked.vsBaseline.colluder < 0.6, "linked phones on one walk lose the multiplier");
  for (const p of HONEST) if (p !== "household") assert.equal(linked.penalised[p], 0, `${p}: a single account is never changed`);
  const taper = m(ROUTE_TAPER_10);
  assert.ok(taper.vsBaseline.route_farmer < 1);
  assert.equal(taper.unscoredShare.route_farmer, 0, "the taper never unscores");
});
