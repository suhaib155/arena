/**
 * Runs the pilot sweeps and prints the results tables.
 *
 *   yarn workspace @movenrun/shared sim [--seeds 1,2,3] [--json out.json] [--only D4,D5]
 *   yarn workspace @movenrun/shared sim --pool [--seeds 1]   (the ~5,000-player pool context run)
 *
 * SIMULATION ONLY: synthetic players on a synthetic grid.
 */

import { writeFileSync } from "node:fs";
import { SIM_PILOT_1 } from "./pilotRuleset";
import { agg, CONTROL_VARIANTS, DETAIL_COLUMNS, markdownTable, poolContextCase, runSweeps, sweepPlan, type CaseResult } from "./sweeps";
import { PROFILES } from "./world";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seeds = (arg("seeds") ?? "1,2,3").split(",").map(Number);
const only = arg("only")?.split(",");
const pool = process.argv.includes("--pool");
const cases = pool ? [poolContextCase()] : sweepPlan().filter((c) => !only || c.decision === "pilot" || only.includes(c.decision));

console.log(`# ${SIM_PILOT_1.name} sweeps (SIMULATION ONLY, not final). Seeds ${seeds.join(", ")}.\n`);
const results = runSweeps({ seeds, cases, onRun: (c, s, ms) => console.error(`  ran ${c.label} seed ${s} in ${ms} ms`) });

console.log("## One decision at a time (mean over seeds, min–max)\n");
console.log(markdownTable(results));
console.log("\n## Decision detail (same runs)\n");
console.log(markdownTable(results, DETAIL_COLUMNS));

const pilot = (results.find((r) => r.decision === "pilot") ?? results[0]) as CaseResult;
const m = (f: (r: CaseResult["runs"][number]) => number, d = 2) => {
  const a = agg(pilot.runs.map(f));
  return a.min === a.max ? a.mean.toFixed(d) : `${a.mean.toFixed(d)} (${a.min.toFixed(d)}–${a.max.toFixed(d)})`;
};

console.log("\n## Pilot run detail\n");
const r0 = pilot.runs[0]!;
console.log(`units ${r0.units}, players ${r0.players}, days ${r0.days}`);
console.log("\n### Retention (share holding ground at day 30 / 60 / 90) and units held at end, by profile\n");
console.log("| profile | d30 | d60 | d90 | units at end | flips made/day | mean net credits |");
console.log("|---|---|---|---|---|---|---|");
for (const p of PROFILES) {
  console.log(
    `| ${p} | ${m((r) => r.retention[p][0])} | ${m((r) => r.retention[p][1])} | ${m((r) => r.retention[p][2])} | ${m((r) => r.unitsHeldAtEnd[p], 1)} | ${m((r) => r.takeover.flipsPerDayByWalkerProfile[p], 1)} | ${m((r) => r.credits.meanNetByProfile[p] / 1e6, 1)} |`,
  );
}

console.log("\n### D19 contribution scoring (per active day; ratio to a regular player)\n");
console.log("| scoring | route farmer x | shade farmer x | colluder x | heavy per day | regular per day |");
console.log("|---|---|---|---|---|---|");
for (const k of ["naive", "changed", "pilot"] as const) {
  console.log(
    `| ${k} | ${m((r) => r.d19[k].routeFarmerRatio)} | ${m((r) => r.d19[k].shadeFarmerRatio)} | ${m((r) => r.d19[k].colluderRatio)} | ${m((r) => r.d19[k].perActiveDayByProfile.heavy, 1)} | ${m((r) => r.d19[k].perActiveDayByProfile.regular, 1)} |`,
  );
}

console.log("\n### D21 district control (pilot runs)\n");
console.log("| rule | controlled share | control changes | top club d-days | shade club d-days | colluding club d-days |");
console.log("|---|---|---|---|---|---|");
const labels = ["ruleset", ...CONTROL_VARIANTS.map((v) => v.label)];
labels.forEach((label, i) => {
  if (i === 0) return; // the ruleset's own rule is one of the variants
  console.log(
    `| ${label} | ${m((r) => r.d21[i]!.controlledShare, 3)} | ${m((r) => r.d21[i]!.controlChanges, 0)} | ${m((r) => r.d21[i]!.topClubDistrictDays, 0)} | ${m((r) => r.d21[i]!.shadeClubDistrictDays, 0)} | ${m((r) => r.d21[i]!.colludeClubDistrictDays, 0)} |`,
  );
});

console.log("\n### D22 season boards (pilot, seed " + r0.seed + ")\n");
console.log("| metric | status | top 3 | tied rows | colluding club rank | shade club rank |");
console.log("|---|---|---|---|---|---|");
for (const [metric, b] of Object.entries(r0.d22)) {
  console.log(`| ${metric} | ${b.status} | ${b.top.map((t) => `${t.rank}. ${t.id}`).join(", ")} | ${b.ties} | ${b.colludeRank ?? "-"} | ${b.shadeRank ?? "-"} |`);
}

console.log("\n### Books (pilot)\n");
console.log(
  `days settled ${m((r) => r.books.daysSettled, 0)}, refused ${m((r) => r.books.daysRefused, 0)}, identity failures ${m((r) => r.books.identityFailures, 0)}, ` +
    `issued ${m((r) => r.books.issuedMicro / 1e6, 0)} of pool ${m((r) => r.books.poolMicro / 1e6, 0)} credits, returned ${m((r) => r.books.returnedMicro / 1e6, 0)}, burned ${m((r) => r.books.burnedMicro / 1e6, 0)}, ` +
    `upkeep taken ${m((r) => r.books.upkeepTakenMicro / 1e6, 1)}, paid in condition ${m((r) => r.books.upkeepInConditionMicro / 1e6, 1)}, ` +
    `retries ${m((r) => r.books.retriesSent, 0)} sent / ${m((r) => r.books.retriesSkipped, 0)} skipped, rejected events ${m((r) => r.books.rejectedEvents, 0)}, ` +
    `sim-side level spend ${m((r) => r.books.simLevelSpendMicro / 1e6, 0)}`,
);
console.log(`\nshade: pushes ${m((r) => r.shade.shadePushes, 0)}, degenerate loops rejected ${m((r) => r.shade.shadeRejectedLoops, 0)}, shade units held at end ${m((r) => r.shade.shadeUnitsHeldAtEnd, 0)}`);
const stages = (o: Record<string, number>) => ["held", "at_risk", "contested", "dormant"].map((k) => `${k} ${((o[k] ?? 0) * 100).toFixed(0)}%`).join(", ");
console.log(`casual-held units by stage at season end, floors 60/30/10: ${stages(r0.casualStages.pilot)}; floors 75/50/25: ${stages(r0.casualStages.alt)}`);
console.log(`fingerprints: ${pilot.runs.map((r) => r.fingerprint).join(", ")}`);

const out = arg("json");
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
