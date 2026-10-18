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
  ROUTE_CANDIDATE,
  ROUTE_CLUSTER_K1,
  ROUTE_CLUSTER_K2,
  ROUTE_REVIEW_3PLUS,
  ROUTE_REVIEW_ALL,
  ROUTE_SOFT_CEILING,
  ROUTE_TRUST_AFTER,
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
import { ci95, HONEST, measure, routeAlternativesPlan, routeFarmingPlan, runRouteStudy, type RoutePopulation } from "../routeFarmingStudy";

const SMALL: Record<RoutePopulation, number> = {
  commuter: 4, rural: 3, low_mobility: 3, laps_runner: 3, park_walker: 3, gps_jitter: 3, household: 4, route_farmer: 3, spoofer: 2, colluder: 6, exercise_loop: 0, accessible_loop: 0, family: 0, colluder_pair: 0,
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

/* ── second round: less punitive alternatives ─────────────────────────────── */

const SMALL_2: Record<RoutePopulation, number> = { ...SMALL, exercise_loop: 3, accessible_loop: 3, family: 6, colluder_pair: 4 };
const run2 = (rule: RouteCreditRuleset, opts: { days?: number; regime?: "launch" | "binding"; trust?: Partial<Record<RoutePopulation, number>> } = {}) =>
  runRouteStudy({ seed: 4, rule, population: SMALL_2, days: opts.days ?? 28, regime: opts.regime ?? "launch", trust: opts.trust });

test("second-round rules are named, versioned, simulation only and valid; the minimum session is unchanged", () => {
  const plan = routeAlternativesPlan();
  for (const c of plan) {
    assert.equal(c.rule.status, SIM_ONLY, c.label);
    assert.ok(c.rule.name.startsWith("sim-route-"), c.label);
    assert.deepEqual(routeRuleProblems(c.rule), [], c.label);
    assert.ok(Object.isFrozen(c.rule));
  }
  assert.equal(new Set(plan.map((c) => c.label)).size, plan.length);
  assert.equal(econ.minSessionMinutes, 10);
  assert.equal(econ.minSessionMeters, 750);
  assert.equal(ROUTE_BASELINE.trustOrder, undefined, "the baseline keeps A6 as the reference model reads it");
});

test("rule checks reject a cluster rule with neither cut nor review, a review that could act on a settled day, and a zero soft rate", () => {
  const bad = (rule: RouteCreditRuleset["rule"], trustOrder?: unknown) => routeRuleProblems({ ...ROUTE_BASELINE, rule, ...(trustOrder ? { trustOrder: trustOrder as "after_ceiling" } : {}) }).length > 0;
  assert.ok(bad({ kind: "linked_cluster", similarity: 0.8, timeWindowMinutes: 20, allowance: null, review: null }));
  assert.ok(bad({ kind: "linked_cluster", similarity: 0.8, timeWindowMinutes: 20, allowance: null, review: { flagAboveAccounts: 1, flagDays: 4, windowDays: 14, reviewDelayDays: 0, upheldAllowance: 1, clearedExemptDays: 90 } }));
  assert.ok(bad({ kind: "linked_cluster", similarity: 0.8, timeWindowMinutes: 0, allowance: 1, review: null }));
  assert.ok(bad({ kind: "soft_ceiling", windowDays: 7, softMicro: 1, rateAbove: 0 }));
  assert.ok(bad({ kind: "none" }, "sideways"));
});

test("the soft ceiling pays everything below it in full and only discounts the share above", () => {
  const walk = (i: number) => ({ minutes: 40, meters: 3200, stepped: [`u${i}_0`], parents: [`z${i}_0`] });
  const p: RouteDayPlayer = { playerId: "a", linkedPlayerIds: [], sessions: [walk(1), walk(2)], activeDaysThisWeek: 7, trustWeight: 1 };
  const state = new RouteCreditState();
  const rs = { ...ROUTE_SOFT_CEILING, rule: { kind: "soft_ceiling", windowDays: 7, softMicro: 30_000_000, rateAbove: 0.5 } } as RouteCreditRuleset;
  const d0 = settleRouteDay(econ, rs, state, 0, 1_000_000_000, [p]);
  assert.equal(d0.players[0]!.dayCreditsMicro, econ.dayCeilingMicro, "20 credits, under the 30 soft ceiling: in full");
  const d1 = settleRouteDay(econ, rs, state, 1, 1_000_000_000, [p]);
  assert.equal(d1.players[0]!.dayCreditsMicro, 10_000_000 + 5_000_000, "10 in full up to 30, the other 10 at half");
  assert.deepEqual(d1.problems, []);
});

test("cluster rules: co-walkers within the allowance keep full credits; the same route at another time is not a cluster", () => {
  const walk = (start: number) => ({ minutes: 30, meters: 2400, stepped: ["u0_0", "u1_0", "u2_0"], parents: ["z0_0", "z1_0"], startMinute: start });
  const p = (id: string, linked: string[], start: number): RouteDayPlayer => ({ playerId: id, linkedPlayerIds: linked, sessions: [walk(start)], activeDaysThisWeek: 1, trustWeight: 1 });
  const C = econ.sessionCeilingMicro;
  const sum = (r: ReturnType<typeof settleRouteDay>, ids: string[]) => r.players.filter((q) => ids.includes(q.playerId)).reduce((a, q) => a + q.dayCreditsMicro, 0);
  const pair = [p("h1", ["h2"], 600), p("h2", ["h1"], 602)];
  const trio = [p("c1", ["c2", "c3"], 600), p("c2", ["c1", "c3"], 601), p("c3", ["c1", "c2"], 603)];
  const k2 = settleRouteDay(econ, ROUTE_CLUSTER_K2, new RouteCreditState(), 0, 1_000_000_000, [...pair, ...trio]);
  assert.equal(sum(k2, ["h1", "h2"]), 2 * C, "a pair within allowance 2 is untouched");
  assert.ok(sum(k2, ["c1", "c2", "c3"]) <= 2 * C && sum(k2, ["c1", "c2", "c3"]) >= 2 * C - 3, "a trio earns as two");
  const apart = settleRouteDay(econ, ROUTE_CLUSTER_K1, new RouteCreditState(), 0, 1_000_000_000, [p("h1", ["h2"], 480), p("h2", ["h1"], 1080)]);
  assert.equal(sum(apart, ["h1", "h2"]), 2 * C, "same loop, ten hours apart: not walking together");
  const together = settleRouteDay(econ, ROUTE_CLUSTER_K1, new RouteCreditState(), 0, 1_000_000_000, pair);
  assert.ok(sum(together, ["h1", "h2"]) <= C);
  for (const r of [k2, apart, together]) assert.deepEqual(r.problems, []);
});

test("review flags never cut credits by themselves; an upheld review acts only from its effective day", () => {
  const walk = { minutes: 30, meters: 2400, stepped: ["u0_0", "u1_0", "u2_0"], parents: ["z0_0", "z1_0"], startMinute: 600 };
  const trio = ["c1", "c2", "c3"].map((id, k, all): RouteDayPlayer => ({ playerId: id, linkedPlayerIds: all.filter((x) => x !== id), sessions: [{ ...walk, startMinute: 600 + k }], activeDaysThisWeek: 1, trustWeight: 1 }));
  const C = econ.sessionCeilingMicro;
  for (const upheld of [false, true]) {
    const state = new RouteCreditState();
    state.reviewer = () => upheld;
    const days: number[] = [];
    for (let d = 0; d < 40; d++) days.push(settleRouteDay(econ, ROUTE_REVIEW_3PLUS, state, d, 1_000_000_000, trio).creditedMicro);
    assert.equal(state.reviews.length, 1, "one review for the group, not one per day; a cleared group is not re-flagged within its exemption");
    const v = state.reviews[0]!;
    assert.equal(v.flaggedDay, 3, "flagged on the 4th day together");
    assert.equal(v.effectiveDay, 6);
    for (let d = 0; d < v.effectiveDay; d++) assert.equal(days[d], 3 * C, `day ${d}: full credits while open`);
    for (let d = v.effectiveDay; d < 40; d++) assert.ok(upheld ? days[d]! <= C : days[d] === 3 * C, `day ${d}`);
  }
});

test("trust after the ceiling withholds from a low-trust account while ceilings bind; before the ceiling it does not", () => {
  const walk = { minutes: 30, meters: 2400, stepped: ["u0_0"], parents: ["z0_0"] };
  const p: RouteDayPlayer = { playerId: "s", linkedPlayerIds: [], sessions: [walk], activeDaysThisWeek: 1, trustWeight: 0.5 };
  const before = settleRouteDay(econ, ROUTE_BASELINE, new RouteCreditState(), 0, 1_000_000_000, [p]);
  const after = settleRouteDay(econ, ROUTE_TRUST_AFTER, new RouteCreditState(), 0, 1_000_000_000, [p]);
  assert.equal(before.players[0]!.dayCreditsMicro, econ.sessionCeilingMicro, "A6 as read today: 0.5 × a huge share is still above the ceiling");
  assert.equal(after.players[0]!.dayCreditsMicro, econ.sessionCeilingMicro / 2);
  assert.equal(after.withheldByTrustMicro, econ.sessionCeilingMicro / 2);
  assert.equal(after.creditedMicro + after.returnedMicro, after.poolMicro);
  assert.deepEqual(after.problems, []);
});

test("every second-round rule leaves territory, XP, streaks and achievements unchanged, books exact every day, no retroactive change", () => {
  const base = run2(ROUTE_BASELINE);
  assert.ok(base.territory && base.territory.claimed > 0);
  for (const c of routeAlternativesPlan()) {
    for (const regime of ["launch", "binding"] as const) {
      const r = run2(c.rule, { regime, trust: c.trust });
      const b = regime === "launch" ? base : run2(ROUTE_BASELINE, { regime });
      assert.deepEqual(r.territory, b.territory, `${c.label} ${regime}: territory`);
      assert.deepEqual(r.movement, b.movement, `${c.label} ${regime}: XP, streaks, achievements`);
      assert.deepEqual(r.problems, [], `${c.label} ${regime}: books`);
      assert.ok(r.books.ok);
      assert.equal(r.books.credited + r.books.returned, r.books.pool);
      if (!c.trust) for (const id of Object.keys(r.creditsByAccount)) assert.ok(r.creditsByAccount[id]! <= b.creditsByAccount[id]!, `${c.label}: ${id} only ever withheld from`);
    }
  }
  for (const rule of [ROUTE_SOFT_CEILING, ROUTE_CLUSTER_K2, ROUTE_REVIEW_ALL, ROUTE_CANDIDATE]) {
    assert.deepEqual(run2(rule, { days: 28 }).dailyCreditedMicro.slice(0, 14), run2(rule, { days: 14 }).dailyCreditedMicro, rule.name);
  }
});

test("the candidate never changes a single account, cuts nothing automatically and damps only upheld groups", () => {
  const base = run2(ROUTE_BASELINE);
  const r = run2(ROUTE_CANDIDATE);
  const m = measure(r, base);
  for (const p of HONEST) if (p !== "family" && p !== "household") assert.equal(m.penalised[p], 0, p);
  for (const id of Object.keys(r.creditsByAccount)) {
    if (r.popOf[id] === "spoofer") continue; // trust weight 0.5, after the ceiling
    if (!r.upheld.includes(id)) assert.equal(r.creditsByAccount[id], base.creditsByAccount[id], `${id}: no upheld review, no change`);
  }
  assert.ok(m.vsBaseline.colluder < 0.8 && m.vsBaseline.colluder_pair < 0.8, "upheld colluders lose part of the multiplier");
  assert.ok(m.vsBaseline.spoofer < 0.6, "trust after the ceiling bites on spoofers");
  const c = ci95([1, 2, 3, 4, 5]);
  assert.equal(c.mean, 3);
  assert.ok(Math.abs(c.half - 2.776 * Math.sqrt(2.5) / Math.sqrt(5)) < 1e-9);
});
