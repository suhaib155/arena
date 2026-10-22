/** Writes the seeded sweeps to out/. Run: node --import tsx research/economy-redteam/invariants/run.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, loadManifest } from "./helpers.ts";
import { segmentSweep, sparseWalkSweep } from "./sweep.ts";

const m = loadManifest();
const out = join(HERE, "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "segment_sweep.csv"), segmentSweep(m));
writeFileSync(join(out, "sparse_walk_sweep.csv"), sparseWalkSweep(m));
process.stdout.write("wrote out/segment_sweep.csv and out/sparse_walk_sweep.csv\n");
