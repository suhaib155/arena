/**
 * SIMULATION ONLY: group-level fairness of rule sets 1001 and 1002 on the
 * same synthetic verified walks, by cohort (backend/src/gameplay/fairness.ts).
 * Prints the Markdown tables of docs/G34_RULES_FAIRNESS_STUDY.md: every cell
 * is the mean over seeds 1..N with the min–max across seeds in brackets.
 * Synthetic behaviour assumptions; not evidence about real players.
 *
 *   node --import tsx scripts/fairness-study.ts [seeds=5] [days=28]
 */
import { COHORTS, COHORT_LABEL, DEFAULT_FAIRNESS, HONEST, fairnessSeed, type CohortStats, type Cohort, type FairnessRow, type ReviewStats } from "../src/gameplay/fairness.js";

const seeds = Number(process.argv[2] ?? 5);
const days = Number(process.argv[3] ?? DEFAULT_FAIRNESS.days);
const runs: FairnessRow[][] = [];
for (let s = 1; s <= seeds; s++) runs.push(fairnessSeed(s, { days }));
const LABELS = runs[0]!.map((r) => r.label);
const col = (label: string) => LABELS.indexOf(label);
const A = col("1001"), N = col("1002 without the gap"), B = col("1002");

function fmt(xs: (number | null)[], digits: number, suffix = ""): string {
  if (xs.every((x) => x === null)) return "–";
  xs = xs.filter((x) => x !== null);
  const v = xs as number[];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const lo = Math.min(...v), hi = Math.max(...v);
  const f = (v: number) => v.toFixed(digits);
  return lo === hi ? `${f(mean)}${suffix}` : `${f(mean)}${suffix} (${f(lo)}–${f(hi)})`;
}
const per = (c: number, cohort: Cohort, g: (s: CohortStats, row: FairnessRow) => number) => runs.map((rows) => g(rows[c]!.cohorts[cohort], rows[c]!));
const honestSum = (row: FairnessRow, g: (s: CohortStats) => number) => HONEST.reduce((a, c) => a + g(row.cohorts[c]), 0);
const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

function table(title: string, head: string[], rows: string[][]) {
  console.log(`\n#### ${title}\n`);
  console.log(`| ${head.join(" | ")} |`);
  console.log(`|${head.map(() => "---").join("|")}|`);
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
}
function cohortTable(title: string, metrics: [string, number, string, (s: CohortStats, row: FairnessRow) => number][], cols = [A, B]) {
  const head = ["Cohort (accounts)"];
  for (const [name] of metrics) for (const c of cols) head.push(`${name}, ${LABELS[c]}`);
  const rows = COHORTS.map((cohort) => {
    const r = [`${COHORT_LABEL[cohort]} (${DEFAULT_FAIRNESS.counts[cohort]})`];
    for (const [, digits, suffix, g] of metrics) for (const c of cols) r.push(fmt(per(c, cohort, g), digits, suffix));
    return r;
  });
  table(title, head, rows);
}

console.log(`SIMULATION ONLY. Synthetic players. ${seeds} seeds (1..${seeds}), ${days} days, ${Object.values(DEFAULT_FAIRNESS.counts).reduce((a, b) => a + b, 0)} accounts per seed. Mean over seeds, (min–max) across seeds.`);

// T1: headline.
cohortTable("T1. Headline: share of held area at the end, and turnover", [
  ["share of held area at end", 1, "%", (s, row) => 100 * div(s.heldEndKm2, row.totalHeldKm2)],
  ["walkers holding ground at end", 0, "%", (s) => 100 * div(s.walkersWithGround, s.walkers)],
  ["turnover (lost ÷ acquired)", 0, "%", (s) => 100 * div(s.flipsLost, s.claims + s.flipsMade)],
]);

// T2: honest (casual) totals.
{
  const head = ["Honest cohorts together (72 accounts)", ...[A, B].map((c) => LABELS[c]!)];
  const m: [string, number, string, (row: FairnessRow) => number][] = [
    ["Share of held area at end", 1, "%", (row) => 100 * div(honestSum(row, (s) => s.heldEndKm2), row.totalHeldKm2)],
    ["Honest walkers holding ground at end", 0, "%", (row) => 100 * div(honestSum(row, (s) => s.walkersWithGround), honestSum(row, (s) => s.walkers))],
    ["Held area at end (km², unit areas differ)", 2, "", (row) => honestSum(row, (s) => s.heldEndKm2)],
    ["Honest units flipped by hostile walkers or spoofers", 0, "", (row) => row.cohorts.hostile.flipsOnHonest + row.cohorts.spoofer.flipsOnHonest],
    ["Honest units flipped by other honest walkers", 0, "", (row) => honestSum(row, (s) => s.flipsOnHonest)],
    ["Map flips per unit held at end", 2, "", (row) => row.mapFlipsPerHeldUnit],
  ];
  table("T2. Honest (casual) ownership at the end of the run", head, m.map(([name, d, suf, g]) => [name, ...[A, B].map((c) => fmt(runs.map((rows) => g(rows[c]!)), d, suf))]));
}

cohortTable("T3. Attacks, flips and empty-ground acquisitions, per account over the run", [
  ["takes made", 1, "", (s) => div(s.takes, s.walkers)],
  ["flips made", 1, "", (s) => div(s.flipsMade, s.walkers)],
  ["flips suffered", 1, "", (s) => div(s.flipsLost, s.walkers)],
  ["empty-ground claims", 1, "", (s) => div(s.claims, s.walkers)],
]);

cohortTable("T4. Budgets: 13-take denials and 300-unit refusals", [
  ["take-budget denials / account", 1, "", (s) => div(s.takeBudgetRefused, s.walkers)],
  ["active days at 13 takes", 0, "%", (s) => 100 * div(s.walkerDaysAtTakeCap, s.activeWalkerDays)],
  ["300-unit refusals / account", 1, "", (s) => div(s.unitBudgetRefused, s.walkers)],
  ["active days at 300 units", 1, "%", (s) => 100 * div(s.walkerDaysAtUnitBudget, s.activeWalkerDays)],
  ["most units in one walker-day", 0, "", (s) => s.maxUnitsWalkerDay],
]);

cohortTable("T5. The 20-hour server-receipt gap (1002 without the gap vs 1002)", [
  ["flips under 20 h after the challenge opened (run total)", 1, "", (s) => s.straddleFlips],
  ["second pushes held back by the gap (run total)", 1, "", (s) => s.gapHeld],
], [N, B]);

cohortTable("T6. Daily activity (identical input for every rule set) and sessions that gained or kept ground", [
  ["accepted sessions per day", 1, "", (s) => s.sessions / days],
  ["refused at day close (run)", 1, "", (s) => s.sessionsDayClosed],
  ["sessions that claimed or reinforced", 0, "%", (s) => 100 * div(s.sessionsWithAccess, s.sessions)],
  ["pushes rejected as stale_day (run)", 1, "", (s) => s.staleRejected],
]);

{
  const head = ["Household co-walkers (8 linked pairs)", ...[A, B].map((c) => LABELS[c]!)];
  const g = (c: number, f: (s: CohortStats) => number) => runs.map((rows) => f(rows[c]!.cohorts.cowalker));
  const m: [string, number, string, (s: CohortStats) => number][] = [
    ["Takes on the partner's ground, per account", 1, "", (s) => div(s.takesOnPartner, s.walkers)],
    ["Flips of the partner's ground, per account", 1, "", (s) => div(s.flipsOnPartner, s.walkers)],
    ["Share of the cohort's takes that hit the partner", 0, "%", (s) => 100 * div(s.takesOnPartner, s.takes)],
    ["Take-budget denials per account (all causes)", 1, "", (s) => div(s.takeBudgetRefused, s.walkers)],
  ];
  table("T7. Co-walkers push each other's ground", head, m.map(([name, d, suf, f]) => [name, ...[A, B].map((c) => fmt(g(c, f), d, suf))]));
}

{
  const head = ["Review candidate (linked accounts walking together on 4 of 14 days)", ...[A, B].map((c) => `${LABELS[c]}, 2+ accounts`), ...[A, B].map((c) => `${LABELS[c]}, 3+ accounts`)];
  const m: [string, number, string, (r: ReviewStats) => number | null][] = [
    ["Linked groups (all honest co-walker pairs)", 0, "", (r) => r.linkedGroups],
    ["Group-days walking together", 1, "", (r) => r.togetherGroupDays],
    ["Groups flagged", 1, "", (r) => r.groupsFlagged],
    ["Co-walker accounts flagged", 0, "%", (r) => 100 * div(r.flaggedByCohort.cowalker, r.linkedAccounts)],
    ["Accounts flagged in any other cohort", 0, "", (r) => COHORTS.filter((c) => c !== "cowalker").reduce((a, c) => a + r.flaggedByCohort[c], 0)],
    ["Reviews (appeals to answer) per 1,000 accounts", 1, "", (r) => r.reviewsPer1000],
    ["Day of first flag", 1, "", (r) => r.meanFirstFlagDay],
    ["Wrongly upheld (assumed 5% reviewer error, seeded)", 1, "", (r) => r.wronglyUpheld],
  ];
  table("T8. Appeal burden under the linked-account review candidate", head, m.map(([name, d, suf, f]) => [
    name,
    ...[A, B].map((c) => fmt(runs.map((rows) => f(rows[c]!.review)), d, suf)),
    ...[A, B].map((c) => fmt(runs.map((rows) => f(rows[c]!.review3plus)), d, suf)),
  ]));
}

console.log(`\nUnit area: 1001 ${runs[0]![A]!.unitAreaKm2.toFixed(4)} km² (resolution 8), 1002 ${runs[0]![B]!.unitAreaKm2.toFixed(4)} km² (resolution 10). Counts of units are not comparable across rule sets; shares are.`);
