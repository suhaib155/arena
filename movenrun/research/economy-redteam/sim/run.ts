/**
 * Sweep runner. Reads manifest.json, runs the named stages (default: all) and
 * writes machine-readable rows to out/. Then `summarize` folds every stage's
 * rows into means and 95% intervals across seeds.
 *
 *   node --import tsx research/economy-redteam/sim/run.ts [--stage A-core] [--summarize-only]
 *
 * Every number written is a SYNTHETIC EXPERIMENT result for the seeds in the
 * manifest; columns prefixed model_ are a retention MODEL ASSUMPTION.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERIFIED_STEPS_V1 } from "../../../backend/src/gameplay/path.ts";
import { reviewFlags, runVariant } from "./engine.ts";
import { buildScenario, LEGIT_COHORTS, type Manifest, type ScenarioSpec } from "./population.ts";
import { variant } from "./variants.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

interface Stage {
  id: string;
  population: number[];
  horizonDays: number[];
  maliciousShare: number[];
  density: ScenarioSpec["density"][];
  timingNoise: boolean[];
  variants: string | string[];
  seeds: string;
}

export function loadManifest(): Manifest & { stages: Stage[]; seeds: Record<string, number[] | string>; [k: string]: unknown } {
  return JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
}

const fmt = (x: unknown) => (typeof x === "number" ? (Number.isFinite(x) ? String(Number(x.toPrecision(4))) : "") : String(x));

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(","))].join("\n") + "\n";
}

function parseCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head!.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i]!, v])));
}

export function runStage(m: ReturnType<typeof loadManifest>, st: Stage, log = console.log) {
  const variantIds = typeof st.variants === "string" ? (m[st.variants] as string[]) : st.variants;
  const seeds = m.seeds[st.seeds] as number[];
  const rows: Record<string, unknown>[] = [];
  const hours: Record<string, unknown>[] = [];
  const cohorts: Record<string, unknown>[] = [];
  for (const population of st.population) for (const horizonDays of st.horizonDays) for (const maliciousShare of st.maliciousShare)
    for (const density of st.density) for (const timingNoise of st.timingNoise) for (const seed of seeds) {
      const spec: ScenarioSpec = { seed, population, horizonDays, maliciousShare, density, timingNoise };
      const t0 = Date.now();
      const sc = buildScenario(spec, m, VERIFIED_STEPS_V1);
      const flags = reviewFlags(sc);
      const inputHash = createHash("sha256").update(JSON.stringify(sc.sessions.map((s) => [s.id, s.walker, s.route.id, s.gapped, s.slice, s.endMs, s.receivedMs]))).digest("hex").slice(0, 16);
      const cell = `${st.id}|p${population}|d${horizonDays}|m${maliciousShare}|${density}|noise${timingNoise ? 1 : 0}`;
      for (const vid of variantIds) {
        const r = runVariant(sc, variant(vid));
        rows.push({ stage: st.id, cell, seed, population, horizonDays, maliciousShare, density, timingNoise: timingNoise ? 1 : 0, inputHash, ...r.row, ...flags });
        hours.push({ stage: st.id, cell, seed, variant: vid, kind: "takeCap", ...Object.fromEntries(r.denialsByHour.takeCap.map((n, h) => [`h${h}`, n])) });
        hours.push({ stage: st.id, cell, seed, variant: vid, kind: "unitCap", ...Object.fromEntries(r.denialsByHour.unitCap.map((n, h) => [`h${h}`, n])) });
        for (const k of LEGIT_COHORTS) cohorts.push({ stage: st.id, cell, seed, variant: vid, cohort: k, ...r.cohorts[k] });
      }
      log(`${cell} seed ${seed}: ${variantIds.length} variants, ${sc.sessions.length} sessions, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  return { rows, hours, cohorts };
}

/** Student t 0.975 quantiles for small n - 1. */
const T975: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 };

export function meanCi(xs: number[]): { mean: number; lo: number; hi: number; n: number } {
  const v = xs.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, lo: NaN, hi: NaN, n };
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const h = (T975[n - 1] ?? 1.96) * (sd / Math.sqrt(n));
  return { mean, lo: mean - h, hi: mean + h, n };
}

export function summarize() {
  const files = readdirSync(OUT).filter((f) => /^rows_.*\.csv$/.test(f)).sort();
  const rows = files.flatMap((f) => parseCsv(readFileSync(join(OUT, f), "utf8")));
  const skip = new Set(["stage", "cell", "seed", "population", "horizonDays", "maliciousShare", "density", "timingNoise", "inputHash", "variant"]);
  const groups = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const k = `${r.cell}#${r.variant}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Record<string, unknown>[] = [];
  const json: Record<string, Record<string, Record<string, { mean: number; lo: number; hi: number; n: number }>>> = {};
  for (const [k, rs] of groups) {
    const [cell, vid] = k.split("#") as [string, string];
    const metrics = Object.keys(rs[0]!).filter((c) => !skip.has(c));
    // One wide row per cell and variant: <metric> (mean), <metric>_lo, <metric>_hi (95% interval across seeds).
    const row: Record<string, unknown> = { cell, variant: vid, seeds: rs.length };
    for (const mtr of metrics) {
      const ci = meanCi(rs.map((r) => (r[mtr] === "" ? NaN : Number(r[mtr]))));
      row[mtr] = ci.mean;
      row[`${mtr}_lo`] = ci.lo;
      row[`${mtr}_hi`] = ci.hi;
      ((json[cell] ??= {})[vid] ??= {})[mtr] = ci;
    }
    out.push(row);
  }
  writeFileSync(join(OUT, "summary.csv"), toCsv(out));
  return json;
}

function main() {
  const args = process.argv.slice(2);
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  if (!args.includes("--summarize-only")) {
    const m = loadManifest();
    const only = args.includes("--stage") ? args[args.indexOf("--stage") + 1] : null;
    for (const st of m.stages) {
      if (only && st.id !== only) continue;
      const { rows, hours, cohorts } = runStage(m, st);
      writeFileSync(join(OUT, `rows_${st.id}.csv`), toCsv(rows));
      writeFileSync(join(OUT, `hours_${st.id}.csv`), toCsv(hours));
      writeFileSync(join(OUT, `cohorts_${st.id}.csv`), toCsv(cohorts));
    }
  }
  summarize();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
