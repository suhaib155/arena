/**
 * Synthetic multi-client burst against gameplay_unit_challenges (G34 HOT versus targeted autovacuum study).
 * Bench / test code only: it never touches the service, never runs against a hosted database, and the write
 * variants live only here (the service keeps its delete-and-insert; nothing in this file ships).
 *
 *   MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:55432/postgres \
 *     node --import tsx scripts/gameplay-challenge-burst.ts --variant baseline --out /tmp/burst.json
 *
 * Options:
 *   --variant <name>   baseline | targeted-av | inplace-ff100 | inplace-ff80 | inplace-ff80-av | diff-ff80 | diff-ff80-av | diff-ff100
 *   --clients N        concurrent clients (default 8)
 *   --sessions N       batches in the burst (default 4500: one day of 5,000 players at 60% active, 1.5 sessions)
 *   --pace-seconds S   0 = saturate (as fast as the clients can go); S > 0 = spread the batches over S seconds on a
 *                      24-slot diurnal curve (a compressed 24 h: S = 600 is 144x)
 *   --seed N           same seed = same batch trace for every variant
 *   --units N --contested N   pool of units and how many start with open challenges (defaults 20000 / 5000)
 *   --out <json>       result file
 *   --server-log <path> cluster log (log_autovacuum_min_duration=0) to read autovacuum CPU from
 *
 * The batch mirrors GameplayService.applyBatch for the challenge table: lock the touched units in order
 * (SELECT ... FOR UPDATE), read their challenges, update the units, then write the challenges one of three ways:
 *   delete-insert  today's code: DELETE all touched units' challenges, INSERT those left open (unchanged rows included)
 *   inplace        UPDATE the rows that stay open in place (no indexed column in the SET list), DELETE closed, INSERT new
 *   diff           write nothing for unchanged rows; DELETE closed, INSERT new
 * Calibration (200 players, 14 days, real bench): 31 units a batch, about 36 challenge rows rewritten a batch,
 * live rows roughly stable (inserts about equal deletes + unchanged).
 *
 * Safety: the URL must be local. Each run creates its own database and drops it.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

export type WriteMode = "delete-insert" | "inplace" | "diff";
export interface Variant { name: string; mode: WriteMode; fillfactor: number | null; challengeAv: boolean }
export const VARIANTS: Variant[] = [
  { name: "baseline", mode: "delete-insert", fillfactor: null, challengeAv: false },
  { name: "targeted-av", mode: "delete-insert", fillfactor: null, challengeAv: true },
  { name: "inplace-ff100", mode: "inplace", fillfactor: null, challengeAv: false },
  { name: "inplace-ff80", mode: "inplace", fillfactor: 80, challengeAv: false },
  { name: "inplace-ff80-av", mode: "inplace", fillfactor: 80, challengeAv: true },
  { name: "diff-ff100", mode: "diff", fillfactor: null, challengeAv: false },
  { name: "diff-ff80", mode: "diff", fillfactor: 80, challengeAv: false },
  { name: "diff-ff80-av", mode: "diff", fillfactor: 80, challengeAv: true },
];
/** The per-table autovacuum settings proposed in G34_DATA_LIFECYCLE.md section 5, option A. */
export const TARGETED_AV = "autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 200, autovacuum_vacuum_cost_delay = 0, autovacuum_analyze_scale_factor = 0.05";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const UNIT_BASE = 1n << 59n; // mode 1, as 0011's check requires. Synthetic ids, not real cells.
const unitId = (n: number) => (UNIT_BASE + BigInt(n)).toString();
const MIB = 1024 * 1024;

function sqlFile(path: string): string[] {
  return readFileSync(join(HERE, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
}
async function runInTx(pool: pg.Pool, statements: string[]) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); for (const s of statements) await c.query(s); await c.query("COMMIT"); }
  catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

interface ChallengeRow { unit: string; walker_id: string; first_day: number; opened: string }
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]!; };

/** CPU seconds (user + system) of a process from /proc, or null. */
function procCpu(pid: number): number | null {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = f.slice(f.lastIndexOf(")") + 2).split(" ");
    return (Number(rest[11]) + Number(rest[12])) / 100; // utime, stime in clock ticks (100 Hz)
  } catch { return null; }
}
function pidsByTitle(match: RegExp): number[] {
  const out: number[] = [];
  try {
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try { if (match.test(readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " "))) out.push(Number(d)); } catch { /* gone */ }
    }
  } catch { /* not linux */ }
  return out;
}

export interface BurstResult {
  variant: Variant; clients: number; sessions: number; paceSeconds: number; seed: number; units: number; contested: number;
  wallSeconds: number; batchesPerSecond: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  lockPhaseMs: { sum: number; p95: number; p99: number; max: number };
  lockWaitSamples: { sampled: number; withLockWait: number; peakWaiters: number };
  retries: { lockTimeout: number; deadlock: number; other: number; gaveUp: number };
  deadlocksDb: number;
  rowsWritten: { inserted: number; updated: number; deleted: number; rewrittenUnchanged: number };
  challengeTable: {
    live: number; dead: number; heapBytes: number; indexBytes: number; toastBytes: number; totalBytes: number;
    peakTotalBytes: number; startTotalBytes: number; ins: number; upd: number; hotUpd: number; del: number; autovacuumCount: number; autoanalyzeCount: number;
    pagesWithFree?: number; freePercent?: number; deadTuplePercent?: number;
  };
  afterPlainVacuumBytes: number;
  diagnosticAfterVacuumFullBytes: number;
  wal: { bytes: number; records: number; fpi: number };
  cpuSeconds: { clients: number | null; checkpointer: number | null; bgwriter: number | null; walwriter: number | null; autovacuumLog: number | null; autovacuumRuns: number | null };
  databaseBytesBeforeVacuumFull: number;
}

async function main() {
  const URL_ENV = process.env.MOVENRUN_BENCH_DATABASE_URL ?? "";
  if (!URL_ENV) { console.error("MOVENRUN_BENCH_DATABASE_URL is not set (a local, disposable PostgreSQL superuser URL)."); process.exit(2); }
  const base = new URL(URL_ENV);
  const host = base.hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) { console.error(`Refusing ${host || "(empty host)"}: local, disposable PostgreSQL only.`); process.exit(2); }
  const variant = VARIANTS.find((v) => v.name === (arg("variant") ?? "baseline"));
  if (!variant) throw new Error(`unknown variant; one of ${VARIANTS.map((v) => v.name).join(", ")}`);
  const clients = Number(arg("clients") ?? 8);
  const sessions = Number(arg("sessions") ?? 4500);
  const paceSeconds = Number(arg("pace-seconds") ?? 0);
  const seed = Number(arg("seed") ?? 7);
  const U = Number(arg("units") ?? 20000);
  const C = Number(arg("contested") ?? 5000);
  const W = 5000; // walkers
  const H = 200;  // holders
  const BATCH_UNITS = 31;
  const CLOSE_P = 0.04;
  const serverLog = arg("server-log");

  const admin = new pg.Pool({ connectionString: URL_ENV, max: 2 });
  const dbName = `challenge_burst_${randomBytes(5).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(URL_ENV); url.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: clients + 3 });
  pool.on("error", () => undefined);
  try {
    for (const role of ["anon", "authenticated"]) await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    const journal = JSON.parse(readFileSync(join(HERE, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    await runInTx(pool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
    await runInTx(pool, sqlFile("drizzle-proposed/0011_gameplay_holdings.sql"));
    // Storage parameters first, so the seed rows respect the fill factor.
    const opts: string[] = [];
    if (variant.fillfactor) opts.push(`fillfactor = ${variant.fillfactor}`);
    if (variant.challengeAv) opts.push(TARGETED_AV);
    if (opts.length) await pool.query(`ALTER TABLE gameplay_unit_challenges SET (${opts.join(", ")})`);

    const rng = mulberry32(seed);
    const userIds = [...Array.from({ length: H }, (_, i) => `h${i}`), ...Array.from({ length: W }, (_, i) => `w${i}`)];
    await pool.query(`INSERT INTO users (id) SELECT unnest($1::text[])`, [userIds]);
    const holderOf = (n: number) => `h${n % H}`;
    await pool.query(`INSERT INTO gameplay_units (unit, holder_id, strength, as_of_day, holding_rules_version)
      SELECT (${UNIT_BASE}::bigint + n), 'h' || (n % ${H}), 50, 100, 1002 FROM generate_series(0, $1::int - 1) AS n`, [U - 1 + 1]);
    // Contested units: a spread over the pool (every U/C-th), 1..9 challengers each, mean about 4.5 (triangular).
    const first: { u: string; w: string }[] = [];
    for (let k = 0; k < C; k++) {
      const n = Math.floor((k * U) / C);
      const rows = 1 + Math.floor((rng() + rng()) * 4.5);
      const seen = new Set<number>();
      while (seen.size < Math.min(rows, 9)) seen.add(Math.floor(rng() * W));
      for (const w of seen) first.push({ u: unitId(n), w: `w${w}` });
    }
    await pool.query(`INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at)
      SELECT u, w, 99, 1002, now() - interval '1 day' FROM unnest($1::bigint[], $2::text[]) AS t(u, w)`, [first.map((f) => f.u), first.map((f) => f.w)]);
    await pool.query("VACUUM ANALYZE");
    await pool.query("CHECKPOINT");
    const size = async (c: pg.Pool | pg.PoolClient = pool) => (await c.query(`SELECT pg_relation_size('gameplay_unit_challenges') h, pg_indexes_size('gameplay_unit_challenges') i, pg_total_relation_size('gameplay_unit_challenges') t,
      coalesce(pg_total_relation_size(reltoastrelid),0) toast FROM pg_class WHERE oid = 'gameplay_unit_challenges'::regclass`)).rows[0];
    const startTotal = Number((await size()).t);
    // Counters are cumulative and flushed lazily, so take a baseline after the seed has been flushed and subtract it at the end.
    const counters = async () => {
      await new Promise((r) => setTimeout(r, 2500));
      await pool.query("SELECT pg_stat_clear_snapshot()");
      return (await pool.query(`SELECT n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del, autovacuum_count, autoanalyze_count FROM pg_stat_user_tables WHERE relname = 'gameplay_unit_challenges'`)).rows[0] as Record<string, string>;
    };
    const c0 = await counters();
    const dl0 = Number((await pool.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)).rows[0].deadlocks);

    // The batch trace is built up front from the seed, so every variant sees the same windows and decisions.
    // 30% of batches land in a 400-unit hot area (a busy district), the rest spread over the pool.
    interface Job { at: number; start: number; seed: number }
    const jobs: Job[] = [];
    const weights = [1, 1, 1, 1, 1, 2, 4, 6, 6, 5, 4, 4, 5, 5, 4, 4, 5, 7, 8, 7, 5, 3, 2, 1].map((x) => x); // diurnal curve, 24 slots
    const wsum = weights.reduce((a, b) => a + b, 0);
    const traceRng = mulberry32(seed ^ 0x9e3779b9);
    for (let i = 0; i < sessions; i++) {
      const hot = traceRng() < 0.3;
      const start = hot ? Math.floor(traceRng() * 400) : Math.floor(traceRng() * (U - BATCH_UNITS));
      let at = 0;
      if (paceSeconds > 0) {
        let r = traceRng() * wsum; let slot = 0;
        while (slot < 23 && r >= weights[slot]!) { r -= weights[slot]!; slot++; }
        at = ((slot + r / weights[slot]!) / 24) * paceSeconds;
      }
      jobs.push({ at, start, seed: Math.floor(traceRng() * 2 ** 31) });
    }
    jobs.sort((a, b) => a.at - b.at);

    // Instrumentation.
    const lat: number[] = [], lockPhase: number[] = [];
    const retries = { lockTimeout: 0, deadlock: 0, other: 0, gaveUp: 0 };
    const rows = { inserted: 0, updated: 0, deleted: 0, rewrittenUnchanged: 0 };
    let next = 0;
    let peakTotal = startTotal;
    let running = true;
    const waitSamples = { sampled: 0, withLockWait: 0, peakWaiters: 0 };
    const sampler = (async () => {
      const c = await pool.connect();
      try {
        while (running) {
          const w = Number((await c.query(`SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].n);
          waitSamples.sampled++; if (w > 0) waitSamples.withLockWait++; waitSamples.peakWaiters = Math.max(waitSamples.peakWaiters, w);
          const t = Number((await size(c)).t); if (t > peakTotal) peakTotal = t;
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally { c.release(); }
    })();

    const walStart = (await pool.query(`SELECT pg_current_wal_lsn()::text l`)).rows[0].l as string;
    const walStat0 = (await pool.query(`SELECT wal_records, wal_fpi, wal_bytes FROM pg_stat_wal`)).rows[0];
    const bgPids = { checkpointer: pidsByTitle(/postgres: .*checkpointer/), bgwriter: pidsByTitle(/postgres: .*background writer/), walwriter: pidsByTitle(/postgres: .*walwriter/) };
    const cpu0 = (ps: number[]) => ps.reduce((a, p) => a + (procCpu(p) ?? 0), 0);
    const bg0 = { checkpointer: cpu0(bgPids.checkpointer), bgwriter: cpu0(bgPids.bgwriter), walwriter: cpu0(bgPids.walwriter) };
    const t0 = Date.now();
    const clientPids: number[] = [];
    const held: pg.PoolClient[] = [];
    const clientCpu0: Record<number, number> = {};

    async function batch(c: pg.PoolClient, job: Job): Promise<void> {
      const r = mulberry32(job.seed);
      const units = Array.from({ length: BATCH_UNITS }, (_, i) => job.start + i).filter((n) => n < U);
      const ids = units.map(unitId);
      for (let attempt = 0; ; attempt++) {
        const tStart = Date.now();
        try {
          await c.query("BEGIN");
          const tl = Date.now();
          await c.query(`SELECT unit FROM gameplay_units WHERE unit = ANY($1::bigint[]) ORDER BY unit FOR UPDATE`, [ids]);
          lockPhase.push(Date.now() - tl);
          const cur = (await c.query(`SELECT unit::text AS unit, walker_id, first_day, opened_received_at::text AS opened FROM gameplay_unit_challenges
            WHERE unit = ANY($1::bigint[]) ORDER BY unit, walker_id`, [ids])).rows as ChallengeRow[];
          // The decisions: each open row closes with CLOSE_P; a touched unit gains a challenger at the matching rate.
          const kept: ChallengeRow[] = [], closed: ChallengeRow[] = [], opened: { unit: string; walker_id: string }[] = [];
          const byUnit = new Map<string, ChallengeRow[]>();
          for (const x of cur) { (byUnit.get(x.unit) ?? byUnit.set(x.unit, []).get(x.unit)!).push(x); }
          for (const x of cur) (r() < CLOSE_P ? closed : kept).push(x);
          for (const id of ids) {
            const existing = byUnit.get(id) ?? [];
            // A contested unit gains challengers at the rate it loses them; a quiet one is contested only now and then.
            const p = existing.length > 0 ? Math.min(0.9, CLOSE_P * existing.length) : 0.012;
            if (r() < p) {
              const w = `w${Math.floor(r() * W)}`;
              if (existing.some((e) => e.walker_id === w)) continue;
              opened.push({ unit: id, walker_id: w });
            }
          }
          // The unit rows move on (strength and version), as the batch does.
          await c.query(`UPDATE gameplay_units u SET strength = 40 + (v.n % 50), version = u.version + 1, updated_at = now()
            FROM unnest($1::bigint[], $2::int[]) AS v(unit, n) WHERE u.unit = v.unit`, [ids, ids.map((_, i) => Math.floor(r() * 1000) + i)]);
          if (variant.mode === "delete-insert") {
            await c.query(`DELETE FROM gameplay_unit_challenges WHERE unit = ANY($1::bigint[])`, [ids]);
            const all = [...kept.map((k) => ({ u: k.unit, w: k.walker_id, d: k.first_day, o: k.opened })), ...opened.map((o) => ({ u: o.unit, w: o.walker_id, d: 100, o: "" }))];
            if (all.length) await c.query(`INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at)
              SELECT v.u, v.w, v.d, 1002, coalesce(nullif(v.o, '')::timestamptz, now()) FROM unnest($1::bigint[], $2::text[], $3::int[], $4::text[]) AS v(u, w, d, o)`,
              [all.map((x) => x.u), all.map((x) => x.w), all.map((x) => x.d), all.map((x) => x.o)]);
            rows.deleted += cur.length; rows.inserted += all.length; rows.rewrittenUnchanged += kept.length;
          } else {
            if (closed.length) await c.query(`DELETE FROM gameplay_unit_challenges t USING unnest($1::bigint[], $2::text[]) AS v(u, w) WHERE t.unit = v.u AND t.walker_id = v.w`,
              [closed.map((x) => x.unit), closed.map((x) => x.walker_id)]);
            if (variant.mode === "inplace" && kept.length) {
              // Same values, written in place: only non-indexed columns in the SET list, so the update can be heap-only.
              await c.query(`UPDATE gameplay_unit_challenges t SET first_day = v.d, holding_rules_version = 1002, opened_received_at = v.o::timestamptz
                FROM unnest($1::bigint[], $2::text[], $3::int[], $4::text[]) AS v(u, w, d, o) WHERE t.unit = v.u AND t.walker_id = v.w`,
                [kept.map((x) => x.unit), kept.map((x) => x.walker_id), kept.map((x) => x.first_day), kept.map((x) => x.opened)]);
              rows.updated += kept.length; rows.rewrittenUnchanged += kept.length;
            }
            if (opened.length) await c.query(`INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at)
              SELECT v.u, v.w, 100, 1002, now() FROM unnest($1::bigint[], $2::text[]) AS v(u, w)`, [opened.map((x) => x.unit), opened.map((x) => x.walker_id)]);
            rows.deleted += closed.length; rows.inserted += opened.length;
          }
          await c.query("COMMIT");
          lat.push(Date.now() - tStart);
          return;
        } catch (e) {
          await c.query("ROLLBACK").catch(() => undefined);
          const code = (e as { code?: string }).code;
          if (code === "55P03") retries.lockTimeout++; else if (code === "40P01") retries.deadlock++; else retries.other++;
          if (attempt >= 8) { retries.gaveUp++; return; }
          await new Promise((res) => setTimeout(res, 5 + Math.floor(r() * 20)));
        }
      }
    }

    await Promise.all(Array.from({ length: clients }, async () => {
      const c = await pool.connect();
      held.push(c);
      try {
        await c.query(`SET lock_timeout = '2s'`);
        const pid = Number((await c.query(`SELECT pg_backend_pid() p`)).rows[0].p);
        clientPids.push(pid); clientCpu0[pid] = procCpu(pid) ?? 0;
        while (true) {
          const i = next++;
          if (i >= jobs.length) break;
          const job = jobs[i]!;
          if (paceSeconds > 0) { const wait = t0 + job.at * 1000 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); }
          await batch(c, job);
        }
      } finally { /* released after the CPU read */ }
    }));
    const wallSeconds = (Date.now() - t0) / 1000;
    // CPU of the client backends, before they are released.
    const clientCpu = clientPids.reduce((a, p) => a + Math.max(0, (procCpu(p) ?? 0) - (clientCpu0[p] ?? 0)), 0);
    const bgCpu = (k: keyof typeof bgPids) => bgPids[k].length ? cpu0(bgPids[k]) - bg0[k] : null;
    for (const c of held) c.release();
    running = false; await sampler;
    
    const walEnd = (await pool.query(`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn) AS b`, [walStart])).rows[0].b;
    const walStat1 = (await pool.query(`SELECT wal_records, wal_fpi, wal_bytes FROM pg_stat_wal`)).rows[0];
    const st1 = await counters();
    const st = (await pool.query(`SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'gameplay_unit_challenges'`)).rows[0];
    const d = (k: string) => Number(st1[k]) - Number(c0[k]);
    const sz = await size();
    const live = Number((await pool.query(`SELECT count(*) n FROM gameplay_unit_challenges`)).rows[0].n);
    const dl = Number((await pool.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)).rows[0].deadlocks);
    let ptuple: { freePercent?: number; deadTuplePercent?: number } = {};
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS pgstattuple");
      const t = (await pool.query(`SELECT free_percent, dead_tuple_percent FROM pgstattuple('gameplay_unit_challenges')`)).rows[0];
      ptuple = { freePercent: Number(t.free_percent), deadTuplePercent: Number(t.dead_tuple_percent) };
    } catch { /* extension not installed */ }
    const dbBefore = Number((await pool.query(`SELECT pg_database_size(current_database()) b`)).rows[0].b);
    // What a plain VACUUM leaves (it only truncates a free tail), then, for the diagnostic column only, VACUUM FULL on this throwaway database.
    await pool.query("VACUUM gameplay_unit_challenges");
    const afterVac = Number((await size()).t);
    await pool.query("VACUUM FULL gameplay_unit_challenges");
    const afterFull = Number((await size()).t);

    let avCpu: number | null = null, avRuns: number | null = null;
    if (serverLog && existsSync(serverLog)) {
      const log = readFileSync(serverLog, "utf8").split("\n");
      avCpu = 0; avRuns = 0;
      for (let i = 0; i < log.length; i++) {
        if (log[i]!.includes(`automatic vacuum of table "${dbName}.public.gameplay_unit_challenges"`)) {
          avRuns++;
          for (let j = i; j < Math.min(log.length, i + 40); j++) {
            if (j > i && /^\d{4}-\d\d-\d\d /.test(log[j]!)) break;
            const m = /CPU: user: ([\d.]+) s, system: ([\d.]+) s/.exec(log[j]!);
            if (m) { avCpu += Number(m[1]) + Number(m[2]); break; }
          }
        }
      }
    }
    const result: BurstResult = {
      variant, clients, sessions, paceSeconds, seed, units: U, contested: C, wallSeconds, batchesPerSecond: sessions / wallSeconds,
      latencyMs: { p50: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99), max: Math.max(0, ...lat) },
      lockPhaseMs: { sum: lockPhase.reduce((a, b) => a + b, 0), p95: pct(lockPhase, 0.95), p99: pct(lockPhase, 0.99), max: Math.max(0, ...lockPhase) },
      lockWaitSamples: waitSamples, retries, deadlocksDb: dl - dl0, rowsWritten: rows,
      challengeTable: { live, dead: Number(st.n_dead_tup), heapBytes: Number(sz.h), indexBytes: Number(sz.i), toastBytes: Number(sz.toast), totalBytes: Number(sz.t), peakTotalBytes: peakTotal, startTotalBytes: startTotal,
        ins: d("n_tup_ins"), upd: d("n_tup_upd"), hotUpd: d("n_tup_hot_upd"), del: d("n_tup_del"), autovacuumCount: d("autovacuum_count"), autoanalyzeCount: d("autoanalyze_count"), ...ptuple },
      afterPlainVacuumBytes: afterVac, diagnosticAfterVacuumFullBytes: afterFull,
      wal: { bytes: Number(walEnd), records: Number(walStat1.wal_records) - Number(walStat0.wal_records), fpi: Number(walStat1.wal_fpi) - Number(walStat0.wal_fpi) },
      cpuSeconds: { clients: clientCpu, checkpointer: bgCpu("checkpointer"), bgwriter: bgCpu("bgwriter"), walwriter: bgCpu("walwriter"), autovacuumLog: avCpu, autovacuumRuns: avRuns },
      databaseBytesBeforeVacuumFull: dbBefore,
    };
    const out = arg("out");
    if (out) writeFileSync(out, JSON.stringify(result, null, 2)); else console.log(JSON.stringify(result, null, 2));
    console.error(`${variant.name}: ${wallSeconds.toFixed(1)} s, table ${(Number(sz.t) / MIB).toFixed(2)} MiB (peak ${(peakTotal / MIB).toFixed(2)}), live ${live}, dead ${st.n_dead_tup}, hot ${d("n_tup_hot_upd")}/${d("n_tup_upd")}, WAL ${(Number(walEnd) / MIB).toFixed(1)} MiB, retries ${JSON.stringify(retries)}`);
  } finally {
    await pool.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
