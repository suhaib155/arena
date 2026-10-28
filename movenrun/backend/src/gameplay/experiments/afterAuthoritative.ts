/**
 * SIMULATION ONLY. The same-seed 1001 / 1002 / 1003B(5) / 1003B(3) study re-run
 * after the authoritative-push change (#152): only units holding an accepted fix
 * push. Scenarios differ in one assumption each; every scenario runs every rule
 * set on identical synthetic sessions. Credits are not simulated. Nothing here
 * changes a rule set, its digest or the default (1001). Synthetic players only;
 * not evidence about real players.
 */
import { RUNS_1003, experiment1003Seed, type CohortRow, type Experiment1003Spec, type Run1003Row, type RunConfig } from "./harness1003.js";
import { SENSITIVITY_1003 } from "./rules1003.js";
import { ADVERSARY_1003, DEFAULT_COUNTS_1003, HONEST_1003, type Cohort1003 } from "./population1003.js";

export const STUDY_RUNS: readonly RunConfig[] = [
  RUNS_1003[0]!,
  RUNS_1003[1]!,
  { label: "1003B5", kind: "1003", exp: SENSITIVITY_1003.find((x) => x.label === "1003B5")! },
  { label: "1003B3", kind: "1003", exp: SENSITIVITY_1003.find((x) => x.label === "1003B3")! },
];

export interface Scenario {
  id: string;
  title: string;
  /** What changes against the main "after" scenario, in one line. */
  change: string;
  over: Partial<Omit<Experiment1003Spec, "seed">>;
}

const scale = (cohorts: readonly Cohort1003[], k: number) =>
  ({ ...DEFAULT_COUNTS_1003, ...Object.fromEntries(cohorts.map((c) => [c, DEFAULT_COUNTS_1003[c] * k])) }) as Record<Cohort1003, number>;

export const SCENARIOS: readonly Scenario[] = [
  { id: "before", title: "Before #152 (control)", change: "Inferred units push (the pre-#152 behaviour, reproducing #149).", over: { pushInterpolated: true } },
  { id: "after", title: "After #152 (main)", change: "Authoritative pushes: only units holding an accepted fix push.", over: {} },
  { id: "thin3", title: "Sparser GPS, 30 s", change: "Every 3rd fix kept (about one fix per 30 s), same routes.", over: { fixThin: 3 } },
  { id: "thin6", title: "Sparser GPS, 60 s", change: "Every 6th fix kept (about one fix per 60 s), same routes.", over: { fixThin: 6 } },
  { id: "distance2", title: "Distance-heavy mix", change: "Runners and long-distance walkers doubled (different population draw).", over: { counts: scale(["runner", "long"], 2) } },
  { id: "hostile2", title: "Twice the hostile players", change: "Malicious walkers, spoofers and ring members doubled (different population draw).", over: { counts: scale(["malicious", "spoofer", "ring"], 2) } },
];

export function runScenario(sc: Scenario, seeds: readonly number[], days: number): Run1003Row[][] {
  return seeds.map((seed) => experiment1003Seed(seed, { ...sc.over, days }, STUDY_RUNS));
}

const sum = (r: Run1003Row, cs: readonly Cohort1003[], f: (x: CohortRow) => number) => cs.reduce((a, c) => a + f(r.cohorts[c]), 0);
const H = HONEST_1003, A = ADVERSARY_1003;

export interface Metric { key: string; name: string; den: string; f: (r: Run1003Row, days: number) => [number, number] | number; digits: number; pct?: boolean }

const cohortMetrics = (c: Cohort1003, label: string): Metric[] => [
  { key: `blocked_${c}`, name: `${label}: walker-days blocked by a cap`, den: "active walker-days", pct: true, digits: 1, f: (r) => [r.cohorts[c].walkerDaysBlocked, r.cohorts[c].activeWalkerDays] },
  { key: `flipsday_${c}`, name: `${label}: confirmed flips per active day`, den: "active walker-days", digits: 2, f: (r) => [r.cohorts[c].flips, r.cohorts[c].activeWalkerDays] },
  { key: `hold14_${c}`, name: `${label}: holding ground at day 14`, den: "accounts", pct: true, digits: 1, f: (r) => [r.cohorts[c].walkersWithGround14, r.cohorts[c].walkers] },
  { key: `hold90_${c}`, name: `${label}: holding ground at day 90`, den: "accounts", pct: true, digits: 1, f: (r) => [r.cohorts[c].walkersWithGround, r.cohorts[c].walkers] },
];

const COHORT_TABLE: readonly [Cohort1003, string][] = [
  ["commuter", "casual commuters"], ["loop", "small-loop walkers"], ["long", "long-distance walkers"], ["household", "households"], ["spoofer", "spoofers"], ["malicious", "hostile takeover players"],
];

export const STUDY_METRICS: readonly Metric[] = [
  { key: "real_pushed", name: "real units pushed (hold an accepted fix)", den: "run total", digits: 0, f: (r) => r.realUnitsPushed },
  { key: "inferred_pushed", name: "inferred units pushed", den: "run total", digits: 0, f: (r) => r.inferredUnitsPushed },
  { key: "inferred_stored", name: "inferred units stored, display only", den: "run total", digits: 0, f: (r) => r.inferredUnitsStored },
  { key: "blocked_honest_days", name: "honest walker-days blocked by caps", den: "honest active walker-days", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.walkerDaysBlocked), sum(r, H, (x) => x.activeWalkerDays)] },
  { key: "blocked_honest_pushes", name: "honest pushes on others' ground blocked", den: "honest pushes on others", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.budgetHard + x.budgetSoft), sum(r, H, (x) => x.pushesOnOthers)] },
  { key: "adv_flips_day", name: "hostile flips per hostile active day (malicious + spoofers + ring)", den: "adversary active walker-days", digits: 2, f: (r) => [sum(r, A, (x) => x.flips), sum(r, A, (x) => x.activeWalkerDays)] },
  { key: "honest_flips_day", name: "honest flips per honest active day", den: "honest active walker-days", digits: 2, f: (r) => [sum(r, H, (x) => x.flips), sum(r, H, (x) => x.activeWalkerDays)] },
  { key: "map_flips_day", name: "map-wide confirmed flips per calendar day", den: "days", digits: 1, f: (r, d) => r.flipsTotal / d },
  { key: "adv_on_honest", name: "hostile flips of honest ground (run total)", den: "count", digits: 0, f: (r) => r.adversaryFlipsOnHonest },
  { key: "empty14", name: "empty land at day 14", den: "units ever touched by day 14 (held + unheld)", pct: true, digits: 1, f: (r) => [r.unheld14, r.unheld14 + r.held14] },
  { key: "empty90", name: "empty land at day 90", den: "units ever touched", pct: true, digits: 1, f: (r) => [r.unheldEnd, r.touchedUnits] },
  { key: "heat", name: "city heat: confirmed flips per touched unit", den: "units ever touched", digits: 2, f: (r) => [r.flipsTotal, r.touchedUnits] },
  { key: "flipped2", name: "competition: units that changed hands twice or more", den: "units ever touched", pct: true, digits: 1, f: (r) => [r.unitsFlipped2plus, r.touchedUnits] },
  { key: "top10", name: "top 10% of accounts' share of held area at day 90", den: "units held", pct: true, digits: 1, f: (r) => r.top10Share },
  { key: "ret14", name: "honest walkers holding ground at day 14", den: "honest accounts", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.walkersWithGround14), sum(r, H, (x) => x.walkers)] },
  { key: "ret90", name: "honest walkers holding ground at day 90", den: "honest accounts", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.walkersWithGround), sum(r, H, (x) => x.walkers)] },
  { key: "cont", name: "honest-held units at day 14 still held by the same walker at day 90", den: "honest-held units at day 14", pct: true, digits: 1, f: (r) => [r.honestHeld14StillSameEnd, r.honestHeld14] },
  { key: "events", name: "CPU proxy: push events per accepted session", den: "accepted sessions", digits: 1, f: (r) => [r.pushEvents, r.acceptedSessions] },
  { key: "ledger", name: "storage proxy: ledger rows per accepted session", den: "accepted sessions", digits: 1, f: (r) => [r.ledgerRows, r.acceptedSessions] },
  { key: "unit_rows", name: "storage proxy: unit rows at day 90", den: "count", digits: 0, f: (r) => r.unitRows },
  { key: "path_units", name: "storage proxy: stored path units per accepted session", den: "accepted sessions", digits: 1, f: (r) => [r.storedPathUnits, r.acceptedSessions] },
  { key: "marks", name: "storage proxy: open challenge marks at day 90", den: "count", digits: 0, f: (r) => r.challengeMarksEnd },
  { key: "appeal_accounts", name: "appeal-worthy: honest accounts with a blocked day", den: "honest accounts", pct: true, digits: 1, f: (r) => [sum(r, H, (x) => x.accountsBlocked), sum(r, H, (x) => x.walkers)] },
  { key: "appeal_days_k", name: "appeal-worthy: honest blocked walker-days per 1,000 honest active days", den: "honest active walker-days", digits: 0, f: (r) => [sum(r, H, (x) => x.walkerDaysBlocked) * 1000, sum(r, H, (x) => x.activeWalkerDays)] },
  { key: "review_flags", name: "review flags on honest linked groups per 1,000 honest accounts (2+ candidate; appeal burden only, no sanction)", den: "honest accounts", digits: 1, f: (r) => [((r.review2.flaggedGroups.household ?? 0) + (r.review2.flaggedGroups.sibling ?? 0)) * 1000, sum(r, H, (x) => x.walkers)] },
  ...COHORT_TABLE.flatMap(([c, l]) => cohortMetrics(c, l)),
];

export interface SummaryRow { key: string; label: string; mean: number; sd: number; min: number; max: number; num: number; den: number }

export function stats(v: number[]) {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, sd, min: Math.min(...v), max: Math.max(...v) };
}

/** Per metric and rule set: mean, sd, min, max across seeds, plus the pooled numerator and denominator. */
export function summarize(runs: Run1003Row[][], days: number, metrics: readonly Metric[] = STUDY_METRICS): SummaryRow[] {
  const labels = runs[0]!.map((r) => r.label);
  const out: SummaryRow[] = [];
  for (const m of metrics) labels.forEach((label, i) => {
    const per = runs.map((rows) => m.f(rows[i]!, days));
    const vals = per.map((x) => (Array.isArray(x) ? (x[1] === 0 ? 0 : x[0] / x[1]) : x));
    const num = per.reduce<number>((a, x) => a + (Array.isArray(x) ? x[0] : x), 0);
    const den = per.reduce<number>((a, x) => a + (Array.isArray(x) ? x[1] : 0), 0);
    out.push({ key: m.key, label, ...stats(vals), num, den });
  });
  return out;
}

export const fmt = (m: Metric, r: SummaryRow) => {
  const k = m.pct ? 100 : 1, u = m.pct ? "%" : "";
  const f = (x: number) => (x * k).toFixed(m.digits);
  return r.min === r.max ? `${f(r.mean)}${u}` : `${f(r.mean)}${u} ±${f(r.sd)}`;
};
