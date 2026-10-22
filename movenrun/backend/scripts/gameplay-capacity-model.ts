/**
 * Prints the lifecycle capacity model (src/gameplay/lifecycleCapacity.ts) as
 * Markdown. SIMULATION ONLY: no database is touched. The quota (500 MiB) is
 * ASSUMED and every TTL is a planning assumption (docs/G34_DATA_LIFECYCLE.md).
 *
 *   node --import tsx scripts/gameplay-capacity-model.ts
 */
import {
  ASSUMED_TRIPWIRES, LIFECYCLE_INPUTS, levelOf, maxPlayersUnder, projectLifecycle, scaledInputs, type ChurnRegime,
} from "../src/gameplay/lifecycleCapacity.js";

const PLAYERS = [200, 500, 1_000, 5_000];
const PROFILES: [string, number][] = [["ordinary", 0], ["2% hostile", 0.02], ["10% hostile", 0.1]];
const SEASONS = [1, 4];
const CHURN: [ChurnRegime, string][] = [["vacuum_keeps_up", "challenge churn kept up by vacuum"], ["bench_bloat", "challenge churn at measured bench bloat"]];
const q = ASSUMED_TRIPWIRES.quotaMiB;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const cell = (mib: number) => `${fmt(mib)} (${fmt((100 * mib) / q)}%, ${levelOf(mib)})`;

const out: string[] = [];
out.push("SIMULATION ONLY. ASSUMED quota 500 MiB; warn 60% (300), backpressure 75% (375), fail closed 85% (425). Planning retention: 14-day raw window, 120-day proofs and movement summaries, 90-day season.", "");
for (const [churn, label] of CHURN) {
  out.push(`MiB (% of 500, tripwire level), ${label}:`, "", `| Players | Seasons | ${PROFILES.map(([n]) => n).join(" | ")} |`, `|---|---|${PROFILES.map(() => "---").join("|")}|`);
  for (const players of PLAYERS) for (const seasons of SEASONS) {
    out.push(`| ${fmt(players)} | ${seasons} | ${PROFILES.map(([, h]) => cell(projectLifecycle({ players, hostileShare: h, seasons, churn }).totalMiB)).join(" | ")} |`);
  }
  out.push("");
}
out.push("Most players strictly under 85% of 500 MiB:", "", `| Churn | ${SEASONS.flatMap((s) => PROFILES.map(([n]) => `${s} season${s > 1 ? "s" : ""}, ${n}`)).join(" | ")} |`, `|---|${SEASONS.flatMap(() => PROFILES.map(() => "---")).join("|")}|`);
for (const [churn, label] of CHURN) {
  out.push(`| ${label} | ${SEASONS.flatMap((seasons) => PROFILES.map(([, h]) => fmt(maxPlayersUnder({ hostileShare: h, seasons, churn }, ASSUMED_TRIPWIRES.hardStop)))).join(" | ")} |`);
}
out.push("");
out.push("Hard-stop sensitivity (most players under the line; churn kept up; ordinary / 2% / 10% hostile):", "", "| Case | 1 season | 4 seasons |", "|---|---|---|");
const sens = (label: string, fraction: number, quota: number, factor: number) => {
  const inp = scaledInputs(factor);
  const col = (seasons: number) => PROFILES.map(([, h]) => fmt(maxPlayersUnder({ hostileShare: h, seasons, churn: "vacuum_keeps_up" }, fraction, quota, inp))).join(" / ");
  out.push(`| ${label} | ${col(1)} | ${col(4)} |`);
};
sens("85% of 500 MiB, inputs as measured", 0.85, 500, 1);
sens("80% of 500 MiB", 0.8, 500, 1);
sens("90% of 500 MiB", 0.9, 500, 1);
sens("85% of 400 MiB (smaller real quota)", 0.85, 400, 1);
sens("85% of 500 MiB, per-player costs +25%", 0.85, 500, 1.25);
sens("85% of 500 MiB, per-player costs +50%", 0.85, 500, 1.5);
sens("85% of 500 MiB, per-player costs -25%", 0.85, 500, 0.75);
out.push("");
const b = projectLifecycle({ players: 1_000, hostileShare: 0, seasons: 4, churn: "vacuum_keeps_up" });
out.push("Where the bytes go, 1,000 ordinary players, 4 seasons, churn kept up (MiB):", "", "| Class | MiB |", "|---|---|");
for (const [k, v] of Object.entries(b.parts)) out.push(`| ${k} | ${v.toFixed(1)} |`);
out.push(`| **total** | **${b.totalMiB.toFixed(1)}** |`, "");
out.push("Inputs (per 1,000 players unless noted):", "", "```json", JSON.stringify(LIFECYCLE_INPUTS, (_k, v) => (typeof v === "number" ? Number(v.toFixed(4)) : v), 2), "```");
console.log(out.join("\n"));
