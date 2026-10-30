/**
 * Renders the Markdown tables of docs/storage/G34_HOT_AUTOVACUUM_BENCHMARK.md from raw result files.
 * Reads only local JSON and cluster logs the matrix scripts wrote; touches no database.
 *
 *   node --import tsx scripts/gameplay-hot-autovac-report.ts --a <dir> [--c <dir>] [--b <dir>]
 *
 *   --a   results of gameplay-bench-matrix.sh runs at 1,000 players (autovacuum timing study)
 *   --c   results of the player / hostile grid
 *   --b   results of gameplay-challenge-burst-matrix.sh
 * Everything printed is LOCAL POSTGRES VERIFIED (a measurement on a throwaway local cluster) except the
 * lifecycle projections, which are SIMULATION ONLY and say so.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ASSUMED_TRIPWIRES, LIFECYCLE_INPUTS, levelOf, projectLifecycle, type ChurnRegime, type LifecycleInputs } from "../src/gameplay/lifecycleCapacity.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const MIB = 1024 * 1024;
const m = (b: number, d = 1) => (b / MIB).toFixed(d);
const n0 = (x: number) => Math.round(x).toLocaleString("en-US");

interface StatRow { table: string; rows: number; live: number; dead: number; heap: number; indexes: number; toast: number; total: number; ins: number; upd: number; hotUpd: number; del: number; autovacuumCount: number; vacuumCount: number; autoanalyzeCount: number }
interface Result {
  scenario: { name: string; players: number; days: number; hostile?: { accounts: number } };
  sessions: number; hostileSessions: number; seconds: number; walBytes: number; proposedTables: string[];
  checkpoints: { day: number; databaseBytes: number; tables: { table: string; total: number; heap: number; indexes: number; toast: number; rows: number }[]; compact?: { table: string; total: number }[]; compactDatabaseBytes?: number }[];
  statsAtCheckpoints: { day: number; databaseBytes: number; tables: StatRow[]; autovacuum: { count: number }; tempBytes: number; tempFiles: number }[];
  settleSpill?: { tempBytes: number; ms: number }[];
}
const load = (dir: string): { label: string; r: Result; log: string }[] =>
  readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".scenario.json")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => {
    const label = basename(f, ".json");
    const logPath = join(dir, `${label}.log`);
    return { label, r: (JSON.parse(readFileSync(join(dir, f), "utf8")) as { results: Result[] }).results[0]!, log: existsSync(logPath) ? readFileSync(logPath, "utf8") : "" };
  });

/** Autovacuum runs and CPU per table from a cluster log written with log_autovacuum_min_duration=0. */
function avLog(log: string): Map<string, { runs: number; cpu: number; wal: number }> {
  const out = new Map<string, { runs: number; cpu: number; wal: number }>();
  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = /automatic vacuum of table "[^"]*?\.(?:[a-z_]+)\.([a-z_0-9]+)"/.exec(lines[i]!);
    if (!h) continue;
    let table = h[1]!;
    if (/^gameplay_(push_events|walker_days)_d\d+$/.test(table)) table = table.replace(/_d\d+$/, "");
    let cpu = 0, wal = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      if (/^\d{4}-\d\d-\d\d /.test(lines[j]!)) break;
      const c = /CPU: user: ([\d.]+) s, system: ([\d.]+) s/.exec(lines[j]!);
      if (c) cpu = Number(c[1]) + Number(c[2]);
      const w = /WAL usage: \d+ records, \d+ full page images, (\d+) bytes/.exec(lines[j]!);
      if (w) wal = Number(w[1]);
    }
    const e = out.get(table) ?? { runs: 0, cpu: 0, wal: 0 };
    e.runs++; e.cpu += cpu; e.wal += wal; out.set(table, e);
  }
  return out;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function gp(r: Result) {
  const last = r.checkpoints[r.checkpoints.length - 1]!;
  const pre = r.statsAtCheckpoints[r.statsAtCheckpoints.length - 1]!;
  const post0011 = last.tables.filter((t) => r.proposedTables.includes(t.table));
  const pre0011 = pre.tables.filter((t) => r.proposedTables.includes(t.table));
  const ch = pre.tables.find((t) => t.table === "gameplay_unit_challenges")!;
  const chPost = last.tables.find((t) => t.table === "gameplay_unit_challenges")!;
  return { last, pre, post0011, pre0011, ch, chPost, postTotal: sum(post0011.map((t) => t.total)), preTotal: sum(pre0011.map((t) => t.total)),
    compact0011: sum((last.compact ?? []).filter((t) => r.proposedTables.includes(t.table)).map((t) => t.total)) };
}

const out: string[] = [];
const emit = (...l: string[]) => out.push(...l);

/* ── A: autovacuum timing at 1,000 players ───────────────────────────── */
const aDir = arg("a");
if (aDir) {
  const rows = load(aDir);
  emit("### A1. Same workload, different autovacuum timing (1,000 players, 14 days, rule set 1002, res 10, dense, 0% hostile)", "",
    "LOCAL POSTGRES VERIFIED. MiB. \"0011 after VACUUM\" is the bench's own measurement (a VACUUM ANALYZE just before it, as in the original runs). \"0011 before VACUUM\" is the same tables read just before that VACUUM. Challenges = `gameplay_unit_challenges` (heap + indexes + TOAST) before the VACUUM.", "",
    "| Run | Wall s | 0011 before VACUUM | 0011 after VACUUM | Challenges before VACUUM | Challenge dead tuples | Autovacuum runs on challenges | Autovacuum CPU s (all tables) | WAL MiB | Temp MiB | Database MiB | 0011 after VACUUM FULL (diagnostic) |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { label, r, log } of rows) {
    const g = gp(r); const av = avLog(log);
    emit(`| ${label} | ${r.seconds.toFixed(0)} | ${m(g.preTotal)} | ${m(g.postTotal)} | ${m(g.ch.total)} | ${n0(g.ch.dead)} | ${av.get("gameplay_unit_challenges")?.runs ?? 0} | ${sum([...av.values()].map((x) => x.cpu)).toFixed(2)} | ${m(r.walBytes, 0)} | ${m(g.pre.tempBytes)} | ${m(g.last.databaseBytes)} | ${m(g.compact0011)} |`);
  }
  emit("");
}

/* ── disaggregation ─────────────────────────────────────────────────── */
const cDir = arg("c");
function disagg(title: string, rs: { label: string; r: Result; log: string }[]) {
  emit(`### ${title}`, "", "LOCAL POSTGRES VERIFIED. MiB, all 0011 tables, read just before the measurement VACUUM. Dead-tuple bytes are an ESTIMATE (heap x dead / (live + dead)). \"FSM/VM\" is the free-space and visibility map forks. WAL is the cluster's WAL from the daily writes and settlements. Temp is the settlement sort spill.", "",
    "| Run | Players / hostile accts | Heap | Indexes | TOAST | FSM/VM | Total | of which challenges heap+idx | Dead tuples (rows) | Dead bytes (est.) | movement_verifications | WAL MiB | Temp MiB | Worst settlement ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { label, r } of rs) {
    const g = gp(r);
    const heap = sum(g.pre0011.map((t) => t.heap)), idx = sum(g.pre0011.map((t) => t.indexes)), toast = sum(g.pre0011.map((t) => t.toast));
    const total = sum(g.pre0011.map((t) => t.total));
    const dead = sum(g.pre0011.map((t) => t.dead));
    const deadB = sum(g.pre0011.map((t) => (t.live + t.dead > 0 ? (t.heap * t.dead) / (t.live + t.dead) : 0)));
    const mv = g.pre.tables.find((t) => t.table === "movement_verifications");
    emit(`| ${label} | ${r.scenario.players} / ${r.scenario.hostile?.accounts ?? 0} | ${m(heap)} | ${m(idx)} | ${m(toast)} | ${m(total - heap - idx - toast)} | ${m(total)} | ${m(g.ch.heap + g.ch.indexes + g.ch.toast)} | ${n0(dead)} | ${m(deadB)} | ${mv ? m(mv.total) : "-"} | ${m(r.walBytes, 0)} | ${m(g.pre.tempBytes)} | ${Math.max(0, ...(r.settleSpill ?? []).map((s) => s.ms))} |`);
  }
  emit("");
}
if (aDir) {
  const rows = load(aDir);
  disagg("A2. Where the bytes are, per autovacuum setting (1,000 players)", rows);
  const pick = rows.find((x) => x.label.startsWith("a2-"));
  if (pick) {
    const g = gp(pick.r);
    emit(`### A3. Per table, run ${pick.label} (before VACUUM)`, "", "| Table | Rows | Heap | Indexes | TOAST | Total | Dead tuples | Autovacuum runs | Inserts | Updates | HOT updates | Deletes |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const t of [...g.pre0011].sort((a, b) => b.total - a.total)) emit(`| ${t.table} | ${n0(t.rows)} | ${m(t.heap, 2)} | ${m(t.indexes, 2)} | ${m(t.toast, 2)} | ${m(t.total, 2)} | ${n0(t.dead)} | ${t.autovacuumCount} | ${n0(t.ins)} | ${n0(t.upd)} | ${n0(t.hotUpd)} | ${n0(t.del)} |`);
    emit("");
  }
}

/* ── C: grid ────────────────────────────────────────────────────────── */
if (cDir) {
  const rows = load(cDir);
  emit("### C1. Players by hostile share (14 days, cluster autovacuum defaults, no bench-side VACUUM before day 14)", "",
    "LOCAL POSTGRES VERIFIED. Hostile accounts each run 20 sessions a day of 500 units (a 300-unit daily budget applies). MiB.", "",
    "| Run | Players | Hostile accounts | Sessions (normal + hostile) | 0011 before VACUUM | 0011 after VACUUM | Challenges before VACUUM | 0011 after VACUUM FULL (diagnostic) | Database MiB | WAL MiB | Wall s |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { label, r } of rows) {
    const g = gp(r);
    emit(`| ${label} | ${n0(r.scenario.players)} | ${r.scenario.hostile?.accounts ?? 0} | ${n0(r.sessions - r.hostileSessions)} + ${n0(r.hostileSessions)} | ${m(g.preTotal)} | ${m(g.postTotal)} | ${m(g.ch.total)} | ${m(g.compact0011)} | ${m(g.last.databaseBytes)} | ${m(r.walBytes, 0)} | ${r.seconds.toFixed(0)} |`);
  }
  emit("");
  disagg("C2. Disaggregation per grid run", rows);
}

/* ── seasons: SIMULATION ONLY ───────────────────────────────────────── */
if (aDir) {
  const a = load(aDir);
  const find = (p: string) => a.find((x) => x.label.startsWith(p));
  const base = find("a2-") ?? a[0];
  if (base) {
    const g = gp(base.r);
    const per1000 = (r: Result) => 1000 / r.scenario.players;
    const rest = (g.postTotal - g.chPost.total) / MIB * per1000(base.r) - 0; // 0011 tables except challenges, per 1,000 players
    const regimes: [string, string | null][] = [["kept up (targeted autovacuum, 1 s naptime)", "a6-"], ["cluster defaults (60 s naptime)", "a2-"], ["autovacuum off (upper bound)", "a5-"]];
    emit("### S1. One versus four seasons, projected (SIMULATION ONLY)", "",
      "SIMULATION ONLY. Linear projection by `lifecycleCapacity.ts` (planning TTLs: 14-day raw, 120-day proofs and summaries, 90-day season), with the challenge-table size and the non-challenge 0011 block replaced by this study's measured 1,000-player values. Hostile accounts are assumed active for the whole horizon. Quota 500 MiB is an ASSUMPTION (owner to confirm); thresholds warn 60% / backpressure 75% / hard stop 85%. Cells: MiB (percent of 500, level).", "",
      `Measured non-challenge 0011 block at 1,000 players, after VACUUM: ${rest.toFixed(1)} MiB (model default ${LIFECYCLE_INPUTS.rawWindowMiBPer1000.toFixed(1)}).`, "",
      "| Players | Seasons | Hostile | " + regimes.map(([n]) => n).join(" | ") + " |", "|---|---|---|" + regimes.map(() => "---").join("|") + "|");
    for (const players of [200, 500, 1000, 5000]) for (const seasons of [1, 4]) for (const hostileShare of [0, 0.02, 0.1]) {
      const cells = regimes.map(([, p]) => {
        const rr = p ? find(p) : undefined;
        if (!rr) return "n/a";
        const chMiB = (gp(rr.r).ch.total / MIB) * per1000(rr.r);
        const inp: LifecycleInputs = { ...LIFECYCLE_INPUTS, rawWindowMiBPer1000: rest, challengesBloatMiBPer1000: chMiB, challengesKeptUpMiBPer1000: chMiB };
        const churn: ChurnRegime = "bench_bloat";
        const t = projectLifecycle({ players, hostileShare, seasons, churn }, inp).totalMiB;
        return `${n0(t)} (${n0((100 * t) / ASSUMED_TRIPWIRES.quotaMiB)}%, ${levelOf(t)})`;
      });
      emit(`| ${n0(players)} | ${seasons} | ${hostileShare * 100}% | ${cells.join(" | ")} |`);
    }
    emit("");
  }
}

/* ── B: burst ───────────────────────────────────────────────────────── */
const bDir = arg("b");
if (bDir) {
  interface Burst {
    variant: { name: string; mode: string; fillfactor: number | null; challengeAv: boolean }; clients: number; sessions: number; paceSeconds: number; wallSeconds: number; batchesPerSecond: number;
    latencyMs: { p50: number; p95: number; p99: number; max: number }; lockPhaseMs: { sum: number; p95: number; p99: number; max: number };
    lockWaitSamples: { sampled: number; withLockWait: number; peakWaiters: number }; retries: { lockTimeout: number; deadlock: number; other: number; gaveUp: number }; deadlocksDb: number;
    rowsWritten: { inserted: number; updated: number; deleted: number; rewrittenUnchanged: number };
    challengeTable: { live: number; dead: number; heapBytes: number; indexBytes: number; totalBytes: number; peakTotalBytes: number; startTotalBytes: number; ins: number; upd: number; hotUpd: number; del: number; autovacuumCount: number; freePercent?: number; deadTuplePercent?: number };
    afterPlainVacuumBytes: number; diagnosticAfterVacuumFullBytes: number; wal: { bytes: number; records: number; fpi: number };
    cpuSeconds: { clients: number | null; checkpointer: number | null; bgwriter: number | null; walwriter: number | null };
  }
  const files = readdirSync(bDir).filter((f) => f.endsWith(".json") && /^(p|s8|s16)-/.test(f)).sort();
  const rows = files.map((f) => {
    const label = basename(f, ".json"); const lp = join(bDir, `${label}.log`);
    return { label, b: JSON.parse(readFileSync(join(bDir, f), "utf8")) as Burst, av: existsSync(lp) ? avLog(readFileSync(lp, "utf8")).get("gameplay_unit_challenges") : undefined };
  });
  const tbl = (title: string, pre: RegExp, note: string) => {
    const sel = rows.filter((x) => pre.test(x.label));
    if (!sel.length) return;
    emit(`### ${title}`, "", note, "",
      "| Run | Clients | Batches | Wall s | Batches/s | Latency p50 / p95 / p99 ms | Lock phase p95 ms | Lock-wait samples (of N) | Peak waiters | Retries (lock timeout / deadlock / other) | Gave up | Table end MiB | Table peak MiB | After plain VACUUM MiB | After VACUUM FULL MiB (diagnostic) | Dead tuples | Free space % | HOT updates / updates | Autovacuum runs (DB view / log) | WAL MiB | WAL records | Full-page images | CPU s clients / bg / autovac |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const { label, b, av } of sel) {
      const bg = sum([b.cpuSeconds.checkpointer, b.cpuSeconds.bgwriter, b.cpuSeconds.walwriter].map((x) => x ?? 0)); // negative = a background process restarted mid-run: not measurable
      emit(`| ${label} | ${b.clients} | ${n0(b.sessions)} | ${b.wallSeconds.toFixed(0)} | ${b.batchesPerSecond.toFixed(1)} | ${b.latencyMs.p50} / ${b.latencyMs.p95} / ${b.latencyMs.p99} | ${b.lockPhaseMs.p95} | ${b.lockWaitSamples.withLockWait} of ${n0(b.lockWaitSamples.sampled)} | ${b.lockWaitSamples.peakWaiters} | ${b.retries.lockTimeout} / ${b.retries.deadlock} / ${b.retries.other} | ${b.retries.gaveUp} | ${m(b.challengeTable.totalBytes, 2)} | ${m(b.challengeTable.peakTotalBytes, 2)} | ${m(b.afterPlainVacuumBytes, 2)} | ${m(b.diagnosticAfterVacuumFullBytes, 2)} | ${n0(b.challengeTable.dead)} | ${b.challengeTable.freePercent ?? "-"} | ${n0(b.challengeTable.hotUpd)} / ${n0(b.challengeTable.upd)} | ${b.challengeTable.autovacuumCount} / ${av?.runs ?? 0} | ${m(b.wal.bytes)} | ${n0(b.wal.records)} | ${n0(b.wal.fpi)} | ${(b.cpuSeconds.clients ?? 0).toFixed(1)} / ${bg < 0 ? "n/m" : bg.toFixed(1)} / ${(av?.cpu ?? 0).toFixed(2)} |`);
    }
    emit("");
  };
  tbl("B1. Compressed 24 h, paced (one day of 5,000 players in 15 minutes, diurnal curve)", /^p-/,
    "LOCAL POSTGRES VERIFIED. 4,500 batches, 8 clients, 96x compression. Runs ending `-nap60` use the cluster default `autovacuum_naptime` of 60 s; the others use 1 s, which is the compression-scaled equivalent. Each run is its own throwaway cluster and database; the host was shared with other work, so wall-clock figures are noisy and CPU seconds are the steadier number.");
  tbl("B2. Saturation burst, 8 clients (20,000 batches as fast as the clients go; naptime 1 s)", /^s8-/, "LOCAL POSTGRES VERIFIED. About four days of a 5,000-player pilot in a minute. Not a forecast of any real load; it shows how each write path behaves when writers queue on shared units.");
  tbl("B3. Saturation burst, 16 clients", /^s16-/, "LOCAL POSTGRES VERIFIED. Same trace as B2 with twice the writers.");
}
console.log(out.join("\n"));
