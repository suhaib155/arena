/**
 * The pilot simulation: deterministic for a seed, books that balance every
 * day and over the season, the owner's one-push rule never broken, and every
 * exploit check producing a number. Small synthetic city so the suite stays fast.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { economyRulesFor } from "../../domain/economyV3";
import { rulesetProblems, shadeStrength, SIM_ONLY, SIM_PILOT_1, variantOf } from "../pilotRuleset";
import { gini, simulate, topShare, type SimOptions } from "../simulate";
import { booksOk, sweepPlan } from "../sweeps";
import { buildWorld, type PopulationSpec } from "../world";

const SMALL: PopulationSpec = { casual: 24, regular: 12, heavy: 5, colluder: 4, switcher: 4, route_farmer: 3, shade_farmer: 3, honestClubs: 3 };
const small = (over: Partial<SimOptions> = {}): SimOptions => ({ seed: 7, ruleset: SIM_PILOT_1, population: SMALL, cityRadiusMeters: 2500, days: 21, ...over });

test("the pilot ruleset is labelled simulation only and supplies every parameter", () => {
  assert.equal(SIM_PILOT_1.name, "sim-pilot-1");
  assert.equal(SIM_PILOT_1.status, SIM_ONLY);
  assert.deepEqual(rulesetProblems(SIM_PILOT_1), []);
  assert.ok(economyRulesFor(SIM_PILOT_1.economyRulesVersion), "economy rules version must exist");
  assert.equal(SIM_PILOT_1.pushesPerWalkerPerUnitPerDay, 1);
  assert.ok(Object.isFrozen(SIM_PILOT_1));
  const v = variantOf(SIM_PILOT_1, "decay-5", { holding: { solidDecayPerDay: 5 } });
  assert.equal(v.name, "sim-pilot-1~decay-5");
  assert.equal(v.holding.solidDecayPerDay, 5);
  assert.equal(v.holding.shadeDecayMultiplier, 3);
  assert.equal(SIM_PILOT_1.holding.solidDecayPerDay, 3, "a variant never changes the pilot");
  assert.deepEqual(rulesetProblems({ ...SIM_PILOT_1, status: "PRODUCTION" as never }), ["status must mark the ruleset as simulation only"]);
  assert.ok(rulesetProblems(variantOf(SIM_PILOT_1, "x", { control: { shadeWeight: { numerator: 0 } } })).length > 0);
});

test("D2 shade strength: 25 × shape × sprawl, thinning past 12 enclosed per stepped, degenerate loops rejected", () => {
  const rule = SIM_PILOT_1.shade;
  assert.equal(shadeStrength(rule, { shape: 0.9, stepped: 12, enclosed: 7 }), 22.5);
  assert.equal(shadeStrength(rule, { shape: 1, stepped: 1, enclosed: 24 }), 12.5);
  assert.equal(shadeStrength(rule, { shape: 0.15, stepped: 20, enclosed: 8 }), null);
  assert.equal(shadeStrength(rule, { shape: 0.9, stepped: 6, enclosed: 0 }), null);
  assert.equal(shadeStrength({ ...rule, minShape: 0 }, { shape: 0.15, stepped: 20, enclosed: 8 }), 3.75);
});

test("districts are geographic and versioned: the same polygons at every unit size", () => {
  const coarse = buildWorld({ edgeMeters: 531, cityRadiusMeters: 6000, districtsVersion: "sim-districts-v1", districtCount: 12 });
  const fine = buildWorld({ edgeMeters: 201, cityRadiusMeters: 6000, districtsVersion: "sim-districts-v1", districtCount: 12 });
  assert.deepEqual(coarse.districtIds, fine.districtIds);
  assert.equal(coarse.byId.get("u0_0")!.districtId, fine.byId.get("u0_0")!.districtId);
  assert.ok(fine.units.length > 5 * coarse.units.length);
});

test("concentration measures", () => {
  assert.equal(gini([1, 1, 1, 1]), 0);
  assert.ok(Math.abs(gini([0, 0, 0, 10]) - 0.75) < 1e-12);
  assert.equal(topShare([1, 1, 1, 1, 1, 1, 1, 1, 1, 11], 0.1), 0.55);
  assert.equal(gini([]), 0);
});

test("the simulator is deterministic for a seed and differs across seeds", () => {
  const a = simulate(small());
  const b = simulate(small());
  assert.deepEqual(a, b);
  const c = simulate(small({ seed: 8 }));
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test("the books balance every day and over the season; retries are skipped; the one-push rule holds", () => {
  for (const seed of [1, 2]) {
    const r = simulate(small({ seed }));
    assert.equal(r.books.daysSettled, r.days);
    assert.equal(r.books.daysRefused, 0);
    assert.equal(r.books.identityFailures, 0);
    assert.equal(r.books.seasonStatus, "settled");
    assert.equal(r.books.issuedMicro + r.books.returnedMicro, r.books.poolMicro);
    assert.ok(r.books.issuedMicro <= r.books.poolMicro);
    assert.ok(r.books.retriesSent > 0, "some retries are sent");
    assert.equal(r.books.retriesSkipped, r.books.retriesSent);
    assert.equal(r.books.rejectedEvents, 0);
    assert.equal(r.books.dailyLimitViolations, 0);
    assert.ok(r.books.dailyLimitRefusals > 0, "the owner rule bites");
    assert.ok(booksOk(r));
  }
});

test("every exploit check runs and reports a number", () => {
  const pilot = simulate(small());
  const finite = (n: number, what: string) => assert.ok(Number.isFinite(n), `${what} is ${n}`);
  finite(pilot.d19.pilot.routeFarmerRatio, "route farmer ratio");
  finite(pilot.d19.pilot.shadeFarmerRatio, "shade farmer ratio");
  finite(pilot.d19.pilot.colluderRatio, "colluder ratio");
  // The pilot D19 rule never scores repeated-route farming above the naive count.
  assert.ok(pilot.d19.pilot.routeFarmerRatio < pilot.d19.naive.routeFarmerRatio);
  finite(pilot.d18.kingmakerDistrictDays, "kingmaker district-days");
  assert.ok(pilot.d18.switches > 0, "switchers switch");
  finite(pilot.d23.shieldUnitsLostPerShielder, "shield losses");
  finite(pilot.d23.colluderFlipsPerDay, "colluder flips");
  assert.ok(pilot.shade.shadeRejectedLoops > 0, "degenerate shade loops are rejected under the pilot");
  for (const k of ["player_credits", "club_credits", "club_district_days", "club_contributions"] as const) assert.equal(pilot.d22[k].status, "settled", k);
  for (const p of Object.values(pilot.retention)) for (const v of p) assert.ok(v >= 0 && v <= 1);

  const immune = simulate(small({ ruleset: variantOf(SIM_PILOT_1, "club-mate-immune", { clubMateErosion: "immune" }) }));
  assert.ok(immune.d23.immuneDropped > 0, "immunity drops club-mate pushes");
  assert.equal(pilot.d23.immuneDropped, 0);
  const lax = simulate(small({ ruleset: variantOf(SIM_PILOT_1, "sprawl-no-reject", { shade: { minShape: 0 } }) }));
  assert.equal(lax.shade.shadeRejectedLoops, 0);
  const noAway = simulate(small({ ruleset: variantOf(SIM_PILOT_1, "away-none", { awayDays: { mode: "none" } }) }));
  assert.equal(noAway.d17.awayDaysUsed, 0);
  assert.ok(pilot.d17.awayDaysUsed > 0);
  const noRestore = simulate(small({ ruleset: variantOf(SIM_PILOT_1, "no-restore", { levelOnLoss: { reclaimRestoreDays: 0 } }) }));
  assert.equal(noRestore.d16.restores, 0);
  for (const r of [immune, lax, noAway, noRestore]) assert.ok(booksOk(r), r.ruleset);
});

test("the sweep plan changes one decision per case and keeps every variant simulation only", () => {
  const plan = sweepPlan();
  assert.equal(plan[0]!.ruleset.name, "sim-pilot-1");
  for (const c of plan) {
    assert.equal(c.ruleset.status, SIM_ONLY);
    assert.deepEqual(rulesetProblems(c.ruleset), [], c.label);
    if (c.decision !== "pilot" && c.decision !== "context") assert.ok(c.ruleset.name.startsWith("sim-pilot-1~"), c.label);
  }
});
