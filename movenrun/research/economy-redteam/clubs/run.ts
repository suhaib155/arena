/** Writes sweep tables for the club/district brief: node --import tsx research/economy-redteam/clubs/run.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { fmt } from "./stats.ts";
import { POLICIES, hopControlFlips, manifest, sweep } from "./harness.ts";

const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
const rows = sweep(manifest.sweeps.concentration, manifest.sweeps.shadeWeights, manifest.sweeps.minShares);
const csv = ["concentration,shadeWeight,minShare,club,members,groundShare,groundCI,districtShare,districtCI,belowShareOfDistricts"];
for (const r of rows) csv.push([r.concentration, r.shade, r.minShare, r.club, r.members, r.groundShare.mean.toFixed(4), `${r.groundShare.lo.toFixed(4)}..${r.groundShare.hi.toFixed(4)}`, r.districtShare.mean.toFixed(4), `${r.districtShare.lo.toFixed(4)}..${r.districtShare.hi.toFixed(4)}`, r.belowShare.mean.toFixed(4)].join(","));
writeFileSync(new URL("capture_sweep.csv", out), csv.join("\n") + "\n");
const hop = POLICIES.map((p) => ({ policy: p.name, flipsIn30Days: hopControlFlips(30, p).flips }));
writeFileSync(new URL("hopping.json", out), JSON.stringify({ seeds: manifest.seeds, hop }, null, 2) + "\n");
for (const r of rows.filter((x) => x.shade === "1/4" && x.minShare === "1/2")) console.log(r.concentration, r.club, r.members, fmt(r.groundShare), fmt(r.districtShare));
console.log(hop);
