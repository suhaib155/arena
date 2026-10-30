/**
 * SIMULATION ONLY: the same-seed fairness study re-run after the authoritative-push
 * change, one scenario per process so scenarios can run in parallel.
 *
 *   node --import tsx scripts/fairness-after-authoritative.ts <scenario> [seeds=5] [days=90] [outDir=../docs/sim/after-authoritative]
 *
 * Writes <outDir>/<scenario>.csv (one row per metric and rule set). Synthetic
 * behaviour assumptions; not evidence about real players. Credits are not simulated.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS, STUDY_METRICS, runScenario, summarize } from "../src/gameplay/experiments/afterAuthoritative.js";

const id = process.argv[2];
const sc = SCENARIOS.find((s) => s.id === id);
if (!sc) throw new Error(`scenario must be one of ${SCENARIOS.map((s) => s.id).join(", ")}`);
const seeds = Array.from({ length: Number(process.argv[3] ?? 5) }, (_, i) => i + 1);
const days = Number(process.argv[4] ?? 90);
const outDir = process.argv[5] ?? join(import.meta.dirname, "../../docs/sim/after-authoritative");
mkdirSync(outDir, { recursive: true });
const runs = runScenario(sc, seeds, days);
const rows = summarize(runs, days);
const lines = ["scenario,metric_key,metric,rule_set,mean,sd,min,max,n_seeds,numerator_sum,denominator_sum,denominator_definition"];
for (const r of rows) {
  const m = STUDY_METRICS.find((x) => x.key === r.key)!;
  lines.push([sc.id, r.key, JSON.stringify(m.name), r.label, r.mean.toFixed(6), r.sd.toFixed(6), r.min.toFixed(6), r.max.toFixed(6), seeds.length, r.num.toFixed(3), r.den, JSON.stringify(m.den)].join(","));
}
writeFileSync(join(outDir, `${sc.id}.csv`), lines.join("\n") + "\n");
process.stderr.write(`${sc.id}: ${seeds.length} seeds, ${days} days, done\n`);
