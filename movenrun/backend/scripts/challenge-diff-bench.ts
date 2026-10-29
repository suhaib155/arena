/**
 * Challenge write bench: the same synthetic workload against gameplay_unit_challenges with the default
 * delete-and-insert writes and with the diff mode, on a disposable LOCAL PostgreSQL. Not run in CI.
 *
 *   MOVENRUN_BENCH_DATABASE_URL=postgres://user:pass@localhost:5432/postgres \
 *     node --import tsx scripts/challenge-diff-bench.ts [--units 2000] [--batches 400] [--batch-size 25] [--seed 1]
 *
 * It drives writeChallenges (service.ts), the function both modes of the live write path call, with
 * batches built from one seeded generator, so the two runs receive identical input. Per mode it prints:
 * WAL bytes (a CLUSTER-WIDE pg_current_wal_lsn difference, see below), dead tuples and the tuple counters
 * of the challenge table, its heap size, and wall time, together with the server settings that shape those numbers.
 *
 * Choices that affect the numbers, all printed:
 *  - autovacuum is switched off for the challenge table during a run, so dead tuples are the writes' own
 *    and not a race with the vacuum worker; the server's autovacuum settings are printed anyway;
 *  - a CHECKPOINT runs before each mode when the role may, so both start with full-page images due;
 *  - WAL is the difference of pg_current_wal_lsn() before and after the timed loop. The LSN is shared by the
 *    whole cluster, so it also counts any other activity on this server in that window (other databases,
 *    autovacuum of other tables, checkpoints' full-page images). Run it on an otherwise idle cluster; the
 *    number is an upper bound for this table's writes, not a per-table figure;
 *  - tuple counters and dead tuples are DELTAS of pg_stat_user_tables read before and after the timed loop.
 *    The role cannot call pg_stat_reset_single_table_counters (permission denied), so nothing is reset.
 *    The statistics are flushed to the shared stats lazily (about once a second, per backend, when idle), so
 *    after the loop the counters are polled until the insert+update+delete total has been unchanged for
 *    three consecutive reads (or a timeout). The method actually used is printed per run; if the counters
 *    never moved, the columns print "not measured" instead of a number. pg_stat_force_next_flush() (PostgreSQL
 *    17 only) acts on the calling backend, not on the pooled connections that did the writes, so it is
 *    reported as available or not but is not relied on;
 *  - one run, one machine: a local measurement of the SQL work, not a capacity figure for any hosted database.
 *
 * Safety: the URL must point at this machine. Each mode gets its own database, dropped afterwards.
 */
import { performance } from "node:perf_hooks";
import { createTestDb } from "../src/gameplay/pgTestDb.js";
import { writeChallenges, type ChallengeWriteMode, type OpenChallenge } from "../src/gameplay/service.js";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const UNITS = arg("units", 2000), BATCHES = arg("batches", 400), BATCH = arg("batch-size", 25), SEED = arg("seed", 1);
const HV = 1002;

const url = process.env.MOVENRUN_BENCH_DATABASE_URL;
if (!url) { console.error("set MOVENRUN_BENCH_DATABASE_URL (a local PostgreSQL)"); process.exit(2); }
if (!["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(new URL(url).hostname)) { console.error("refusing a database that is not on this machine"); process.exit(2); }

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

/**
 * The workload, as data: each batch is a set of units and the challenges left open on them. Per existing row,
 * about 93% are written back unchanged (the repeat-push case), 4% change first_day and 3% close (the closed rows
 * are not written back, so 97% of rows are kept: ~93% unchanged and 4% changed); each unit also opens a
 * new challenger 10% of the time. Generated once and replayed in both modes.
 */
type Batch = { units: string[]; open: OpenChallenge[] };
function workload(): { initial: OpenChallenge[]; batches: Batch[] } {
  const rng = mulberry32(SEED);
  const base = 1n << 59n;
  const unit = (n: number) => (base + BigInt(n)).toString();
  const state = new Map<string, OpenChallenge>(); // key unit/walker
  const key = (u: string, w: string) => `${u}/${w}`;
  const initial: OpenChallenge[] = [];
  for (let n = 0; n < UNITS; n++) {
    for (let k = 0; k < 3; k++) {
      const c = { unit: unit(n), walkerId: `w${(n * 7 + k * 13) % 500}`, day: 900 + (n % 50), openedMs: 1_700_000_000_000 + n * 1000 + k };
      initial.push(c); state.set(key(c.unit, c.walkerId), c);
    }
  }
  const batches: Batch[] = [];
  for (let b = 0; b < BATCHES; b++) {
    const start = Math.floor(rng() * (UNITS - BATCH));
    const units = Array.from({ length: BATCH }, (_, i) => unit(start + i));
    const open: OpenChallenge[] = [];
    for (const u of units) {
      for (const c of [...state.values()].filter((x) => x.unit === u)) {
        const r = rng();
        if (r < 0.03) { state.delete(key(c.unit, c.walkerId)); continue; }
        const next = r < 0.07 ? { ...c, day: c.day === 1000 ? 950 : 1000 } : c;
        state.set(key(next.unit, next.walkerId), next);
        open.push(next);
      }
      if (rng() < 0.1) {
        const w = `w${Math.floor(rng() * 500)}`;
        if (!state.has(key(u, w))) { const c = { unit: u, walkerId: w, day: 990, openedMs: 1_700_100_000_000 + b }; state.set(key(u, w), c); open.push(c); }
      }
    }
    batches.push({ units, open });
  }
  return { initial, batches };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Q = (text: string, params?: unknown[]) => Promise<Record<string, any>[]>;
interface StatRow { ins: number; upd: number; del: number; hot: number; dead: number }
const NOT_MEASURED = "not measured";

/** One read of the challenge table's counters; the snapshot is cleared first so a cached one is never served. */
async function readStat(q: Q): Promise<StatRow> {
  await q(`SELECT pg_stat_clear_snapshot()`);
  const r = (await q(`SELECT n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'gameplay_unit_challenges'`))[0];
  if (!r) throw new Error("gameplay_unit_challenges is missing from pg_stat_user_tables");
  return { ins: Number(r.n_tup_ins), upd: Number(r.n_tup_upd), del: Number(r.n_tup_del), hot: Number(r.n_tup_hot_upd), dead: Number(r.n_dead_tup) };
}

/** Baseline read: polls (every 500 ms, up to 20 s) until the ins+upd+del total is unchanged for three reads. */
async function settledBaseline(q: Q): Promise<StatRow> {
  const total = (s: StatRow) => s.ins + s.upd + s.del;
  let last = await readStat(q), stable = 0;
  const started = performance.now();
  while (performance.now() - started < 20_000 && stable < 3) {
    await sleep(500);
    const now = await readStat(q);
    stable = total(now) === total(last) ? stable + 1 : 0;
    last = now;
  }
  return last;
}

/**
 * Counter deltas after the timed loop. Polls (every 500 ms, up to 20 s) until the ins+upd+del total has moved
 * and then stayed unchanged for three consecutive reads. Returns the deltas and the method, or "not measured"
 * when nothing ever moved (stats collection off, or the flush never arrived in time).
 */
async function settledDelta(q: Q, before: StatRow) {
  const forceFlush = (await q(`SELECT to_regproc('pg_stat_force_next_flush') IS NOT NULL AS has`))[0].has as boolean;
  const total = (s: StatRow) => s.ins + s.upd + s.del;
  let last = await readStat(q), stable = 0, polls = 0;
  const started = performance.now();
  while (performance.now() - started < 20_000) {
    await sleep(500);
    const now = await readStat(q);
    polls++;
    stable = total(now) === total(last) && total(now) > total(before) ? stable + 1 : 0;
    last = now;
    if (stable >= 3) break;
  }
  const ms = Math.round(performance.now() - started);
  if (stable < 3) {
    return { measured: false as const, method: `delta of pg_stat_user_tables, polled ${polls}x over ${ms} ms: counters did not move and settle; pg_stat_force_next_flush ${forceFlush ? "exists but only flushes the calling backend" : "not available"}` };
  }
  return {
    measured: true as const,
    method: `delta of pg_stat_user_tables (no reset; the role may not reset counters), polled ${polls}x over ${ms} ms until the write total was unchanged for 3 reads; pg_stat_force_next_flush ${forceFlush ? "exists but only flushes the calling backend, not used" : "not available on this server"}`,
    ins: last.ins - before.ins, upd: last.upd - before.upd, del: last.del - before.del, hot: last.hot - before.hot, dead: last.dead - before.dead,
  };
}
const cell = (r: { stat: Awaited<ReturnType<typeof settledDelta>> }, k: "ins" | "upd" | "del" | "hot" | "dead") => (r.stat.measured ? String(r.stat[k]) : NOT_MEASURED);

async function run(mode: ChallengeWriteMode, w: ReturnType<typeof workload>) {
  const t = await createTestDb(url!, `chbench_${mode === "diff" ? "d" : "i"}`, { gameplay: true });
  try {
    const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
    await q(`INSERT INTO users (id) SELECT 'w' || g FROM generate_series(0, 499) g`);
    await q(`INSERT INTO users (id) VALUES ('holder')`);
    await q(`INSERT INTO gameplay_units (unit, holder_id, strength, as_of_day, holding_rules_version)
      SELECT ${1n << 59n}::bigint + g, 'holder', 60, 1000, ${HV} FROM generate_series(0, ${UNITS - 1}) g`);
    await q(`ALTER TABLE gameplay_unit_challenges SET (autovacuum_enabled = false)`);
    await t.db.transaction((tx) => writeChallenges(tx, "delete-insert", [], [], HV)); // warm the connection path
    // Initial state, written the same way in both runs (not measured).
    for (let i = 0; i < w.initial.length; i += 2000) {
      const part = w.initial.slice(i, i + 2000);
      await t.db.transaction((tx) => writeChallenges(tx, "delete-insert", [...new Set(part.map((c) => c.unit))], part, HV));
    }
    await q(`VACUUM (ANALYZE) gameplay_unit_challenges`);
    let checkpoint = "done";
    try { await q("CHECKPOINT"); } catch (e) { checkpoint = `not permitted (${(e as { code?: string }).code})`; }
    const stat0 = await settledBaseline(q);
    const lsn0 = (await q(`SELECT pg_current_wal_lsn() AS l`))[0].l as string;
    const started = performance.now();
    for (const b of w.batches) await t.db.transaction((tx) => writeChallenges(tx, mode, b.units, b.open, HV));
    const wallMs = performance.now() - started;
    const walBytes = Number((await q(`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1) AS d`, [lsn0]))[0].d);
    const stat = await settledDelta(q, stat0);
    const heap = Number((await q(`SELECT pg_relation_size('gameplay_unit_challenges') AS b`))[0].b);
    const rows = Number((await q(`SELECT count(*) AS n FROM gameplay_unit_challenges`))[0].n);
    const digest = (await q(`SELECT md5(string_agg(unit::text || '/' || walker_id || '/' || first_day || '/' || holding_rules_version || '/' || extract(epoch FROM opened_received_at), '|' ORDER BY unit, walker_id)) AS d FROM gameplay_unit_challenges`))[0].d as string;
    return { mode, walBytes, wallMs, stat, heap, rows, digest, checkpoint };
  } finally {
    await t.drop();
  }
}

async function settings() {
  const t = await createTestDb(url!, "chbench_s", { gameplay: false });
  try {
    const names = ["server_version", "autovacuum", "autovacuum_naptime", "autovacuum_vacuum_threshold", "autovacuum_vacuum_scale_factor", "wal_level", "synchronous_commit",
      "full_page_writes", "wal_compression", "shared_buffers", "checkpoint_timeout", "max_wal_size", "fsync"];
    const rows = (await t.pool.query(`SELECT name, setting, unit FROM pg_settings WHERE name = ANY($1::text[])`, [names])).rows;
    return rows.map((r) => `${r.name}=${r.setting}${r.unit ?? ""}`).join(" ");
  } finally {
    await t.drop();
  }
}

const w = workload();
const opened = w.batches.reduce((n, b) => n + b.open.length, 0);
console.log(`LOCAL PostgreSQL, SINGLE RUN, one machine: a measurement of the SQL work, not a capacity figure for any hosted database.`);
console.log(`workload: ${UNITS} units x 3 challengers, ${BATCHES} batches of ${BATCH} units, ${opened} challenge rows written back in all, seed ${SEED}; per existing row ~93% unchanged, 4% first_day change, 3% close, and 10% of units open one more`);
console.log(`settings: ${await settings()}; challenge table autovacuum_enabled=false during the run; fillfactor default`);
const results = [];
for (const mode of ["delete-insert", "diff"] as const) results.push(await run(mode, w));
console.log(`CHECKPOINT before each run: ${results.map((r) => `${r.mode}=${r.checkpoint}`).join(", ")}`);
for (const r of results) console.log(`counter method (${r.mode}): ${r.stat.method}`);
console.log(`wal_bytes is a cluster-wide pg_current_wal_lsn difference over the timed loop (includes any other activity on this server); dead_tuples and n_tup_* are deltas over the same loop.`);
console.log(["mode", "wal_bytes", "dead_tuples", "wall_ms", "n_tup_ins", "n_tup_upd", "n_tup_del", "n_tup_hot_upd", "heap_bytes", "rows"].join("\t"));
for (const r of results) console.log([r.mode, r.walBytes, cell(r, "dead"), r.wallMs.toFixed(0), cell(r, "ins"), cell(r, "upd"), cell(r, "del"), cell(r, "hot"), r.heap, r.rows].join("\t"));
const [a, b] = results as [typeof results[number], typeof results[number]];
console.log(`final table identical in both modes (md5 of all rows): ${a.digest === b.digest} (${a.digest})`);
console.log(`diff vs delete-insert: WAL (cluster-wide LSN difference) ${((b.walBytes / a.walBytes) * 100).toFixed(1)}%, dead tuples ${a.stat.measured && b.stat.measured ? ((b.stat.dead / Math.max(1, a.stat.dead)) * 100).toFixed(1) + "%" : NOT_MEASURED}, wall ${((b.wallMs / a.wallMs) * 100).toFixed(1)}%`);
if (a.digest !== b.digest) process.exit(1);
