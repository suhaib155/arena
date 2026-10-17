/**
 * Prints the G5–G7 research tables.
 *
 *   yarn workspace @movenrun/shared sim:g5 [--seeds 1,2,3] [--all-contexts]
 *
 * The default runs the pilot and no-attackers contexts (about 25 s a run);
 * --all-contexts adds the 76 m unit contexts (the 76 m pilot run takes over
 * two minutes). SIMULATION_ONLY_NOT_PRODUCTION: synthetic players on a
 * synthetic grid; no token, no chain, no prices.
 */

import { deedTable, G5_CONTEXTS, liquidByProfileTable, projectionTable, runG5, sybilTable } from "./economyG5Report";
import { PROFILES } from "./world";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seeds = (arg("seeds") ?? "1,2,3").split(",").map(Number);
const contexts = process.argv.includes("--all-contexts") ? G5_CONTEXTS : G5_CONTEXTS.slice(0, 2);
const run = runG5({ seeds, contexts, onRun: (c, s, ms) => console.error(`  ran ${c} seed ${s} in ${ms} ms`) });

console.log(`# G5–G7 economy research runs (SIMULATION ONLY). Seeds ${seeds.join(", ")}. Mean (min–max).\n`);
console.log("## Deed reachability\n");
console.log(deedTable(run));
for (const s of [1, 4]) {
  console.log(`\n## Emission and sinks, season ${s}\n`);
  console.log(projectionTable(run, s));
}
console.log("\n## Liquid holdings per player at season 4 end, by profile (MOVE-equivalent)\n");
console.log(liquidByProfileTable(run));
console.log("\n## Reward per active day used for fake accounts (pilot trace, seed " + seeds[0] + ")\n");
console.log(PROFILES.map((p) => `${p} ${(run.rewardPerActiveDay[p] / 1e6).toFixed(2)}`).join(", "));
console.log("\n## Sybil break-even price (cost units per token; 'never' = no price makes it pay)\n");
console.log(sybilTable(run));
