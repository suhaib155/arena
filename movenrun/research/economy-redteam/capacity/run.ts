/**
 * CLI: node --import tsx research/economy-redteam/capacity/run.ts [--params params.v1.json] [--out out]
 * Writes out/projection.csv and out/backlog.csv. Deterministic: no clock, no randomness, no network.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { backlogCsv, backlogGrid, grid, loadParams, toCsv } from "./calculator.ts";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const here = import.meta.dirname;
const params = loadParams(join(here, arg("params", "params.v1.json")));
const out = join(here, arg("out", "out"));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "projection.csv"), toCsv(grid(params)));
writeFileSync(join(out, "backlog.csv"), backlogCsv(backlogGrid(params)));
console.log(`params ${params.version}: wrote ${join(out, "projection.csv")} and backlog.csv`);
