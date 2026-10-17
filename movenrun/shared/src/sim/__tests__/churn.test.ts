/**
 * The churn study: every lever is a named, reversible simulation config; a
 * ruleset without levers runs exactly as sim-pilot-1; the owner's one-push
 * rule and the books hold under every lever. Small synthetic city so the
 * suite stays fast.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CHURN_OFF, churn, churnPlan, continuityPlan, SIM_PILOT_2_AT_201M, STUDY_POPULATION, TWO_DAY_CHALLENGE } from "../churnStudy";
import { rulesetProblems, SIM_ONLY, SIM_PILOT_1, SIM_PILOT_2, variantOf } from "../pilotRuleset";
import { simulate, STUDY_ATTRITION, type SimOptions } from "../simulate";
import { booksOk } from "../sweeps";
import { DEFAULT_POPULATION, type PopulationSpec } from "../world";

const SMALL: PopulationSpec = { casual: 24, regular: 12, heavy: 5, colluder: 4, switcher: 4, route_farmer: 3, shade_farmer: 3, honestClubs: 3 };
const SMALL_STUDY: PopulationSpec = { ...SMALL, griefer: 3 };
const small = (over: Partial<SimOptions> = {}): SimOptions => ({ seed: 7, ruleset: SIM_PILOT_1, population: SMALL, cityRadiusMeters: 2500, days: 21, ...over });
const strip = (r: ReturnType<typeof simulate>) => ({ ...r, ruleset: "", churn: { ...r.churn, zones: 0 } });

test("sim-pilot-1 is untouched: no churn section, no takeover rule, still frozen", () => {
  assert.equal(SIM_PILOT_1.churn, undefined);
  assert.equal(SIM_PILOT_1.holding.takeover, undefined);
  assert.equal(SIM_PILOT_1.unitEdgeMeters, 201);
  assert.ok(Object.isFrozen(SIM_PILOT_1));
  assert.equal(DEFAULT_POPULATION.griefer, undefined, "the default population has no griefers");
});

test("a ruleset with every churn lever off runs exactly as one without the section", () => {
  const off = variantOf(SIM_PILOT_1, "churn-off", { churn: { ...CHURN_OFF }, holding: { takeover: undefined } });
  const a = simulate(small());
  const b = simulate(small({ ruleset: off }));
  assert.deepEqual(strip(b), strip(a));
  assert.equal(b.fingerprint, a.fingerprint);
});

test("sim-pilot-1 seeds 1–3 on the full default population keep their published fingerprints", { skip: process.env.SIM_FULL !== "1" }, () => {
  // Opt-in (about 10 s): SIM_FULL=1. The same fingerprints are printed by `sim --churn`.
  assert.deepEqual([1, 2, 3].map((seed) => simulate({ seed, ruleset: SIM_PILOT_1 }).fingerprint), ["30d570be", "e7214e5", "e0073617"]);
});

test("every churn variant is named, simulation only and valid, and sim-pilot-2 names what it changes", () => {
  for (const c of [...churnPlan(), ...continuityPlan()]) {
    assert.equal(c.ruleset.status, SIM_ONLY, c.label);
    assert.deepEqual(rulesetProblems(c.ruleset), [], c.label);
    assert.ok(c.ruleset.name.startsWith("sim-pilot-"), c.label);
  }
  assert.equal(SIM_PILOT_2.name, "sim-pilot-2");
  assert.ok(Object.isFrozen(SIM_PILOT_2));
  assert.notEqual(SIM_PILOT_2.holding.rulesVersion, SIM_PILOT_1.holding.rulesVersion);
  assert.equal(SIM_PILOT_2.economyRulesVersion, SIM_PILOT_1.economyRulesVersion, "economy numbers unchanged");
  assert.equal(SIM_PILOT_2.pushesPerWalkerPerUnitPerDay, 1);
  assert.equal(SIM_PILOT_2_AT_201M.unitEdgeMeters, 201);
  assert.equal(STUDY_POPULATION.griefer, 8);
});

test("ruleset checks catch unusable churn settings", () => {
  const bad = (patch: Parameters<typeof variantOf>[2]) => rulesetProblems(variantOf(SIM_PILOT_1, "bad", patch)).length > 0;
  assert.ok(bad({ holding: { takeover: { challenge: { windowDays: 3, floor: 35, immediateBelowStrength: 30 }, maxFlipsPerUnitPerDay: null } } }), "floor decays under the immediate line");
  assert.ok(bad({ holding: { takeover: { challenge: null, maxFlipsPerUnitPerDay: 0 } } }));
  assert.ok(bad({ churn: churn({ walkerTakeCap: 0 }) }));
  assert.ok(bad({ churn: churn({ zoneEdgeMeters: 100 }) }), "a zone smaller than a unit");
  assert.ok(!bad({ holding: { takeover: { ...TWO_DAY_CHALLENGE } } }));
});

test("every lever keeps the owner rule and the books, and moves what it claims to move", () => {
  const study = (ruleset: SimOptions["ruleset"], over: Partial<SimOptions> = {}) =>
    simulate(small({ ruleset, population: SMALL_STUDY, attrition: STUDY_ATTRITION, ...over }));
  const base = study(SIM_PILOT_1);
  const challenge = study(variantOf(SIM_PILOT_1, "challenge", { holding: { takeover: { ...TWO_DAY_CHALLENGE } } }));
  const cap = study(variantOf(SIM_PILOT_1, "cap", { churn: churn({ walkerTakeCap: 3 }) }));
  const flipCap = study(variantOf(SIM_PILOT_1, "flip-cap", { holding: { takeover: { challenge: null, maxFlipsPerUnitPerDay: 1 } } }));
  const home = study(variantOf(SIM_PILOT_1, "home", { churn: churn({ homeDefenceDays: 2 }) }));
  const fort = study(variantOf(SIM_PILOT_1, "fort", { churn: churn({ fortify: { costDayShares: 1, durationDays: 7, minVisits: 2, windowDays: 7 } }) }));
  const route = study(variantOf(SIM_PILOT_1, "route", { churn: churn({ repeatRouteUnscoredDays: 3 }) }));
  const zones = study(variantOf(SIM_PILOT_1, "zones", { unitEdgeMeters: 76, churn: churn({ zoneEdgeMeters: 201 }) }), { cityRadiusMeters: 1200 });
  const pilot2 = study(SIM_PILOT_2, { cityRadiusMeters: 1200 });
  for (const r of [base, challenge, cap, flipCap, home, fort, route, zones, pilot2]) {
    assert.equal(r.books.dailyLimitViolations, 0, r.ruleset);
    assert.ok(booksOk(r), r.ruleset);
    for (const p of Object.values(r.churn.playing)) for (const v of p) assert.ok(v >= 0 && v <= 1, r.ruleset);
  }
  assert.ok(challenge.takeover.flipsPer100HeldPerDay < base.takeover.flipsPer100HeldPerDay, "a two-day challenge slows takeovers");
  assert.ok(cap.churn.walkerCapRefusals > 0 && base.churn.walkerCapRefusals === 0);
  assert.ok(cap.takeover.flipsPer100HeldPerDay < base.takeover.flipsPer100HeldPerDay, "the take cap slows takeovers");
  assert.ok(flipCap.takeover.flipsPer100HeldPerDay <= base.takeover.flipsPer100HeldPerDay);
  assert.ok(fort.churn.fortifyPurchases > 0 && fort.churn.fortifySpendMicro > 0);
  assert.equal(base.churn.fortifyPurchases, 0);
  assert.ok(route.churn.routeFarmerSessionsUnscored > 0.5, "route farmers' repeated walks stop scoring");
  assert.ok(route.churn.routeFarmerCreditShare < base.churn.routeFarmerCreditShare);
  assert.ok(zones.churn.zones < zones.units, "units are grouped into zones");
  assert.ok(zones.d16.levelUps > 0, "zone levels are bought");
  assert.ok(base.churn.grieferFlipsPerActiveDay > 0, "griefers take ground");
  assert.ok(home.books.dailyLimitViolations === 0);
});

test("attrition is an option: off by default, and quitters stop playing", () => {
  // Day 30 is the first checkpoint, so these runs are 31 days long.
  const none = simulate(small({ population: SMALL_STUDY, days: 31 }));
  for (const p of Object.values(none.churn.playing)) assert.equal(p[0], 1);
  const harsh = simulate(small({ population: SMALL_STUDY, days: 31, attrition: { quitChance: { casual: 1, regular: 1, heavy: 1 }, lookbackDays: 21 } }));
  assert.ok(harsh.churn.playing.casual[0] < 1, "some casual players quit");
});
