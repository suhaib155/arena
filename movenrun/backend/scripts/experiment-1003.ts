/**
 * SIMULATION ONLY: experiment 1003 (take-budget reform) against 1001 and
 * 1002 on identical seeds (backend/src/gameplay/experiments/harness1003.ts).
 * Writes the CSVs of docs/sim/1003/ and prints the Markdown tables of
 * docs/G34_1003_EXPERIMENT.md. Synthetic behaviour assumptions; not evidence
 * about real players. HYPOTHESIS, credits-only.
 *
 *   node --import tsx scripts/experiment-1003.ts [seeds=5] [days=90] [outDir=../docs/sim/1003]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_1003, RUNS_1003, experiment1003Seed, prepare1003, type CohortRow, type Run1003Row } from "../src/gameplay/experiments/harness1003.js";
import { ADVERSARY_1003, COHORTS_1003, COHORT_1003_LABEL, HONEST_1003, type Cohort1003 } from "../src/gameplay/experiments/population1003.js";
import { getHexagonAreaAvg } from "h3-js";

const seeds = Number(process.argv[2] ?? 5);
const days = Number(process.argv[3] ?? DEFAULT_1003.days);
const outDir = process.argv[4] ?? join(import.meta.dirname, "../../docs/sim/1003");
mkdirSync(outDir, { recursive: true });

const SEEDS = Array.from({ length: seeds }, (_, i) => i + 1);
const runs: Run1003Row[][] = [];
const seedRows: string[] = ["seed,population_prng_seed,days,accounts,sessions_generated"];
for (const seed of SEEDS) {
  const spec = { ...DEFAULT_1003, days, seed };
  const prep = prepare1003(spec);
  seedRows.push([seed, seed ^ 0x1003, days, prep.walkers.length, prep.sessions.length].join(","));
  runs.push(experiment1003Seed(seed, { days }));
  process.stderr.write(`seed ${seed} done\n`);
}
const LABELS = RUNS_1003.map((r) => r.label);
const accounts = Object.values(DEFAULT_1003.counts).reduce((a, b) => a + b, 0);

// ── raw CSVs ───────────────────────────────────────────────────────────────
writeFileSync(join(outDir, "seeds.csv"), seedRows.join("\n") + "\n");
const unitRows = ["label,ruleset,holding_rules_version,unit,unit_resolution,unit_area_km2_avg,zone,takeover,second_push_gap_h,budget_counting,budget_per_walker_per_day,budget_mode,soft_strength,incidental_strength,daily_unit_capacity_guard"];
for (const cfg of RUNS_1003) {
  const r = cfg.kind === "server" ? cfg.rules : cfg.exp.rules;
  const res = r.units.unit.kind === "h3" ? r.units.unit.resolution : 8;
  const tk = r.takeover;
  const gap = tk.name === "two-day-challenge" && tk.policyVersion === 2 ? tk.secondPush.minElapsedMs / 3_600_000 : "";
  const b = cfg.kind === "1003" ? cfg.exp.budget : null;
  unitRows.push([
    cfg.label, r.ruleset, r.holding.rulesVersion, r.units.unit.kind === "h3" ? "h3-session-path" : "stored-cell", res, getHexagonAreaAvg(res, "km2").toFixed(6),
    r.units.zone.kind === "h3-parent" ? `h3-parent-res${r.units.zone.resolution}` : "unit",
    tk.name === "immediate" ? "immediate (A9)" : `two-day-challenge window ${tk.windowDays} floor ${tk.floor} immediate-below ${tk.immediateBelowStrength}`, gap,
    b ? b.counting : r.takeBudget ? r.takeBudget.counting : "none", b ? (b.perWalkerPerDay ?? "none") : r.takeBudget ? r.takeBudget.perWalkerPerDay : "none",
    b ? b.mode : r.takeBudget ? "hard" : "", b?.mode === "soft" ? b.softStrength : "", b?.incidentalStrength ?? "", DEFAULT_1003.unitBudget,
  ].join(","));
}
writeFileSync(join(outDir, "units.csv"), unitRows.join("\n") + "\n");
const fields = Object.keys(runs[0]![0]!.cohorts.commuter) as (keyof CohortRow)[];
const cohortCsv = [["seed", "label", "cohort", ...fields].join(",")];
for (const rows of runs) for (const r of rows) for (const c of COHORTS_1003) cohortCsv.push([r.seed, r.label, c, ...fields.map((f) => r.cohorts[c][f])].join(","));
writeFileSync(join(outDir, "per_seed_cohort.csv"), cohortCsv.join("\n") + "\n");
const mapCsv = ["seed,label,unit_area_km2,held_end_units,top10_share,adversary_flips_on_honest,honest_flips_on_honest,ledger_rows,unit_rows,challenge_marks_end,accepted_sessions,"
  + "review2_flagged_household,review2_flagged_sibling,review2_flagged_duplicate,review2_wrongly_upheld,review3_flagged_household,review3_flagged_sibling,review3_flagged_duplicate,review3_wrongly_upheld"];
for (const rows of runs) for (const r of rows) {
  mapCsv.push([r.seed, r.label, r.unitAreaKm2.toFixed(6), r.heldEndUnits, r.top10Share.toFixed(4), r.adversaryFlipsOnHonest, r.honestFlipsOnHonest, r.ledgerRows, r.unitRows, r.challengeMarksEnd, r.acceptedSessions,
    r.review2.flaggedGroups.household ?? 0, r.review2.flaggedGroups.sibling ?? 0, r.review2.flaggedGroups.duplicate ?? 0, r.review2.wronglyUpheld,
    r.review3.flaggedGroups.household ?? 0, r.review3.flaggedGroups.sibling ?? 0, r.review3.flaggedGroups.duplicate ?? 0, r.review3.wronglyUpheld].join(","));
}
writeFileSync(join(outDir, "per_seed_map.csv"), mapCsv.join("\n") + "\n");

// ── summary metrics ────────────────────────────────────────────────────────
const sum = (r: Run1003Row, cs: readonly Cohort1003[], f: (x: CohortRow) => number) => cs.reduce((a, c) => a + f(r.cohorts[c]), 0);
interface Metric { name: string; scope: string; den: string; f: (r: Run1003Row) => [number, number] | number; digits: number; pct?: boolean }
const H = HONEST_1003, A = ADVERSARY_1003;
const metrics: Metric[] = [
  { name: "blocked pushes on others' ground", scope: "honest", den: "honest pushes on ground another walker held (pass-through + contested + flips + hard refusals)", pct: true, digits: 1,
    f: (r) => [sum(r, H, (x) => x.budgetHard + x.budgetSoft), sum(r, H, (x) => x.pushesOnOthers)] },
  { name: "walker-days with a blocked push", scope: "honest", den: "honest active walker-days", pct: true, digits: 1,
    f: (r) => [sum(r, H, (x) => x.walkerDaysBlocked), sum(r, H, (x) => x.activeWalkerDays)] },
  ...(["commuter", "runner", "long", "shared", "household", "transit"] as const).map((c): Metric => ({
    name: `walker-days with a blocked push: ${COHORT_1003_LABEL[c]}`, scope: c, den: `${c} active walker-days`, pct: true, digits: 1,
    f: (r) => [r.cohorts[c].walkerDaysBlocked, r.cohorts[c].activeWalkerDays] })),
  { name: "sessions that claimed or defended", scope: "honest", den: "honest accepted sessions", pct: true, digits: 1,
    f: (r) => [sum(r, H, (x) => x.sessionsWithAccess), sum(r, H, (x) => x.sessions)] },
  { name: "false reviews (2+ candidate) per 1,000 honest accounts", scope: "households + siblings", den: "honest accounts", digits: 1,
    f: (r) => [((r.review2.flaggedGroups.household ?? 0) + (r.review2.flaggedGroups.sibling ?? 0)) * 1000, sum(r, H, (x) => x.walkers)] },
  { name: "false reviews (3+ candidate) per 1,000 honest accounts", scope: "siblings", den: "honest accounts", digits: 1,
    f: (r) => [((r.review3.flaggedGroups.household ?? 0) + (r.review3.flaggedGroups.sibling ?? 0)) * 1000, sum(r, H, (x) => x.walkers)] },
  { name: "duplicate-device groups flagged (2+)", scope: "duplicate", den: "duplicate groups", pct: true, digits: 0,
    f: (r) => [r.review2.flaggedGroups.duplicate ?? 0, r.review2.groups.duplicate ?? 0] },
  { name: "adversary flips of honest ground", scope: "adversary", den: "run total (count)", digits: 0, f: (r) => r.adversaryFlipsOnHonest },
  { name: "attack area flipped from honest walkers, km²", scope: "adversary", den: "run total; flips × unit area", digits: 3, f: (r) => r.adversaryFlipsOnHonest * r.unitAreaKm2 },
  { name: "honest flips of honest ground", scope: "honest", den: "run total (count)", digits: 0, f: (r) => r.honestFlipsOnHonest },
  { name: "adversary share of held area at end", scope: "adversary", den: "units held at end", pct: true, digits: 1, f: (r) => [sum(r, A, (x) => x.heldEndUnits), r.heldEndUnits] },
  { name: "adversary share of empty-ground claims", scope: "adversary", den: "all claims", pct: true, digits: 1, f: (r) => [sum(r, A, (x) => x.claims), sum(r, COHORTS_1003, (x) => x.claims)] },
  { name: "honest empty-ground claims per active walker-day", scope: "honest", den: "honest active walker-days", digits: 2, f: (r) => [sum(r, H, (x) => x.claims), sum(r, H, (x) => x.activeWalkerDays)] },
  { name: "honest share of held area at end (day-N control)", scope: "honest", den: "units held at end", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.heldEndUnits), r.heldEndUnits] },
  { name: "honest walkers holding ground at end", scope: "honest", den: "honest accounts", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.walkersWithGround), sum(r, H, (x) => x.walkers)] },
  { name: "top 10% of accounts' share of held area at end", scope: "all", den: "units held at end", pct: true, digits: 1, f: (r) => r.top10Share },
  { name: "adversary flips per adversary active day", scope: "adversary", den: "adversary active walker-days", digits: 2, f: (r) => [sum(r, A, (x) => x.flips), sum(r, A, (x) => x.activeWalkerDays)] },
  { name: "adversary credit-eligible events per active day", scope: "adversary", den: "adversary active walker-days", digits: 2, f: (r) => [sum(r, A, (x) => x.rewardEvents), sum(r, A, (x) => x.activeWalkerDays)] },
  { name: "ring flips per ring active day", scope: "ring", den: "ring active walker-days", digits: 2, f: (r) => [r.cohorts.ring.flips, r.cohorts.ring.activeWalkerDays] },
  { name: "honest credit-eligible events per active day", scope: "honest", den: "honest active walker-days", digits: 2, f: (r) => [sum(r, H, (x) => x.rewardEvents), sum(r, H, (x) => x.activeWalkerDays)] },
  { name: "honest pushes on others: pass-through share", scope: "honest", den: "honest pushes on others", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.passThrough), sum(r, H, (x) => x.pushesOnOthers)] },
  { name: "honest pushes on others: contested share", scope: "honest", den: "honest pushes on others", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.contested), sum(r, H, (x) => x.pushesOnOthers)] },
  { name: "honest pushes on others: confirmed-flip share", scope: "honest", den: "honest pushes on others", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.flips), sum(r, H, (x) => x.pushesOnOthers)] },
  { name: "one-push rule refusals (independent of budget)", scope: "all", den: "run total (count)", digits: 0, f: (r) => sum(r, COHORTS_1003, (x) => x.dailyLimitRefused) },
  { name: "unit-capacity (300) refusals", scope: "all", den: "run total (count)", digits: 0, f: (r) => sum(r, COHORTS_1003, (x) => x.unitBudgetRefused) },
  { name: "load: ledger rows per accepted session", scope: "all", den: "accepted sessions", digits: 1, f: (r) => [r.ledgerRows, r.acceptedSessions] },
  { name: "load: unit rows at end", scope: "all", den: "count", digits: 0, f: (r) => r.unitRows },
  { name: "load: open challenge marks at end", scope: "all", den: "count", digits: 0, f: (r) => r.challengeMarksEnd },
];

const stats = (v: number[]) => {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, sd, min: Math.min(...v), max: Math.max(...v) };
};
const summary = ["metric,label,scope,mean,sd,min,max,n_seeds,numerator_sum,denominator_sum,denominator_definition"];
const cell = new Map<string, string>();
for (const m of metrics) for (const [i, label] of LABELS.entries()) {
  const per = runs.map((rows) => m.f(rows[i]!));
  const vals = per.map((x) => (Array.isArray(x) ? (x[1] === 0 ? 0 : x[0] / x[1]) : x));
  const num = per.reduce<number>((a, x) => a + (Array.isArray(x) ? x[0] : x), 0);
  const den = per.reduce<number>((a, x) => a + (Array.isArray(x) ? x[1] : 0), 0);
  const s = stats(vals);
  summary.push([JSON.stringify(m.name), label, m.scope, s.mean.toFixed(6), s.sd.toFixed(6), s.min.toFixed(6), s.max.toFixed(6), vals.length, num.toFixed(3), Array.isArray(per[0]) ? den : "", JSON.stringify(m.den)].join(","));
  const k = m.pct ? 100 : 1;
  const f = (x: number) => (x * k).toFixed(m.digits);
  cell.set(`${m.name}|${label}`, s.min === s.max ? `${f(s.mean)}${m.pct ? "%" : ""}` : `${f(s.mean)}${m.pct ? "%" : ""} ±${f(s.sd)} (${f(s.min)}–${f(s.max)})`);
}
writeFileSync(join(outDir, "summary.csv"), summary.join("\n") + "\n");

console.log(`SIMULATION ONLY. Synthetic players. ${seeds} seeds (${SEEDS.join(", ")}), ${days} days, ${accounts} accounts per seed. Mean ±sample sd (min–max) across seeds.\n`);
console.log(`| Metric (denominator) | ${LABELS.join(" | ")} |`);
console.log(`|---|${LABELS.map(() => "---").join("|")}|`);
for (const m of metrics) console.log(`| ${m.name} (${m.den}) | ${LABELS.map((l) => cell.get(`${m.name}|${l}`)).join(" | ")} |`);
