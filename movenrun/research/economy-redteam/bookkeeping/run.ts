/**
 * CLI: runs every bookkeeping property with its manifest seed and writes
 * out/properties.json and out/properties.csv.
 *   node --import tsx research/economy-redteam/bookkeeping/run.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mulberry32 } from "./lib/prng";
import { PROPERTIES, runProperty } from "./properties";

const here = __dirname;
const manifest = JSON.parse(readFileSync(join(here, "seeds.json"), "utf8")) as { properties: Record<string, { seed: number; cases: number }> };
const only = process.argv[2];
const reports = PROPERTIES.filter((p) => !only || p.id === only).map((p) => {
  const m = manifest.properties[p.id]!;
  const r = runProperty(p, m.seed, m.cases, mulberry32);
  console.log(`${r.id} ${r.result} cases=${r.cases} seed=${r.seed} ${r.ms}ms ${r.firstFailure ?? ""} ${JSON.stringify(r.metrics)}`);
  return r;
});
if (!only) {
  mkdirSync(join(here, "out"), { recursive: true });
  const stable = reports.map(({ ms: _ms, ...r }) => r);
  writeFileSync(join(here, "out", "properties.json"), JSON.stringify(stable, null, 2) + "\n");
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = ["id,result,cases,seed,failures,invariants,source,function,first_failure"];
  for (const r of stable) rows.push([r.id, r.result, r.cases, r.seed, r.failures, esc(r.invariants.join(" ")), esc(r.source), esc(r.fn), esc(r.firstFailure ?? "")].join(","));
  writeFileSync(join(here, "out", "properties.csv"), rows.join("\n") + "\n");
}
