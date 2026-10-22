/** node --import tsx research/economy-redteam/farming/run.ts  -> out/*.csv and out/summary.json */
import { mkdirSync, writeFileSync } from "node:fs";
import { aggregate, manifest, slowTrustAverageWeight, staffMinutesPer1000 } from "./sim.ts";
import { fmt } from "./stats.ts";

const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
const rows = ["N,variant,cohort,accountsMean,reviewedMean,reviewedLo,reviewedHi,upheldMean,upheldLo,upheldHi,medianDaysToFlag"];
const top = ["N,variant,honestReviewed,honestWronglyUpheld,strangersReviewed,linkedFamiliesReviewed,casesPer1000,upheldCasesPer1000,honestCasesPer1000,staffMinPer1000_low_all,staffMinPer1000_mid_all,staffMinPer1000_high_all,staffMinHonestOnly_low,staffMinHonestOnly_mid,staffMinHonestOnly_high"];
const priv: Record<string, unknown> = {};
const prox: Record<string, unknown> = {};
for (const N of manifest.populations) {
  const { aggs, privacy, proximity } = aggregate(N);
  priv[N] = Object.fromEntries(Object.entries(privacy).map(([k, v]) => [k, { mean: +v.mean.toFixed(1), lo: +v.lo.toFixed(1), hi: +v.hi.toFixed(1) }]));
  prox[N] = Object.fromEntries(Object.entries(proximity[4]!).map(([k, v]) => [k, +v.mean.toFixed(4)]));
  for (const a of aggs) {
    for (const c of a.cohorts) rows.push([N, a.variant, c.cohort, c.accounts.mean.toFixed(1), c.reviewed.mean.toFixed(4), c.reviewed.lo.toFixed(4), c.reviewed.hi.toFixed(4), c.wronglyUpheld.mean.toFixed(4), c.wronglyUpheld.lo.toFixed(4), c.wronglyUpheld.hi.toFixed(4), c.medianDaysToFlag ? c.medianDaysToFlag.mean.toFixed(1) : ""].join(","));
    const sm = staffMinutesPer1000(a.casesPer1000.mean, a.upheldCasesPer1000.mean);
    const sh = staffMinutesPer1000(a.honestCasesPer1000.mean, a.honestUpheldCasesPer1000.mean);
    top.push([N, a.variant, fmt(a.honestReviewed, 4).replace(/,/g, ";"), fmt(a.honestWronglyUpheld, 4).replace(/,/g, ";"), fmt(a.strangersReviewed, 4).replace(/,/g, ";"), fmt(a.linkedFamiliesReviewed, 4).replace(/,/g, ";"), a.casesPer1000.mean.toFixed(1), a.upheldCasesPer1000.mean.toFixed(1), a.honestCasesPer1000.mean.toFixed(1), sm.low.toFixed(0), sm.mid.toFixed(0), sm.high.toFixed(0), sh.low.toFixed(0), sh.mid.toFixed(0), sh.high.toFixed(0)].join(","));
  }
}
writeFileSync(new URL("cohorts.csv", out), rows.join("\n") + "\n");
writeFileSync(new URL("headline.csv", out), top.join("\n") + "\n");
writeFileSync(new URL("summary.json", out), JSON.stringify({ seeds: manifest.seeds, privacyPer1000Accounts: priv, proximityOnlyCounterfactualReviewedShare: prox, slowTrustAvgWeight90d: { ramp14: slowTrustAverageWeight(14), ramp28: slowTrustAverageWeight(28), ramp56: slowTrustAverageWeight(56) } }, null, 2) + "\n");
console.log(top.join("\n"));
