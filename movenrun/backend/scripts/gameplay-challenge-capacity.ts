/**
 * Peak DB + WAL + reserve for the challenge write modes (G34). SIMULATION ONLY: no database is touched.
 * The quota (500 MiB) is an ASSUMPTION; the real quota is unknown. Never a recommendation to run VACUUM FULL.
 *
 *   node --import tsx scripts/gameplay-challenge-capacity.ts
 *
 * Inputs are measurements from docs/storage/G34_HOT_AUTOVACUUM_BENCHMARK.md (day-14, 1,000 players, delete-insert) and
 * section 9 (burst, delete-insert versus diff). Every other coefficient comes from lifecycleCapacity.ts.
 */
import { ASSUMED_TRIPWIRES, levelOf, projectLifecycle } from "../src/gameplay/lifecycleCapacity.js";

type Mode = "delete-insert" | "diff";
type Av = "kept-up (1 s naptime)" | "stock 60 s naptime, compressed-bench bound" | "autovacuum off (bound)";
/** MiB of gameplay_unit_challenges per 1,000 players, delete-insert, measured at day 14 (a4, a2/a10/a11 worst, a5). */
const FIXED_DI: Record<Av, number> = { "kept-up (1 s naptime)": 14.2, "stock 60 s naptime, compressed-bench bound": 120, "autovacuum off (bound)": 0 };
/** Autovacuum off: dead rows never reused, so the table grows linearly: 208.0 MiB over 14 days per 1,000 players. */
const OFF_RATE_PER_DAY = 208.0 / 14;
/** diff / delete-insert, from the 20,000-batch burst with 10% first_day changes and a rules rollover: table size at 1 s and 60 s naptime. */
const DIFF_SIZE_RATIO: Record<Av, number> = { "kept-up (1 s naptime)": 4.27 / 12.84, "stock 60 s naptime, compressed-bench bound": 6.06 / 45.64, "autovacuum off (bound)": 175_000 / 2_175_000 /* new tuple versions written */ };
/** Whole-pipeline WAL per 1,000 players per day, delete-insert: about 990 MiB over 14 days (bench 3.1). */
const WAL_PER_DAY_PER_1000 = 990 / 14;
/** WAL saved per 1,000 players a day by diff: (24.5 - 7.4 KiB per batch, burst) x 905 batches (12,666 sessions / 14 days). Burst-calibrated, so a lower bound. */
const WAL_SAVED_PER_DAY_PER_1000 = ((478.4 - 148.3) / 20_000) * 905;
/** Assumption: the peak day writes twice the average day, and one peak day of WAL is on disk at once. */
const PEAK_DAY_FACTOR = 2;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const avs = Object.keys(FIXED_DI) as Av[];
const q = ASSUMED_TRIPWIRES.quotaMiB;

function challengesMiB(players: number, seasons: number, av: Av, mode: Mode): number {
  const days = seasons * 90;
  const di = av === "autovacuum off (bound)" ? OFF_RATE_PER_DAY * days : FIXED_DI[av];
  return (di * (mode === "diff" ? DIFF_SIZE_RATIO[av] : 1) * players) / 1000;
}
export function peak(players: number, seasons: number, av: Av, mode: Mode) {
  const base = projectLifecycle({ players, hostileShare: 0, seasons, churn: "vacuum_keeps_up" });
  const db = base.totalMiB - base.parts.challenges! + challengesMiB(players, seasons, av, mode);
  const walDay = Math.max(0, WAL_PER_DAY_PER_1000 - (mode === "diff" ? WAL_SAVED_PER_DAY_PER_1000 : 0)) * (players / 1000) * PEAK_DAY_FACTOR;
  return { db, walDay, total: db + walDay, needQuotaForStop: (db + walDay) / ASSUMED_TRIPWIRES.hardStop };
}

if (process.argv[1]?.endsWith("gameplay-challenge-capacity.ts")) {
  const out: string[] = [];
  out.push(`Quota ASSUMED ${q} MiB (real quota UNKNOWN). warn 60% / backpressure 75% / stop 85%. Ordinary players (0% hostile), 300 unique units a day, 14-day detail + 120-day compact proofs, 90-day season.`, "");
  out.push(`Peak WAL day = ${PEAK_DAY_FACTOR} x average (${WAL_PER_DAY_PER_1000.toFixed(1)} MiB per 1,000 players a day delete-insert; diff saves ${WAL_SAVED_PER_DAY_PER_1000.toFixed(1)}).`, "");
  for (const av of avs) {
    out.push(`### Autovacuum state: ${av}`, "", "Cells: DB MiB + peak-day WAL MiB = total (percent of assumed 500 MiB, level); last: quota needed to stay under the 85% stop line.", "",
      "| Players | Seasons | delete-insert (live) | diff | quota needed: delete-insert / diff |", "|---|---|---|---|---|");
    for (const players of [200, 500, 1000, 5000]) for (const seasons of [1, 4]) {
      const cell = (m: Mode) => { const p = peak(players, seasons, av, m); return `${fmt(p.db)} + ${fmt(p.walDay)} = ${fmt(p.total)} (${fmt((100 * p.total) / q)}%, ${levelOf(p.total)})`; };
      out.push(`| ${fmt(players)} | ${seasons} | ${cell("delete-insert")} | ${cell("diff")} | ${fmt(peak(players, seasons, av, "delete-insert").needQuotaForStop)} / ${fmt(peak(players, seasons, av, "diff").needQuotaForStop)} |`);
    }
    out.push("");
  }
  console.log(out.join("\n"));
}
