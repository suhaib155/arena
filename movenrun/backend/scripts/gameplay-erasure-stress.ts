/**
 * Account-erasure stress under live gameplay load, 200 synthetic players. LOCAL, SYNTHETIC, NOT A CAPACITY FIGURE.
 *
 *   MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:55432/postgres \
 *     node --import tsx scripts/gameplay-erasure-stress.ts --mode sync|async --out /tmp/stress.json \
 *       [--players 200] [--seed 29] [--erasers 24] [--pushers 12] [--closers 1] [--day-ms 4000] [--pool 40]
 *       [--repeats 3] [--drain-cap-s 300] [--workers 1] [--server-log /tmp/movenrun-pgbench16/server.log]
 *
 * One template database is seeded exactly as gameplay-erasure-bench.ts seeds it (same seed, same world: 200 players,
 * days D..D+5, D..D+2 settled), then every repeat runs on a fresh CREATE DATABASE ... TEMPLATE clone:
 *   - `erasers` client loops request deletion of every player once, in a seeded random order (200 requests);
 *   - `pushers` loops keep applying new verified sessions for players not yet asked to be deleted;
 *   - `closers` loops call settleDueDays every 500 ms while the game clock advances one day every `day-ms` of wall time;
 *   - the pool has the production client limits (statement_timeout and query_timeout 10 s) and `pool` connections.
 * mode sync:  each request runs the whole erasure (store.erase, as the API does with gameplay off or before the queue).
 * mode async: each request runs store.request (acceptance + job) and `workers` in-process erasure workers drain the
 *             queue (kicked after each acceptance and every second), while the load keeps running, until the queue is
 *             empty or `drain-cap-s` passed. Needs the queue code (it fails fast on a base without it).
 * A client gives up after 10 s (initiation latency above 10 s counts as a client timeout even if the server finished).
 *
 * Safety: the URL must be this machine and either user `bench` or a non-default port, and the cluster may hold only
 * the system databases and this script's erstress_* databases; everything it creates is dropped at the end unless
 * --keep. Synthetic ids and cells only; nothing reaches a provider (no provider client is wired).
 */
import { writeFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { gridDisk, latLngToCell } from "h3-js";
import type { Db } from "../src/db/client.js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "../src/gameplay/rules.js";
import { GameplayService } from "../src/gameplay/service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "../src/gameplay/sealFixtures.js";
import { createTestDb } from "../src/gameplay/pgTestDb.js";
import * as deletion from "../src/identity/accountDeletion.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const URL_ENV = process.env.MOVENRUN_BENCH_DATABASE_URL ?? "";
if (!URL_ENV) { console.error("MOVENRUN_BENCH_DATABASE_URL is not set (a local, disposable PostgreSQL superuser URL)."); process.exit(2); }
{
  const u = new URL(URL_ENV);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!(["localhost", "127.0.0.1", "::1"].includes(host))) { console.error(`Refusing ${host || "(empty host)"}: local PostgreSQL only.`); process.exit(2); }
  if (decodeURIComponent(u.username) !== "bench" && (u.port || "5432") === "5432") {
    console.error("Refusing: connect as user `bench` or on a non-default port (not 5432); this script creates and drops databases and must only run on a throwaway cluster.");
    process.exit(2);
  }
}
const MODE = arg("mode") ?? "sync";
if (MODE !== "sync" && MODE !== "async") { console.error("--mode must be sync or async"); process.exit(2); }
const KEEP = process.argv.includes("--keep");
const PLAYERS = Number(arg("players") ?? 200);
const SEED = Number(arg("seed") ?? 29);
const ERASERS = Number(arg("erasers") ?? 24);
const PUSHERS = Number(arg("pushers") ?? 12);
const CLOSERS = Number(arg("closers") ?? 1);
const DAY_WALL_MS = Number(arg("day-ms") ?? 4000);
const POOL = Number(arg("pool") ?? 40);
const REPEATS = Number(arg("repeats") ?? 3);
const DRAIN_CAP_S = Number(arg("drain-cap-s") ?? 300);
const WORKERS = Number(arg("workers") ?? 1);
const SERVER_LOG = arg("server-log");
const OUT = arg("out");
const CLIENT_TIMEOUT_MS = 10_000;

let s = SEED >>> 0 || 1;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(a: readonly T[], r = rnd) => a[Math.floor(r() * a.length)]!;

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const DAYS = 6;
const SETTLED_DAYS = 3;
const CELLS = gridDisk(latLngToCell(51.5007, -0.1246, 8), 12).sort();
const HOT = CELLS.slice(0, 40);

const q = (pool: pg.Pool, text: string, values: unknown[] = []) => pool.query(text, values).then((r) => r.rows);
const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? +a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]!.toFixed(0) : null; };
const dist = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 0.5), p90: pct(xs, 0.9), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: xs.length ? +Math.max(...xs).toFixed(0) : null });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeOf = (e: unknown) => {
  const x = e as { code?: string; reason?: string; name?: string; message?: string };
  if (x?.name === "ErasureBusyError") return `busy:${x.reason}`;
  return x?.code ?? (/timeout exceeded when trying to connect/.test(String(x?.message)) ? "pool_timeout" : x?.name ?? "error");
};

const admin = new pg.Pool({ connectionString: URL_ENV, max: 4 });
admin.on("error", () => undefined);
const created: string[] = [];
const dbUrl = (name: string) => { const u = new URL(URL_ENV); u.pathname = `/${name}`; return u.toString(); };

interface Player { id: string; zone: string[]; activity: number; heavy: boolean; sessions: number }

async function seed(): Promise<{ template: string; players: Player[] }> {
  const t = await createTestDb(URL_ENV, "erstress_tpl", { gameplay: true });
  const name = new URL((t.pool as unknown as { options: { connectionString: string } }).options.connectionString).pathname.slice(1);
  created.push(name);
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  const players: Player[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const id = `erasestress-walker-${String(i).padStart(3, "0")}`;
    await t.pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
    await t.pool.query("INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES ($1, $2, 'supabase', $3)", [randomUUID(), id, `sub-${id}`]);
    const heavy = rnd() < 0.15;
    const start = Math.floor(rnd() * (CELLS.length - 30));
    players.push({ id, zone: CELLS.slice(start, start + 30), activity: heavy ? 0.95 : 0.35 + rnd() * 0.4, heavy, sessions: 0 });
  }
  const move = async (p: Player, day: number, k: number) => {
    const size = p.heavy ? 6 + Math.floor(rnd() * 7) : 2 + Math.floor(rnd() * 6);
    const units = new Set<string>();
    while (units.size < size) units.add(rnd() < 0.2 ? pick(HOT) : pick(p.zone));
    const sid = `s${day - D}-${k}`;
    const endMs = at(day, 7 + rnd() * 12);
    const list = [...units];
    await t.pool.query(
      `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
       VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, list)})`,
      [randomUUID(), p.id, sid, list, endMs - 1_800_000, endMs, endMs + 60_000]);
    clock = Math.max(clock, endMs + 60_000);
    await svc.applySession(p.id, sid);
    p.sessions++;
  };
  const clubIds = Array.from({ length: 10 }, (_, i) => `erasestress-club-${i}`);
  clock = at(D, 6);
  for (let i = 0; i < clubIds.length; i++) await svc.createClub(players[i]!.id, clubIds[i]!, `Erase stress club ${i}`);
  for (const p of players.slice(10)) if (rnd() < 0.6) await svc.joinClub(p.id, pick(clubIds));
  for (let d = 0; d < DAYS; d++) {
    const day = D + d;
    clock = at(day, 6);
    for (const p of players) {
      if (rnd() > p.activity) continue;
      const n = p.heavy ? 2 : rnd() < 0.3 ? 2 : 1;
      for (let k = 0; k < n; k++) await move(p, day, k);
    }
  }
  clock = dayCloseMs(RULES, D + SETTLED_DAYS - 1) + 60_000;
  for (let d = 0; d < SETTLED_DAYS; d++) await svc.settleDay(D + d);
  await t.pool.query("ANALYZE");
  await t.pool.end();
  return { template: name, players };
}

async function assertThrowawayCluster(): Promise<void> {
  const rows = await q(admin, "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1') AND datname NOT LIKE 'erstress\\_%' ORDER BY 1");
  if (rows.length) {
    console.error(`Refusing: the cluster has other databases (${rows.map((r) => r.datname).join(", ")}). Throwaway cluster only.`);
    await admin.end();
    process.exit(2);
  }
}

function logSize(): number { if (!SERVER_LOG) return 0; try { return statSync(SERVER_LOG).size; } catch { return 0; } }
function logSlice(from: number): string {
  if (!SERVER_LOG) return "";
  try {
    const size = statSync(SERVER_LOG).size; const len = Math.max(0, size - from);
    const buf = Buffer.alloc(len); const fd = openSync(SERVER_LOG, "r"); readSync(fd, buf, 0, len, from); closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}
const countLines = (text: string, re: RegExp) => text.split("\n").filter((l) => re.test(l)).length;

interface Req { id: string; tReq: number; initMs: number; outcome: string; http: number; clientTimeout: boolean; jobId?: string; tDone?: number }

async function runRepeat(template: string, players: Player[], repeat: number) {
  const name = `erstress_r${repeat}_${randomBytes(4).toString("hex")}`;
  created.push(name);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  const pool = new pg.Pool({ connectionString: dbUrl(name), max: POOL, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000 });
  pool.on("error", () => undefined);
  const mon = new pg.Pool({ connectionString: dbUrl(name), max: 2 });
  mon.on("error", () => undefined);
  const db = drizzle(pool) as unknown as Db;
  const S0 = dayCloseMs(RULES, D + DAYS - 1) + 60_000;
  let w0 = performance.now();
  const simNow = () => S0 + Math.floor(((performance.now() - w0) / DAY_WALL_MS) * DAY_MS);
  const svc = new GameplayService({ db, rules: RULES, now: simNow });
  const r2 = (() => { let x = (SEED * 7919 + repeat) >>> 0 || 1; return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const order = [...players].map((p) => ({ p, k: r2() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const settledBefore = Number((await q(mon, "SELECT count(*)::int AS n FROM gameplay_day_settlements"))[0]!.n);
  const dl0 = Number((await q(admin, "SELECT deadlocks FROM pg_stat_database WHERE datname=$1", [name]))[0]?.deadlocks ?? 0);
  const log0 = logSize();

  const store = MODE === "async"
    ? deletion.createDrizzleAccountDeletionStore(db, { queue: { onAccepted: () => kickAll() } } as never)
    : deletion.createDrizzleAccountDeletionStore(db);
  const workers: { drain: (o?: { maxJobs?: number; budgetMs?: number }) => Promise<number>; kick: () => void; idle: () => Promise<void> }[] = [];
  const requests: Req[] = [];
  const byJob = new Map<string, Req>();
  const jobEvents: Record<string, number> = {};
  function kickAll() { for (const w of workers) w.kick(); }
  if (MODE === "async") {
    const mod = await import("../src/identity/erasureWorker.js");
    for (let i = 0; i < WORKERS; i++) {
      workers.push(mod.createErasureWorker({
        db, store: store as never, log: { info: () => undefined, warn: () => undefined },
        onEvent: (e: { kind: string; jobId: string; outcome?: string }) => {
          const key = e.kind === "retry" || e.kind === "needs_attention" ? `${e.kind}:${e.outcome}` : e.kind;
          jobEvents[key] = (jobEvents[key] ?? 0) + 1;
          if (e.kind === "completed") { const r = byJob.get(e.jobId); if (r) r.tDone = performance.now() - w0; }
        },
      }));
    }
  }

  const requested = new Set<string>();
  const live = () => players.filter((p) => !requested.has(p.id));
  let stopLoad = false;
  const pushOutcomes: Record<string, number> = {};
  const closeOutcomes: Record<string, number> = {};
  const lockSamples: number[] = [];
  const timeline: { t: number; locks: number; pending?: number; running?: number; attention?: number; completed?: number }[] = [];

  const pusher = async (i: number) => {
    let k = 0;
    while (!stopLoad) {
      const cands = live();
      if (!cands.length) { await sleep(200); continue; }
      const p = pick(cands, r2);
      const T = simNow();
      const endMs = T - 180_000;
      const units = new Set<string>();
      const size = 2 + Math.floor(r2() * 6);
      while (units.size < size) units.add(r2() < 0.2 ? pick(HOT, r2) : pick(p.zone, r2));
      const list = [...units];
      const sid = `live-${repeat}-${i}-${k++}`;
      try {
        await pool.query(
          `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
           VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, list)})`,
          [randomUUID(), p.id, sid, list, endMs - 1_800_000, endMs, endMs + 60_000]);
        await svc.applySession(p.id, sid);
        pushOutcomes.ok = (pushOutcomes.ok ?? 0) + 1;
      } catch (e) {
        const c = String(codeOf(e)); pushOutcomes[c] = (pushOutcomes[c] ?? 0) + 1;
      }
    }
  };
  const closer = async () => {
    while (!stopLoad) {
      try { const n = await svc.settleDueDays(); closeOutcomes.ok_runs = (closeOutcomes.ok_runs ?? 0) + 1; closeOutcomes.days = (closeOutcomes.days ?? 0) + n; }
      catch (e) { const c = String(codeOf(e)); closeOutcomes[c] = (closeOutcomes[c] ?? 0) + 1; }
      await sleep(500);
    }
  };
  const sampler = async () => {
    while (!stopLoad) {
      try {
        const [l] = await q(mon, "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
        lockSamples.push(Number(l!.n));
        const row: (typeof timeline)[number] = { t: +((performance.now() - w0) / 1000).toFixed(2), locks: Number(l!.n) };
        if (MODE === "async" && timeline.length % 4 === 0) {
          const [c] = await q(mon, `SELECT count(*) FILTER (WHERE state='pending')::int AS p, count(*) FILTER (WHERE state='running')::int AS r,
            count(*) FILTER (WHERE state='needs_attention')::int AS a, count(*) FILTER (WHERE state='completed')::int AS c FROM gameplay_erasure_jobs`);
          Object.assign(row, { pending: c!.p, running: c!.r, attention: c!.a, completed: c!.c });
        }
        timeline.push(row);
      } catch { /* sampling is best effort */ }
      await sleep(250);
    }
  };
  let next = 0;
  const eraser = async () => {
    while (next < order.length) {
      const p = order[next++]!;
      requested.add(p.id);
      const tReq = performance.now() - w0;
      const t0 = performance.now();
      const r: Req = { id: p.id, tReq, initMs: 0, outcome: "", http: 0, clientTimeout: false };
      try {
        if (MODE === "async") {
          const out = await (store as unknown as { request(u: string): Promise<{ status: string; requestId?: string }> }).request(p.id);
          r.outcome = out.status; r.http = out.status === "pending" ? 202 : 200;
          if (out.requestId) { r.jobId = out.requestId; byJob.set(out.requestId, r); }
          if (out.status === "completed") r.tDone = performance.now() - w0;
        } else {
          await store.erase(p.id);
          r.outcome = "completed"; r.http = 200; r.tDone = performance.now() - w0;
        }
      } catch (e) {
        r.outcome = String(codeOf(e));
        r.http = r.outcome.startsWith("busy:") ? 503 : 500;
      }
      r.initMs = performance.now() - t0;
      r.clientTimeout = r.initMs > CLIENT_TIMEOUT_MS;
      requests.push(r);
    }
  };

  w0 = performance.now();
  const load = [...Array.from({ length: PUSHERS }, (_, i) => pusher(i)), ...Array.from({ length: CLOSERS }, () => closer()), sampler()];
  const ticker = MODE === "async" ? setInterval(kickAll, 1000) : null;
  await Promise.all(Array.from({ length: ERASERS }, () => eraser()));
  const eraseEndS = (performance.now() - w0) / 1000;
  const outstandingAtEraseEnd = MODE === "async"
    ? Number((await q(mon, "SELECT count(*)::int AS n FROM gameplay_erasure_jobs WHERE state <> 'completed'"))[0]!.n)
    : requests.filter((r) => r.outcome !== "completed").length;
  if (MODE === "async") {
    const deadline = performance.now() + DRAIN_CAP_S * 1000;
    while (performance.now() < deadline) {
      const [o] = await q(mon, "SELECT count(*)::int AS n FROM gameplay_erasure_jobs WHERE state IN ('pending','running')");
      if (Number(o!.n) === 0) break;
      await sleep(250);
    }
  }
  const drainEndS = (performance.now() - w0) / 1000;
  stopLoad = true;
  if (ticker) clearInterval(ticker);
  await Promise.all(load);
  for (const w of workers) await w.idle();

  // ── after ──
  const jobs = MODE === "async" ? await q(mon, `SELECT state, last_outcome, attempts FROM gameplay_erasure_jobs`) : [];
  const usersLeft = Number((await q(mon, "SELECT count(*)::int AS n FROM users WHERE id = ANY($1)", [players.map((p) => p.id)]))[0]!.n);
  const deletingLeft = Number((await q(mon, "SELECT count(*)::int AS n FROM users WHERE status = 'deleting'"))[0]!.n);
  const settledAfter = Number((await q(mon, "SELECT count(*)::int AS n FROM gameplay_day_settlements"))[0]!.n);
  const dl1 = Number((await q(admin, "SELECT deadlocks FROM pg_stat_database WHERE datname=$1", [name]))[0]?.deadlocks ?? 0);
  const stillUsers = new Set((await q(mon, "SELECT id FROM users WHERE id = ANY($1)", [players.map((p) => p.id)])).map((r) => r.id as string));
  const goneIds = players.map((p) => p.id).filter((id) => !stillUsers.has(id));
  const naming: Record<string, number> = {};
  const tabs = await q(mon, `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE (schemaname='public' AND (tablename LIKE 'gameplay\\_%' OR tablename IN ('auth_identities','auth_sessions','movement_verifications','security_audit_events'))) OR schemaname='gameplay_partitions'`);
  for (const { t } of tabs) {
    const n = Number((await q(mon, `SELECT count(*)::int AS n FROM ${t} x WHERE x::text LIKE ANY($1::text[])`, [goneIds.map((id) => `%${id}%`)]))[0]!.n);
    if (n) naming[t as string] = n;
  }
  const vsvc = new GameplayService({ db: drizzle(mon) as unknown as Db, rules: RULES, now: simNow });
  const settledDays = (await q(mon, "SELECT day FROM gameplay_day_settlements ORDER BY day")).map((r) => Number(r.day));
  const verify: Record<string, number> = {};
  for (const d of settledDays) { try { await vsvc.verifyDay(d); verify.ok = (verify.ok ?? 0) + 1; } catch (e) { const c = String(codeOf(e)); verify[c] = (verify[c] ?? 0) + 1; } }
  const halted = (await vsvc.settlementStatus()).halted;
  const logText = logSlice(log0);
  await pool.end(); await mon.end();

  const init = requests.map((r) => r.initMs);
  const done = requests.filter((r) => r.tDone !== undefined).map((r) => r.tDone! - r.tReq);
  const outcomes: Record<string, number> = {};
  for (const r of requests) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const http: Record<string, number> = {};
  for (const r of requests) http[String(r.http)] = (http[String(r.http)] ?? 0) + 1;
  // completion over time: 10 s buckets by request time
  const buckets: { from_s: number; requested: number; completed: number; completion_p50_ms: number | null; completion_p95_ms: number | null; max_ms: number | null }[] = [];
  for (let b = 0; b * 10 < Math.ceil(eraseEndS + 0.001); b++) {
    const inB = requests.filter((r) => r.tReq >= b * 10_000 && r.tReq < (b + 1) * 10_000);
    const c = inB.filter((r) => r.tDone !== undefined).map((r) => r.tDone! - r.tReq);
    buckets.push({ from_s: b * 10, requested: inB.length, completed: c.length, completion_p50_ms: pct(c, 0.5), completion_p95_ms: pct(c, 0.95), max_ms: c.length ? Math.round(Math.max(...c)) : null });
  }
  const jobStates: Record<string, number> = {};
  let retries = 0;
  for (const j of jobs) { const k = `${j.state}${j.last_outcome && j.state !== "completed" ? `:${j.last_outcome}` : ""}`; jobStates[k] = (jobStates[k] ?? 0) + 1; retries += Math.max(0, Number(j.attempts) - 1); }
  return {
    repeat, mode: MODE, requests: requests.length, eraseWallS: +eraseEndS.toFixed(1), drainWallS: +drainEndS.toFixed(1),
    initiation_ms: dist(init), completion_ms: dist(done), completed: done.length,
    clientTimeouts10s: requests.filter((r) => r.clientTimeout).length,
    outcomes, http, outstandingAtEraseEnd, outstandingAtDrainEnd: MODE === "async" ? jobs.filter((j) => j.state !== "completed").length : requests.filter((r) => r.outcome !== "completed").length,
    usersLeftOfThe200: usersLeft, deletingLeft, jobStates, jobRetries: retries, jobEvents,
    lockWaiters: { samples: lockSamples.length, max: lockSamples.length ? Math.max(...lockSamples) : 0, mean: +(lockSamples.reduce((a, b) => a + b, 0) / (lockSamples.length || 1)).toFixed(2), lockWaitBackendSeconds: +(lockSamples.reduce((a, b) => a + b, 0) * 0.25).toFixed(1) },
    serverLog: SERVER_LOG ? {
      lockWaitLines: countLines(logText, /still waiting for/), deadlockDetected: countLines(logText, /deadlock detected/),
      serializationFailures: countLines(logText, /could not serialize access/), statementTimeouts: countLines(logText, /canceling statement due to statement timeout/),
      lockTimeouts: countLines(logText, /canceling statement due to lock timeout/),
    } : null,
    deadlocksPgStat: dl1 - dl0,
    settlements: { before: settledBefore, after: settledAfter, completedDuringRun: settledAfter - settledBefore, closeOutcomes },
    pushOutcomes, verifyDay: verify, halted, tablesNamingAnErasedPlayer: naming, erasedIdsChecked: goneIds.length,
    completionOverTime: buckets, timeline: timeline.filter((_, i) => i % 8 === 0),
  };
}

async function cleanup(): Promise<void> {
  const names = [...new Set(created)];
  if (KEEP) { console.log(`--keep: kept ${names.join(", ")}`); return; }
  let n = 0;
  for (const name of names) { try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); n++; } catch (e) { console.error(`could not drop ${name}: ${String(e).slice(0, 100)}`); } }
  console.log(`dropped ${n} of ${names.length} database(s)`);
}

async function main() {
  const t0 = Date.now();
  await assertThrowawayCluster();
  const ver = (await q(admin, "SHOW server_version"))[0]!.server_version;
  const settings = Object.fromEntries((await q(admin, "SELECT name, setting FROM pg_settings WHERE name IN ('max_connections','shared_buffers','deadlock_timeout','log_lock_waits','autovacuum','max_worker_processes')")).map((r) => [r.name, r.setting]));
  let sha = "unknown"; try { sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
  let dirty = ""; try { dirty = execSync("git status --porcelain -- src", { encoding: "utf8" }).trim() ? " (src has uncommitted changes)" : ""; } catch { /* ignore */ }
  const cpus = (await import("node:os")).cpus().length;
  console.log(`LOCAL, SYNTHETIC, NOT A CAPACITY FIGURE. mode=${MODE} sha=${sha}${dirty} players=${PLAYERS} seed=${SEED} erasers=${ERASERS} pushers=${PUSHERS} closers=${CLOSERS} dayMs=${DAY_WALL_MS} pool=${POOL} workers=${WORKERS}`);
  try {
    const { template, players } = await seed();
    console.log(`seeded ${template} in ${((Date.now() - t0) / 1000).toFixed(1)} s, sessions ${players.reduce((a, p) => a + p.sessions, 0)}`);
    const results = [];
    for (let r = 1; r <= REPEATS; r++) {
      const res = await runRepeat(template, players, r);
      results.push(res);
      console.log(`repeat ${r}: init`, res.initiation_ms, "completion", res.completion_ms, "http", res.http, "outcomes", res.outcomes,
        `clientTimeouts ${res.clientTimeouts10s} outstanding ${res.outstandingAtEraseEnd}->${res.outstandingAtDrainEnd} settlements +${res.settlements.completedDuringRun}`,
        "close", res.settlements.closeOutcomes, "deadlocks", res.deadlocksPgStat, "log", res.serverLog, "verify", res.verifyDay, "halted", res.halted, "naming", res.tablesNamingAnErasedPlayer);
    }
    const out = { label: "LOCAL, SYNTHETIC, NOT A CAPACITY FIGURE", sha: sha + dirty, mode: MODE, postgres: ver, settings, cpus, players: PLAYERS, seed: SEED, erasers: ERASERS, pushers: PUSHERS, closers: CLOSERS, dayWallMs: DAY_WALL_MS,
      pool: { max: POOL, statement_timeout_ms: 10000, query_timeout_ms: 10000, connectionTimeoutMillis: 5000 }, clientTimeoutMs: CLIENT_TIMEOUT_MS, workers: WORKERS, drainCapS: DRAIN_CAP_S, results, totalSeconds: (Date.now() - t0) / 1000 };
    if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
  } finally {
    await cleanup();
    await admin.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
