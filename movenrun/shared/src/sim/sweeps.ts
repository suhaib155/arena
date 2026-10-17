/**
 * Variant sweeps over the pilot ruleset: one decision changed at a time, each
 * run over the same seeds so behaviour draws match across variants. Results
 * are aggregated as the mean over seeds with the min and max. SIMULATION ONLY.
 */

import type { DistrictControlRule } from "../domain/clubsDistricts";
import { SIM_PILOT_1, variantOf, type SimRuleset } from "./pilotRuleset";
import { simulate, type SimOptions, type SimResult } from "./simulate";
import { DEFAULT_POPULATION, type PopulationSpec } from "./world";

export interface SweepCase {
  decision: string;
  label: string;
  ruleset: SimRuleset;
  /** Context runs change the synthetic population or city, not a rule. */
  population?: PopulationSpec;
  cityRadiusMeters?: number;
}

/**
 * Context: a population large enough that the daily pool, not the ceilings,
 * decides rewards (about 5,000 players, at the pilot's density). Slow; run on
 * its own with `--pool`.
 */
export function poolContextCase(base: Readonly<SimRuleset> = SIM_PILOT_1): SweepCase {
  const k = 14;
  const p = DEFAULT_POPULATION;
  return {
    decision: "context",
    label: "pool-binds-5k",
    ruleset: { ...base } as SimRuleset,
    population: { casual: p.casual * k, regular: p.regular * k, heavy: p.heavy * k, colluder: p.colluder * k, switcher: p.switcher * k, route_farmer: p.route_farmer * k, shade_farmer: p.shade_farmer * k, honestClubs: p.honestClubs * k },
    cityRadiusMeters: Math.round(6000 * Math.sqrt(k)),
  };
}

const frac = (numerator: number, denominator: number) => ({ numerator, denominator });

/** D21: shade weight × minimum share, evaluated side by side on every run. */
export const CONTROL_VARIANTS: { label: string; rule: DistrictControlRule }[] = [];
for (const [sl, sw] of [["0.25", frac(1, 4)], ["0.5", frac(1, 2)], ["1", frac(1, 1)]] as const) {
  for (const [ml, ms] of [["1/4", frac(1, 4)], ["1/3", frac(1, 3)], ["1/2", frac(1, 2)]] as const) {
    CONTROL_VARIANTS.push({ label: `shade ${sl}, min ${ml}`, rule: { shadeWeight: sw, minShare: ms } });
  }
}

export function sweepPlan(base: Readonly<SimRuleset> = SIM_PILOT_1): SweepCase[] {
  const v = (decision: string, label: string, patch: Parameters<typeof variantOf>[2]): SweepCase => ({ decision, label, ruleset: variantOf(base, label, patch) });
  return [
    { decision: "pilot", label: "pilot", ruleset: { ...base } as SimRuleset },
    v("D4", "decay-2", { holding: { solidDecayPerDay: 2 } }),
    v("D4", "decay-5", { holding: { solidDecayPerDay: 5 } }),
    v("D4", "decay-8", { holding: { solidDecayPerDay: 8 } }),
    v("D5", "unit-531m", { unitEdgeMeters: 531 }),
    v("D5", "unit-76m", { unitEdgeMeters: 76 }),
    v("D2", "no-sprawl-no-reject", { shade: { fullStrengthEnclosedPerStepped: null, minShape: 0 } }),
    v("D2", "sprawl-no-reject", { shade: { minShape: 0 } }),
    v("D14", "condition-none", { upkeepCondition: "none" }),
    v("D14", "condition-weakest", { upkeepCondition: "proportional_weakest_first" }),
    v("D14", "condition-all", { upkeepCondition: "all_unvisited" }),
    v("D15", "shade-pays-upkeep", { shadeCountsAsHeld: true }),
    v("D16", "no-restore", { levelOnLoss: { reclaimRestoreDays: 0 } }),
    v("D16", "drop-two-restore", { levelOnLoss: { newHolder: "drop_two" } }),
    v("D17", "away-none", { awayDays: { mode: "none" } }),
    v("D17", "away-player-selected", { awayDays: { mode: "player_selected" } }),
    v("D18", "switch-same-day", { clubs: { changeEffective: "same_day" } }),
    v("D23", "club-mate-immune", { clubMateErosion: "immune" }),
    // Context, not decisions: how much of the churn is density and attackers.
    { decision: "context", label: "half-population", ruleset: { ...base } as SimRuleset, population: halve(DEFAULT_POPULATION) },
    { decision: "context", label: "no-attackers", ruleset: { ...base } as SimRuleset, population: { ...DEFAULT_POPULATION, heavy: 0, switcher: 0 } },
  ];
}

function halve(p: PopulationSpec): PopulationSpec {
  const h = (n: number) => Math.max(1, Math.round(n / 2));
  return { ...p, casual: h(p.casual), regular: h(p.regular), heavy: h(p.heavy), colluder: h(p.colluder), switcher: h(p.switcher), route_farmer: h(p.route_farmer), shade_farmer: h(p.shade_farmer) };
}

export interface Agg {
  mean: number;
  min: number;
  max: number;
}

export const agg = (xs: readonly number[]): Agg => ({
  mean: xs.reduce((a, b) => a + b, 0) / (xs.length || 1),
  min: Math.min(...xs),
  max: Math.max(...xs),
});

export interface CaseResult {
  decision: string;
  label: string;
  ruleset: string;
  runs: SimResult[];
}

export function runSweeps(opts: { seeds: number[]; cases?: SweepCase[]; base?: Omit<SimOptions, "seed" | "ruleset">; onRun?: (c: SweepCase, seed: number, ms: number) => void }): CaseResult[] {
  const cases = opts.cases ?? sweepPlan();
  return cases.map((c) => ({
    decision: c.decision,
    label: c.label,
    ruleset: c.ruleset.name,
    runs: opts.seeds.map((seed) => {
      const t = Date.now();
      const r = simulate({ controlVariants: CONTROL_VARIANTS, ...opts.base, ...(c.population ? { population: c.population } : {}), ...(c.cityRadiusMeters ? { cityRadiusMeters: c.cityRadiusMeters } : {}), seed, ruleset: c.ruleset });
      opts.onRun?.(c, seed, Date.now() - t);
      return r;
    }),
  }));
}

/* ── tables ───────────────────────────────────────────────────────────────── */

export interface Column {
  head: string;
  get: (r: SimResult) => number;
  digits: number;
}

export const MAIN_COLUMNS: Column[] = [
  { head: "casual d30", get: (r) => r.retention.casual[0], digits: 2 },
  { head: "casual d60", get: (r) => r.retention.casual[1], digits: 2 },
  { head: "casual d90", get: (r) => r.retention.casual[2], digits: 2 },
  { head: "regular d90", get: (r) => r.retention.regular[2], digits: 2 },
  { head: "flips/100 held/day", get: (r) => r.takeover.flipsPer100HeldPerDay, digits: 1 },
  { head: "casual lost flip", get: (r) => r.takeover.casualLostToFlipPerPlayer, digits: 1 },
  { head: "casual lost decay", get: (r) => r.takeover.casualLostToDecayPerPlayer, digits: 2 },
  { head: "gini", get: (r) => r.credits.gini, digits: 3 },
  { head: "top10%", get: (r) => r.credits.top10Share, digits: 3 },
  { head: "route-farm x", get: (r) => r.d19.pilot.routeFarmerRatio, digits: 2 },
  { head: "shade-farm x", get: (r) => r.d19.pilot.shadeFarmerRatio, digits: 2 },
  { head: "kingmaker d-days", get: (r) => r.d18.kingmakerDistrictDays, digits: 1 },
  { head: "shield lost/plr", get: (r) => r.d23.shieldUnitsLostPerShielder, digits: 0 },
  { head: "cond. decays", get: (r) => r.d14.conditionDecays, digits: 0 },
  { head: "restores", get: (r) => r.d16.restores, digits: 0 },
  { head: "away used", get: (r) => r.d17.awayDaysUsed, digits: 0 },
  { head: "books ok", get: (r) => (booksOk(r) ? 1 : 0), digits: 0 },
];

export function booksOk(r: SimResult): boolean {
  const b = r.books;
  return (
    b.daysRefused === 0 &&
    b.identityFailures === 0 &&
    b.seasonStatus === "settled" &&
    b.issuedMicro + b.returnedMicro === b.poolMicro &&
    b.retriesSkipped === b.retriesSent &&
    b.rejectedEvents === 0 &&
    b.dailyLimitViolations === 0
  );
}

/** Decision-specific detail, one row per case. */
export const DETAIL_COLUMNS: Column[] = [
  { head: "held units/day", get: (r) => r.takeover.flipsPerDay / (r.takeover.flipsPer100HeldPerDay / 100 || 1), digits: 0 },
  { head: "daily-limit refusals", get: (r) => r.books.dailyLimitRefusals, digits: 0 },
  { head: "upkeep taken", get: (r) => r.books.upkeepTakenMicro / 1e6, digits: 0 },
  { head: "upkeep in condition", get: (r) => r.books.upkeepInConditionMicro / 1e6, digits: 0 },
  { head: "cond. losses", get: (r) => r.d14.conditionLosses, digits: 0 },
  { head: "level-ups", get: (r) => r.d16.levelUps, digits: 0 },
  { head: "L2+ share end", get: (r) => r.d16.shareL2PlusAtEnd, digits: 3 },
  { head: "casual away/plr", get: (r) => r.d17.casualProtectedDaysPerPlayer, digits: 2 },
  { head: "switches", get: (r) => r.d18.switches, digits: 0 },
  { head: "immune dropped", get: (r) => r.d23.immuneDropped, digits: 0 },
  { head: "club-mate pushes/day", get: (r) => r.takeover.clubMatePushesPerDay, digits: 1 },
  { head: "colluder flips/day", get: (r) => r.d23.colluderFlipsPerDay, digits: 1 },
  { head: "shade loops rejected", get: (r) => r.shade.shadeRejectedLoops, digits: 0 },
  { head: "shade units end", get: (r) => r.shade.shadeUnitsHeldAtEnd, digits: 0 },
  { head: "shade-farm upkeep", get: (r) => r.shade.shadeFarmerUpkeepPaidMicro / 1e6, digits: 1 },
];

const fmt = (n: number, d: number) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

function cell(a: Agg, d: number): string {
  if (a.min === a.max) return fmt(a.mean, d);
  return `${fmt(a.mean, d)} (${fmt(a.min, d)}–${fmt(a.max, d)})`;
}

export function markdownTable(results: readonly CaseResult[], columns: readonly Column[] = MAIN_COLUMNS): string {
  const head = ["decision", "variant", ...columns.map((c) => c.head)];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of results) {
    lines.push(`| ${[r.decision, r.label, ...columns.map((c) => cell(agg(r.runs.map(c.get)), c.digits))].join(" | ")} |`);
  }
  return lines.join("\n");
}
