/**
 * Before/after measurements of the PROPOSED fixes on the whole corpus.
 *
 *   node --import tsx synthetic-routes/proposals.ts [--write]
 *
 * "Before" is today's code. Each "after" turns on exactly one candidate (and
 * then all together) so a fix's effect, and any regression it causes on an
 * honest fixture, is visible on its own. Nothing here changes the app.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./fixtures";
import { evaluate, measure } from "./measure";
import type { CandidateOptions } from "./clientPipeline";
import type { ServerCandidateOptions } from "./serverPipeline";

type Options = CandidateOptions & ServerCandidateOptions;
export const CANDIDATES: { id: string; title: string; options: Options }[] = [
  { id: "before", title: "Today's code", options: {} },
  { id: "P1", title: "Server: drop legacy 10-point floor for sessions with metadata", options: { relaxLegacyPointFloor: true } },
  { id: "P2", title: "Shared: no straight bridge from the anchor after a speed rejection", options: { breakAfterSpeedReject: true } },
  { id: "P3", title: "Client: Save/XP duration from fix timestamps, not the wall clock", options: { durationFromEvidence: true } },
  { id: "P4", title: "Client: future-dated fixes degrade the signal chip", options: { futureFixDegrades: true } },
  { id: "P5", title: "Shared: 60 s drift guard (net < 25% of path over >= 40 m)", options: { driftGuard: true } },
  { id: "all", title: "P1 to P5 together", options: { relaxLegacyPointFloor: true, breakAfterSpeedReject: true, durationFromEvidence: true, futureFixDegrades: true, driftGuard: true } },
];

export async function runCandidates() {
  const table: Record<string, Record<string, { failed: number; clientM: number; xp: number; server: string }>> = {};
  for (const f of FIXTURES) {
    table[f.id] = {};
    for (const c of CANDIDATES) {
      const m = await measure(f, c.options);
      const failed = evaluate(f, m).filter((x) => !x.pass).length;
      table[f.id]![c.id] = { failed, clientM: Math.round(m.client.distanceM), xp: m.client.xpBankedOnSave, server: m.server.status };
    }
  }
  return table;
}

async function main() {
  const table = await runCandidates();
  const head = `| Fixture | ${CANDIDATES.map((c) => c.id).join(" | ")} |\n|---|${CANDIDATES.map(() => "---").join("|")}|`;
  const rows = Object.entries(table).map(([id, r]) =>
    `| ${id} | ${CANDIDATES.map((c) => { const v = r[c.id]!; return `${v.failed ? "FAIL" : "PASS"} ${v.clientM} m, ${v.xp} XP, ${v.server}`; }).join(" | ")} |`);
  const totals = CANDIDATES.map((c) => `${c.id}: ${Object.values(table).filter((r) => r[c.id]!.failed > 0).length} fixtures failing`).join("; ");
  const legend = CANDIDATES.map((c) => `- **${c.id}**: ${c.title}`).join("\n");
  const md = `# Candidate fixes: before/after on the synthetic corpus\n\nSYNTHETIC / NOT LIVE. PROPOSED fixes only; none is applied to the app.\n\n${legend}\n\n${head}\n${rows.join("\n")}\n\n${totals}\n`;
  console.log(md);
  if (process.argv.includes("--write")) writeFileSync(join(__dirname, "corpus", "candidates.md"), md);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
