/**
 * The G5–G7 research runs: deed reachability per context and deed rule,
 * emission and sink projections per conversion option, and Sybil break-even
 * tables. SIMULATION_ONLY_NOT_PRODUCTION: every configuration below is a
 * research comparator, not a proposal, unless docs/G5_G7_ECONOMY_RESEARCH.md
 * says otherwise. Nothing here changes the V3 numbers or the pilot ruleset.
 */

import { SIM_ONLY, SIM_PILOT_1, variantOf, type SimRuleset } from "./pilotRuleset";
import { simulate } from "./simulate";
import type { SeasonTrace } from "./trace";
import {
  deedEligibility,
  DEED_RULES_SOURCE,
  directFarmBreakEven,
  mutualDeedRing,
  projectEconomy,
  rewardPerActiveDay,
  SINKS_TRACE_ONLY,
  tollChannelBreakEven,
  tollIncome,
  type ConversionPolicy,
  type DeedReport,
  type DeedRules,
  type EmissionConfig,
  type ProjectionResult,
  type SybilParams,
} from "./economyG5";
import { DEFAULT_POPULATION, PROFILES, type PopulationSpec, type Profile } from "./world";

export interface G5Context {
  label: string;
  ruleset: SimRuleset;
  population: PopulationSpec;
}

export const G5_CONTEXTS: G5Context[] = [
  { label: "pilot", ruleset: { ...SIM_PILOT_1 } as SimRuleset, population: DEFAULT_POPULATION },
  { label: "no-attackers", ruleset: { ...SIM_PILOT_1 } as SimRuleset, population: { ...DEFAULT_POPULATION, heavy: 0, switcher: 0 } },
  { label: "unit-76m", ruleset: variantOf(SIM_PILOT_1, "unit-76m", { unitEdgeMeters: 76 }), population: DEFAULT_POPULATION },
  { label: "unit-76m-no-attackers", ruleset: variantOf(SIM_PILOT_1, "unit-76m", { unitEdgeMeters: 76 }), population: { ...DEFAULT_POPULATION, heavy: 0, switcher: 0 } },
];

const rules = (label: string, tenureDays: number, distinctCrossers: number, trafficDays: number, extra: Partial<DeedRules> = {}): DeedRules => ({
  ...DEED_RULES_SOURCE,
  label,
  tenureDays,
  distinctCrossers,
  trafficDays,
  ...extra,
});

/** The source rule first; the rest are comparators that show which condition binds. */
export const G5_DEED_RULES: DeedRules[] = [
  { ...DEED_RULES_SOURCE },
  rules("tenure 14 (comparator)", 14, 30, 10),
  rules("traffic 10/5 (comparator)", 21, 10, 5),
  rules("7 days, 5 crossers / 3 days (comparator)", 7, 5, 3),
  rules("7/5/3 + city cap 1% (comparator)", 7, 5, 3, { cityCapShare: 0.01 }),
  rules("7/5/3 + per-holder cap 1 (comparator)", 7, 5, 3, { perHolderCap: 1 }),
];

const MOVE = 1_000_000;
const COMPARATOR_DEEDS = G5_DEED_RULES[3]!;

const cfg = (label: string, policy: ConversionPolicy, populationBySeason: number[], extra: Partial<EmissionConfig> = {}): EmissionConfig => ({
  label,
  status: SIM_ONLY,
  economyRulesVersion: SIM_PILOT_1.economyRulesVersion,
  schedule: "v3",
  populationBySeason,
  policy,
  sinks: SINKS_TRACE_ONLY,
  deedRules: DEED_RULES_SOURCE,
  ...extra,
});

const FOUR = (k: number) => [k, k, k, k];
/** ~14,700 players: forty copies of the 368-player pilot population, where the season-one pool starts to bind. */
const BIG = 40;

export const G5_EMISSION_CONFIGS: EmissionConfig[] = [
  cfg("Play V1: no conversion, 368 players", { kind: "none" }, FOUR(1)),
  cfg("no conversion, ~15k players", { kind: "none" }, FOUR(BIG)),
  cfg("V3 §21 as written, ~15k players (source deed rule)", { kind: "v3_source", valveShareOfMint: null }, FOUR(BIG)),
  cfg("V3 §21, ~15k, comparator deeds 7/5/3, no valve", { kind: "v3_source", valveShareOfMint: null }, FOUR(BIG), { deedRules: COMPARATOR_DEEDS }),
  cfg("V3 §21, ~15k, comparator deeds, valve 1% of mint", { kind: "v3_source", valveShareOfMint: 0.01 }, FOUR(BIG), { deedRules: COMPARATOR_DEEDS }),
  cfg("§21 legal fallback (all locked), ~15k", { kind: "locked_only" }, FOUR(BIG), { deedRules: COMPARATOR_DEEDS }),
  cfg("capped conversion 0.5, 300/season, ~15k", { kind: "capped_conversion", ratio: 0.5, capPerAccountPerSeasonMicro: 300 * MOVE }, FOUR(BIG)),
  cfg("all liquid (breaks rule 11; comparator), ~15k", { kind: "liquid_all" }, FOUR(BIG)),
  cfg("V3 §21, comparator deeds, growth 368→29k", { kind: "v3_source", valveShareOfMint: null }, [1, 10, 40, 80], { deedRules: COMPARATOR_DEEDS }),
  cfg("V3 §21, comparator deeds, ~15k, heavy sinks", { kind: "v3_source", valveShareOfMint: null }, FOUR(BIG), {
    deedRules: COMPARATOR_DEEDS,
    sinks: { label: "heavy sinks", levelSpend: true, deedClaimFeeDayShares: 5, discretionaryShareOfBalance: 0.1, seasonEndBurnShareOfLocked: 0.1 },
  }),
  cfg("flat season-1 pool (comparator), no conversion, growth 368→29k", { kind: "none" }, [1, 10, 40, 80], { schedule: "flat_s1" }),
];

export const SYBIL_COSTS = [0.05, 0.25, 1];
export const SYBIL_DETECTION = [0, 0.3, 0.6];

export interface DeedRow {
  context: string;
  seed: number;
  rules: string;
  report: DeedReport;
  tollTotalMicro: number;
  tollMaxDeedSeasonMicro: number;
}

export interface G5Run {
  status: typeof SIM_ONLY;
  seeds: number[];
  deeds: DeedRow[];
  projections: { seed: number; result: ProjectionResult }[];
  rewardPerActiveDay: Record<Profile, number>;
  sybil: { policy: string; cost: number; detection: number; direct: number; ring: number; ringSize: number | null; toll: number }[];
}

export function runG5(opts: { seeds: number[]; contexts?: G5Context[]; days?: number; cityRadiusMeters?: number; population?: PopulationSpec; onRun?: (label: string, seed: number, ms: number) => void }): G5Run {
  const contexts = opts.contexts ?? G5_CONTEXTS.slice(0, 2);
  const deeds: DeedRow[] = [];
  const projections: G5Run["projections"] = [];
  let pilotTrace: SeasonTrace | null = null;
  for (const ctx of contexts) {
    for (const seed of opts.seeds) {
      const t0 = Date.now();
      const trace = simulate({ seed, ruleset: ctx.ruleset, population: opts.population ?? ctx.population, days: opts.days, cityRadiusMeters: opts.cityRadiusMeters, trace: true }).trace!;
      opts.onRun?.(ctx.label, seed, Date.now() - t0);
      for (const r of G5_DEED_RULES) {
        const report = deedEligibility(trace, r);
        const t = tollIncome(trace, report);
        deeds.push({ context: ctx.label, seed, rules: r.label, report, tollTotalMicro: t.totalMicro, tollMaxDeedSeasonMicro: t.maxDeedSeasonMicro });
      }
      if (ctx === contexts[0]) {
        if (pilotTrace === null) pilotTrace = trace;
        for (const c of G5_EMISSION_CONFIGS) projections.push({ seed, result: projectEconomy(trace, c) });
      }
    }
  }
  const reward = rewardPerActiveDay(pilotTrace!);
  const sybil: G5Run["sybil"] = [];
  const policies: [string, ConversionPolicy][] = [
    ["none", { kind: "none" }],
    ["V3 §21", { kind: "v3_source", valveShareOfMint: null }],
    ["legal fallback", { kind: "locked_only" }],
    ["capped 0.5 / 300", { kind: "capped_conversion", ratio: 0.5, capPerAccountPerSeasonMicro: 300 * MOVE }],
    ["all liquid", { kind: "liquid_all" }],
  ];
  for (const [name, policy] of policies) {
    for (const cost of SYBIL_COSTS) {
      for (const detection of SYBIL_DETECTION) {
        const p: SybilParams = { costPerAccountDay: cost, detectionRate: detection, trustWeight: 1, rewardPerDayMicro: reward.route_farmer };
        const ring = mutualDeedRing(policy, DEED_RULES_SOURCE, p);
        sybil.push({ policy: name, cost, detection, direct: directFarmBreakEven(policy, p), ring: ring.breakEvenPrice, ringSize: ring.ringSize, toll: tollChannelBreakEven(policy, p) });
      }
    }
  }
  return { status: SIM_ONLY, seeds: opts.seeds, deeds, projections, rewardPerActiveDay: reward, sybil };
}

/* ── tables ───────────────────────────────────────────────────────────────── */

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "never");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const range = (xs: number[], d = 2) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? fmt(lo, d) : `${fmt(mean(xs), d)} (${fmt(lo, d)}–${fmt(hi, d)})`;
};

export function deedTable(run: G5Run): string {
  const out = ["| Context | Deed rule | Max tenure (days) | Units reaching tenure | Most crossers at tenure | Deeds | Holders | Deeds by profile | Toll collected (MOVE-equivalent credits) |", "|---|---|---|---|---|---|---|---|---|"];
  const keys = [...new Set(run.deeds.map((r) => `${r.context}\u0000${r.rules}`))];
  for (const k of keys) {
    const [context, rule] = k.split("\u0000") as [string, string];
    const rows = run.deeds.filter((r) => r.context === context && r.rules === rule);
    const byProfile = PROFILES.map((p) => [p, mean(rows.map((r) => r.report.deedsByProfile[p]))] as const)
      .filter(([, v]) => v > 0)
      .map(([p, v]) => `${p} ${fmt(v, 1)}`)
      .join(", ");
    out.push(
      `| ${context} | ${rule} | ${range(rows.map((r) => r.report.maxTenureDays), 0)} | ${range(rows.map((r) => r.report.unitsReachingTenure), 0)} | ${range(rows.map((r) => r.report.maxCrossersAtTenure), 0)} | ${range(rows.map((r) => r.report.deeds.length), 1)} | ${range(rows.map((r) => r.report.firstDeedDay.size), 1)} | ${byProfile || "—"} | ${range(rows.map((r) => r.tollTotalMicro / MOVE), 1)} |`,
    );
  }
  return out.join("\n");
}

export function projectionTable(run: G5Run, season: number): string {
  const out = [
    `| Configuration (season ${season}) | Minted (M) | Burned ÷ minted | Supply growth vs previous season | Pool binding days | Allocation used | Liquid share of supply | Gini | Top 10% | Gini liquid | Books | Pool |`,
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const labels = [...new Set(run.projections.map((p) => p.result.label))];
  for (const label of labels) {
    const rows = run.projections.filter((p) => p.result.label === label).map((p) => p.result);
    const s = rows.map((r) => r.seasons[season - 1]!);
    out.push(
      `| ${label} | ${range(s.map((x) => x.mintedMicro / MOVE / 1e6), 3)} | ${range(s.map((x) => x.burnToMint))} | ${s[0]!.inflation === null ? "—" : range(s.map((x) => x.inflation ?? 0))} | ${range(s.map((x) => x.poolBindingDays), 0)} | ${range(s.map((x) => x.allocationUsed * 100), 3)}% | ${range(s.map((x) => (x.supplyEndMicro ? x.liquidEndMicro / x.supplyEndMicro : 0)))} | ${range(s.map((x) => x.gini), 3)} | ${range(s.map((x) => x.top10Share), 3)} | ${range(s.map((x) => x.giniLiquid), 3)} | ${rows.every((r) => r.booksBalanced) ? "ok" : "FAIL"} | ${rows.every((r) => r.poolRespected) ? "ok" : "FAIL"} |`,
    );
  }
  return out.join("\n");
}

export function liquidByProfileTable(run: G5Run): string {
  const out = [`| Configuration | ${PROFILES.join(" | ")} |`, `|---|${PROFILES.map(() => "---").join("|")}|`];
  const labels = [...new Set(run.projections.map((p) => p.result.label))];
  for (const label of labels) {
    const rows = run.projections.filter((p) => p.result.label === label).map((p) => p.result);
    out.push(`| ${label} | ${PROFILES.map((p) => fmt(mean(rows.map((r) => r.liquidByProfile[p] / MOVE)), 0)).join(" | ")} |`);
  }
  return out.join("\n");
}

export function sybilTable(run: G5Run): string {
  const out = ["| Conversion | Cost per account-day | Detection | Direct farming | Mutual deed ring (members) | Toll channel |", "|---|---|---|---|---|---|"];
  for (const r of run.sybil) {
    out.push(`| ${r.policy} | ${r.cost} | ${r.detection} | ${fmt(r.direct, 3)} | ${fmt(r.ring, 3)}${r.ringSize === null ? "" : ` (${r.ringSize})`} | ${fmt(r.toll, 3)} |`);
  }
  return out.join("\n");
}
