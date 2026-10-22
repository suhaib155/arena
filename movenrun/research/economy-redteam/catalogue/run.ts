/**
 * Writes the worked-example checks to out/worked_examples.json and
 * out/worked_examples.csv. Deterministic: no random draws, no clock in the
 * output, rows in a fixed order.
 *
 *   node --import tsx research/economy-redteam/catalogue/run.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allChecks, type CheckRow } from "./workedExamples";

export function renderJson(): string {
  return JSON.stringify(allChecks(), null, 2) + "\n";
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderCsv(): string {
  const cols: (keyof CheckRow)[] = ["id", "kind", "section", "what", "printed", "printedDecimals", "value", "agrees", "note"];
  const lines = [cols.join(",")];
  for (const r of allChecks().rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(here, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "worked_examples.json"), renderJson());
  writeFileSync(join(out, "worked_examples.csv"), renderCsv());
  const rows = allChecks().rows;
  const disagree = rows.filter((r) => r.agrees === false).map((r) => r.id);
  console.log(`${rows.length} rows; ${disagree.length} disagree at printed precision: ${disagree.join(", ")}`);
}
