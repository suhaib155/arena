/**
 * The churn study: named, reversible variants of sim-pilot-1 that each change
 * one lever against territory churn, run on the same seeds with the same
 * study population (the default synthetic players plus 8 griefers) and the
 * same attrition assumption, so the only difference between rows is the rule.
 * See `docs/SIM_CHURN_STUDY.md`. SIMULATION ONLY: every value is PILOT, none
 * is final, and sim-pilot-1 itself is never changed.
 */

import type { TakeoverRule } from "../domain/holding";
import { SIM_PILOT_1, SIM_PILOT_2, variantOf, type ChurnRule, type SimRuleset } from "./pilotRuleset";
import { STUDY_ATTRITION, type SimResult } from "./simulate";
import { booksOk, type Column, type SweepCase } from "./sweeps";
import { DEFAULT_POPULATION, type PopulationSpec } from "./world";

/** The default synthetic population plus 8 griefers (behaviour assumption, see BEHAVIOUR.griefer). */
export const STUDY_POPULATION: Readonly<PopulationSpec> = Object.freeze({ ...DEFAULT_POPULATION, griefer: 8 });

/** Every churn lever off: a ruleset with this behaves exactly as one without `churn`. */
export const CHURN_OFF: Readonly<ChurnRule> = Object.freeze({
  walkerTakeCap: null,
  homeDefenceDays: null,
  fortify: null,
  zoneEdgeMeters: null,
  repeatRouteUnscoredDays: null,
});

export const churn = (over: Partial<ChurnRule>): ChurnRule => ({ ...CHURN_OFF, ...over });

/** PILOT: a two-day challenge. Window 3 days, a blocked flip leaves 50 ("at risk"), ground under 30 ("contested") still falls at once. */
export const TWO_DAY_CHALLENGE: Readonly<TakeoverRule> = Object.freeze({
  challenge: { windowDays: 3, floor: 50, immediateBelowStrength: 30 },
  maxFlipsPerUnitPerDay: null,
});

export const UNIT_FLIP_CAP_1: Readonly<TakeoverRule> = Object.freeze({ challenge: null, maxFlipsPerUnitPerDay: 1 });

/** PILOT D9 values for the fortify variant: 1 day-share for 7 days, bought by a holder who stepped on the zone on 2 days in 7. */
export const FORTIFY_PILOT = Object.freeze({ costDayShares: 1, durationDays: 7, minVisits: 2, windowDays: 7 });

/** The 201 m form of the combined proposal: challenge plus a take cap of 5, units unchanged. */
export const SIM_PILOT_2_AT_201M: Readonly<SimRuleset> = Object.freeze(
  variantOf(SIM_PILOT_1, "challenge+take-cap-5", { holding: { takeover: { ...TWO_DAY_CHALLENGE } }, churn: churn({ walkerTakeCap: 5 }) }),
);

export function churnPlan(): SweepCase[] {
  const base = SIM_PILOT_1;
  const v = (decision: string, label: string, patch: Parameters<typeof variantOf>[2]): SweepCase => ({ decision, label, ruleset: variantOf(base, label, patch), population: STUDY_POPULATION });
  const ch = { holding: { takeover: { ...TWO_DAY_CHALLENGE } } };
  return [
    { decision: "A9", label: "immediate (sim-pilot-1)", ruleset: { ...base } as SimRuleset, population: STUDY_POPULATION },
    v("A9", "two-day-challenge", ch),
    v("cap", "unit-flip-cap-1", { holding: { takeover: { ...UNIT_FLIP_CAP_1 } } }),
    v("cap", "walker-take-cap-5", { churn: churn({ walkerTakeCap: 5 }) }),
    v("defence", "home-defence-2d", { churn: churn({ homeDefenceDays: 2 }) }),
    v("defence", "challenge+home-defence-2d", { ...ch, churn: churn({ homeDefenceDays: 2 }) }),
    v("D9", "fortify-1ds-7d", { churn: churn({ fortify: { ...FORTIFY_PILOT } }) }),
    v("D9", "challenge+fortify-1ds-7d", { ...ch, churn: churn({ fortify: { ...FORTIFY_PILOT } }) }),
    v("D5", "zones-76m-in-201m", { unitEdgeMeters: 76, churn: churn({ zoneEdgeMeters: 201 }) }),
    v("farm", "repeat-route-unscored-3", { churn: churn({ repeatRouteUnscoredDays: 3 }) }),
    { decision: "combined", label: "challenge+take-cap-5 (201 m)", ruleset: SIM_PILOT_2_AT_201M as SimRuleset, population: STUDY_POPULATION },
    { decision: "combined", label: "sim-pilot-2", ruleset: SIM_PILOT_2 as SimRuleset, population: STUDY_POPULATION },
  ];
}

/** Continuity with docs/SIM_PILOT_RULESET.md: both pilots on the default population, no griefers, no attrition. */
export function continuityPlan(): SweepCase[] {
  return [
    { decision: "context", label: "sim-pilot-1 (default population)", ruleset: { ...SIM_PILOT_1 } as SimRuleset },
    { decision: "context", label: "sim-pilot-2 (default population)", ruleset: { ...SIM_PILOT_2 } as SimRuleset },
  ];
}

/** Options every churn run shares. */
export const CHURN_RUN = Object.freeze({ attrition: STUDY_ATTRITION });

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export const CHURN_COLUMNS: Column[] = [
  { head: "flips/100 held/day", get: (r) => r.takeover.flipsPer100HeldPerDay, digits: 1 },
  { head: "turnover/100 held/day", get: (r) => r.churn.dailyTurnoverPer100Held, digits: 1 },
  { head: "casual hold d30", get: (r) => r.retention.casual[0], digits: 2 },
  { head: "casual hold d60", get: (r) => r.retention.casual[1], digits: 2 },
  { head: "casual hold d90", get: (r) => r.retention.casual[2], digits: 2 },
  { head: "regular hold d30", get: (r) => r.retention.regular[0], digits: 2 },
  { head: "regular hold d60", get: (r) => r.retention.regular[1], digits: 2 },
  { head: "regular hold d90", get: (r) => r.retention.regular[2], digits: 2 },
  { head: "heavy hold d30", get: (r) => r.retention.heavy[0], digits: 2 },
  { head: "heavy hold d60", get: (r) => r.retention.heavy[1], digits: 2 },
  { head: "heavy hold d90", get: (r) => r.retention.heavy[2], digits: 2 },
  { head: "L2+ end", get: (r) => r.d16.shareL2PlusAtEnd, digits: 3 },
];

export const CHURN_COLUMNS_2: Column[] = [
  { head: "casual playing d90", get: (r) => r.churn.playing.casual[2], digits: 2 },
  { head: "regular playing d90", get: (r) => r.churn.playing.regular[2], digits: 2 },
  { head: "heavy playing d90", get: (r) => r.churn.playing.heavy[2], digits: 2 },
  { head: "griefer ha taken/active day", get: (r) => r.churn.grieferKm2PerActiveDay * 100, digits: 1 },
  { head: "honest ha lost to griefers/plr", get: (r) => r.churn.honestKm2LostToGriefersPerPlayer * 100, digits: 1 },
  { head: "heavy+griefer share of held", get: (r) => r.churn.heavyShareOfHeldAtEnd, digits: 2 },
  { head: "colluder hold x", get: (r) => r.churn.colluderHoldRatio, digits: 2 },
  { head: "colluder flips/day", get: (r) => r.d23.colluderFlipsPerDay, digits: 1 },
  { head: "route-farmer credit share", get: (r) => r.churn.routeFarmerCreditShare, digits: 3 },
  { head: "gini", get: (r) => r.credits.gini, digits: 3 },
  { head: "issued/pool", get: (r) => r.churn.issuedShareOfPool, digits: 4 },
  { head: "one-push violations", get: (r) => r.books.dailyLimitViolations, digits: 0 },
  { head: "books ok", get: (r) => (booksOk(r) ? 1 : 0), digits: 0 },
];

export const CHURN_DETAIL: Column[] = [
  { head: "held units/day", get: (r) => ratio(r.takeover.flipsPerDay * 100, r.takeover.flipsPer100HeldPerDay), digits: 0 },
  { head: "units", get: (r) => r.units, digits: 0 },
  { head: "zones", get: (r) => r.churn.zones, digits: 0 },
  { head: "one-push refusals", get: (r) => r.books.dailyLimitRefusals, digits: 0 },
  { head: "walker-cap refusals", get: (r) => r.churn.walkerCapRefusals, digits: 0 },
  { head: "level-ups", get: (r) => r.d16.levelUps, digits: 0 },
  { head: "fortify buys", get: (r) => r.churn.fortifyPurchases, digits: 0 },
  { head: "fortify spend", get: (r) => r.churn.fortifySpendMicro / 1e6, digits: 0 },
  { head: "level spend", get: (r) => r.books.simLevelSpendMicro / 1e6, digits: 0 },
  { head: "upkeep taken", get: (r) => r.books.upkeepTakenMicro / 1e6, digits: 0 },
  { head: "upkeep in condition", get: (r) => r.books.upkeepInConditionMicro / 1e6, digits: 0 },
  { head: "farmer sessions unscored", get: (r) => r.churn.routeFarmerSessionsUnscored, digits: 2 },
  { head: "honest sessions unscored", get: (r) => r.churn.honestSessionsUnscored, digits: 3 },
  { head: "griefer flips/active day", get: (r) => r.churn.grieferFlipsPerActiveDay, digits: 1 },
  { head: "casual lost flip/plr", get: (r) => r.takeover.casualLostToFlipPerPlayer, digits: 1 },
  { head: "kingmaker d-days", get: (r) => r.d18.kingmakerDistrictDays, digits: 1 },
  { head: "shield lost/plr", get: (r) => r.d23.shieldUnitsLostPerShielder, digits: 0 },
];

export type { SimResult };
