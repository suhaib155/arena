// Reads out/bench-<cfg>-<n>.{json,samples.csv} and writes out/measured.csv (one row per run) and out/measured_tables.csv.
// MEASURED tier: everything here comes from the local bench cluster; none of it is a hosted observation.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "..", "out");
const runs = readdirSync(OUT).filter((f) => /^bench-.*\.json$/.test(f)).sort();
const MIB = 1024 * 1024;
const head = ["config", "players", "sessions", "ledger_rows", "db_mib_day14", "gameplay_total_mib", "challenges_total_mib", "challenges_live_rows", "challenge_inserts", "challenge_deletes", "challenge_peak_dead_sampled", "units_updates", "units_hot_updates", "wal_mib", "wal_bytes_per_ledger_row", "temp_mib", "worst_settle_ms", "autovac_runs_challenges", "bench_seconds", "after_vacuum_full_gameplay_mib", "partition_drop_freed_mib_one_day", "delete_then_vacuum_freed_bytes_one_day"];
const lines = [head.join(",")];
const tl = ["config,players,table,rows,heap_bytes,index_bytes,toast_bytes,total_bytes,dead_after_measure_vacuum"];
for (const f of runs) {
  const m = /^bench-(.*)-(\d+)\.json$/.exec(f)!;
  const [cfg, n] = [m[1], m[2]];
  const j = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  const r = j.results[0];
  const last = r.checkpoints[r.checkpoints.length - 1];
  const g = last.tables.filter((t: any) => t.table.startsWith("gameplay_"));
  const sum = (k: string) => g.reduce((a: number, t: any) => a + t[k], 0);
  for (const t of g) tl.push([cfg, n, t.table, t.rows, t.heap, t.indexes, t.toast, t.total, t.deadTuples].join(","));
  const ch = g.find((t: any) => t.table === "gameplay_unit_challenges");
  let chIns = 0, chDel = 0, peakDead = 0, uUpd = 0, uHot = 0, av = 0;
  const sp = join(OUT, f.replace(/\.json$/, ".samples.csv"));
  if (existsSync(sp)) {
    for (const l of readFileSync(sp, "utf8").split("\n").slice(1)) {
      const c = l.split(",");
      if (c[2] === "gameplay_unit_challenges") { chIns = Math.max(chIns, +c[6]); chDel = Math.max(chDel, +c[8]); peakDead = Math.max(peakDead, +c[5]); av = Math.max(av, +c[10]); }
      if (c[2] === "gameplay_units") { uUpd = Math.max(uUpd, +c[7]); uHot = Math.max(uHot, +c[9]); }
    }
  }
  const temp = r.settleSpill.reduce((a: number, d: any) => a + d.tempBytes, 0);
  const full = last.compact ? last.compact.reduce?.((a: number, t: any) => a + (t.table.startsWith("gameplay_") ? t.total : 0), 0) : null;
  lines.push([cfg, n, r.sessions, r.pushes.ledgerRows, (last.databaseBytes / MIB).toFixed(1), (sum("total") / MIB).toFixed(2), ((ch?.total ?? 0) / MIB).toFixed(2), ch?.rows ?? "", chIns, chDel, peakDead, uUpd, uHot,
    (r.walBytes / MIB).toFixed(1), Math.round(r.walBytes / r.pushes.ledgerRows), (temp / MIB).toFixed(2), Math.max(...r.settleSpill.map((d: any) => d.ms)), av, r.seconds.toFixed(0),
    full === null || full === undefined ? "" : (full / MIB).toFixed(2), r.reclaim?.dropRoute ? (r.reclaim.dropRoute.freedBytes / MIB).toFixed(3) : "", r.reclaim?.deleteRoute?.freedByVacuum ?? ""].join(","));
}
writeFileSync(join(OUT, "measured.csv"), lines.join("\n") + "\n");
writeFileSync(join(OUT, "measured_tables.csv"), tl.join("\n") + "\n");
console.log(lines.join("\n"));
