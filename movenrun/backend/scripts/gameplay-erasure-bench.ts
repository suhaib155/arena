/**
 * Gameplay account-erasure cost bench, 200 synthetic players. LOCAL, SINGLE RUN, not a capacity figure.
 *
 *   MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:55432/postgres \
 *     node --import tsx scripts/gameplay-erasure-bench.ts --out /tmp/erasure.json [--players 200] [--seed 29]
 *
 * Seeds one template database (committed chain 0000-0010 plus the PROPOSED 0011) through the real GameplayService
 * (applySession, settleDay, createClub, joinClub), then clones the template for every phase so each phase starts
 * from identical bytes:
 *   single      erase one player (the one with most applied sessions)
 *   seq10       erase 10 players sequentially
 *   seq200      erase all players sequentially
 *   conc10      erase 10 players at once while settlement of the still-unsettled closed days runs
 *   settle-only control for conc10: the same settlement with no erasures (to separate settlement WAL from erasure WAL)
 *
 * Erasure runs through the real store (createDrizzleAccountDeletionStore). Safety: the URL must be this machine;
 * the cluster should be a throwaway one (scripts/gameplay-bench-cluster.sh) with autovacuum off so dead-tuple
 * deltas are not reclaimed mid-run. WAL is a cluster-wide LSN difference, so anything else writing to the
 * cluster is in it. Synthetic users and cells only.
 */
import { writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { cellToChildren, gridDisk, latLngToCell } from "h3-js";
import { cellToInt8 } from "../src/gameplay/cells.js";
import type { Db } from "../src/db/client.js";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, dayCloseMs, type GameplayRules } from "../src/gameplay/rules.js";
import { GameplayService } from "../src/gameplay/service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "../src/gameplay/sealFixtures.js";
import { createTestDb } from "../src/gameplay/pgTestDb.js";
import { createDrizzleAccountDeletionStore } from "../src/identity/accountDeletion.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const URL_ENV = process.env.MOVENRUN_BENCH_DATABASE_URL ?? "";
if (!URL_ENV) { console.error("MOVENRUN_BENCH_DATABASE_URL is not set (a local, disposable PostgreSQL superuser URL)."); process.exit(2); }
{
  const u = new URL(URL_ENV);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!(["localhost", "127.0.0.1", "::1"].includes(host))) { console.error(`Refusing ${host || "(empty host)"}: local PostgreSQL only.`); process.exit(2); }
}
const PLAYERS = Number(arg("players") ?? 200);
const SEED = Number(arg("seed") ?? 29);
const OUT = arg("out");
/** 1001 (default, immediate takeover) or 1002 (two-day challenge, resolution-10 session paths: the only rule set that writes challenges and paths). */
const RULESET = arg("rules") ?? "1001";
if (RULESET !== "1001" && RULESET !== "1002") { console.error("--rules must be 1001 or 1002"); process.exit(2); }
const BASE = RULESET === "1002" ? SIM_PILOT_2_PROPOSAL : PILOT_PROPOSAL;

/* deterministic PRNG so the seeded world is the same on every run with the same seed */
let s = SEED >>> 0 || 1;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...BASE, holding: { ...BASE.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const DAYS = 6;                 // simulated days D .. D+5
const SETTLED_DAYS = 3;         // D .. D+2 are settled in the template; D+3 .. D+5 are closed but unsettled
const CELLS = RULESET === "1002"
  ? gridDisk(latLngToCell(51.52, -0.1, 9), 5).sort().flatMap((z) => cellToChildren(z, 10).sort()) // 637 res-10 units
  : gridDisk(latLngToCell(51.5007, -0.1246, 8), 12).sort(); // 469 res-8 cells
const HOT = CELLS.slice(0, RULESET === "1002" ? 60 : 40); // a shared hotspot every player sometimes crosses (contested cells, challenges)

const q = (pool: pg.Pool, text: string, values: unknown[] = []) => pool.query(text, values).then((r) => r.rows);
const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]! : NaN; };
const summary = (xs: number[]) => ({ n: xs.length, p50_ms: +pct(xs, 0.5).toFixed(1), p95_ms: +pct(xs, 0.95).toFixed(1), max_ms: +Math.max(...xs).toFixed(1), mean_ms: +(xs.reduce((a, b) => a + b, 0) / (xs.length || 1)).toFixed(1) });

const admin = new pg.Pool({ connectionString: URL_ENV, max: 4 });
admin.on("error", () => undefined);

interface Clone { name: string; pool: pg.Pool; db: Db; svc: GameplayService; setClock(ms: number): void; close(): Promise<void> }
let clockMs = at(D + DAYS, 3); // after the close of D+5 for phases

function open(name: string, now: () => number): Clone {
  const u = new URL(URL_ENV); u.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: u.toString(), max: 40 });
  pool.on("error", () => undefined);
  const db = drizzle(pool) as unknown as Db;
  const svc = new GameplayService({ db, rules: RULES, now });
  return { name, pool, db, svc, setClock: (ms) => { clockMs = ms; }, close: () => pool.end() };
}

/* ── world ─────────────────────────────────────────────────────────────── */

interface Player { id: string; zone: string[]; activity: number; heavy: boolean; sessions: number }

async function seed(): Promise<{ template: string; players: Player[]; seedStats: Record<string, number> }> {
  const t = await createTestDb(URL_ENV, "erase_tpl", { gameplay: true });
  const name = new URL((t.pool as unknown as { options: { connectionString: string } }).options.connectionString).pathname.slice(1);
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  const players: Player[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const id = `erasebench-walker-${String(i).padStart(3, "0")}`;
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
    const id = randomUUID();
    const list = [...units];
    await t.pool.query(
      `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
       VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, list)})`,
      [id, p.id, sid, RULESET === "1002" ? [] : list, endMs - 1_800_000, endMs, endMs + 60_000]);
    if (RULESET === "1002") {
      await t.pool.query(
        `INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
         VALUES ($1, 1, 10, $2::bigint[], $3::varbit, 0, false)`,
        [id, list.map(cellToInt8), list.map(() => "0").join("")]);
    }
    clock = Math.max(clock, endMs + 60_000);
    await svc.applySession(p.id, sid);
    p.sessions++;
  };
  // clubs: 10 clubs, about 60% of players join one
  const clubIds = Array.from({ length: 10 }, (_, i) => `erasebench-club-${i}`);
  clock = at(D, 6);
  for (let i = 0; i < clubIds.length; i++) await svc.createClub(players[i]!.id, clubIds[i]!, `Erase bench club ${i}`);
  for (const p of players.slice(10)) if (rnd() < 0.6) await svc.joinClub(p.id, pick(clubIds));
  for (let d = 0; d < DAYS; d++) {
    const day = D + d;
    clock = at(day, 6);
    for (const p of players) {
      if (rnd() > p.activity) continue;
      const n = p.heavy ? 2 : rnd() < 0.3 ? 2 : 1;
      for (let k = 0; k < n; k++) await move(p, day, k);
    }
    if (d < DAYS - 1) clock = at(day + 1, 6);
  }
  // settle D .. D+2 with the clock past D+2's close but sessions of D+3.. already stored (they are only applied, not settled)
  clock = dayCloseMs(RULES, D + SETTLED_DAYS - 1) + 60_000;
  for (let d = 0; d < SETTLED_DAYS; d++) await svc.settleDay(D + d);
  await t.pool.query("ANALYZE");
  const seedStats = Object.fromEntries(Object.entries({
    sessions: players.reduce((a, p) => a + p.sessions, 0),
    heavyPlayers: players.filter((p) => p.heavy).length,
  }));
  await t.pool.end();
  await admin.query("SELECT pg_sleep(0.2)");
  return { template: name, players, seedStats };
}

/* ── measuring ─────────────────────────────────────────────────────────── */

/** Every table of interest, partitions folded into their parent. */
async function tableList(pool: pg.Pool): Promise<string[]> {
  const r = await q(pool, `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public' AND NOT c.relispartition
      AND (c.relname LIKE 'gameplay\\_%' OR c.relname IN ('users','auth_identities','auth_sessions','movement_verifications','security_audit_events','pending_auth_user_deletions','email_otp_challenges','wallets','wallet_link_challenges'))
    ORDER BY 1`);
  return r.map((x) => x.t as string);
}
async function rowCounts(pool: pg.Pool, tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await q(pool, `SELECT count(*)::bigint AS n FROM public."${t}"`))[0]!.n);
  return out;
}
/** Stats per parent table (partition children summed). Needs the writers' backends gone (stats flush on idle/exit). */
async function tableStats(pool: pg.Pool): Promise<Record<string, { ins: number; upd: number; del: number; dead: number; live: number; av: number }>> {
  const r = await q(pool, `SELECT coalesce(p.relname, c.relname) AS t,
      sum(st.n_tup_ins)::bigint AS ins, sum(st.n_tup_upd)::bigint AS upd, sum(st.n_tup_del)::bigint AS del,
      sum(st.n_dead_tup)::bigint AS dead, sum(st.n_live_tup)::bigint AS live, sum(st.autovacuum_count)::bigint AS av
    FROM pg_stat_user_tables st JOIN pg_class c ON c.oid = st.relid
    LEFT JOIN pg_inherits i ON i.inhrelid = c.oid LEFT JOIN pg_class p ON p.oid = i.inhparent
    GROUP BY 1`);
  return Object.fromEntries(r.map((x) => [x.t as string, { ins: +x.ins, upd: +x.upd, del: +x.del, dead: +x.dead, live: +x.live, av: +x.av }]));
}
const lsn = async () => (await q(admin, "SELECT pg_current_wal_lsn()::text AS l"))[0]!.l as string;
const lsnDiff = async (a: string, b: string) => Number((await q(admin, "SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::bigint AS d", [b, a]))[0]!.d);

interface PhaseResult {
  phase: string; erased: number; ids: string[]; errors: string[]; wallMs: number;
  perErasure: ReturnType<typeof summary>; walBytesClusterWide: number;
  rows: Record<string, { before: number; after: number; net: number }>;
  stats: Record<string, { ins: number; upd: number; del: number; dead_delta: number; autovacuum_delta: number }>;
  deadlocksDb: number; erasureResultCounts: Record<string, number>;
  tombstoneState: Record<string, unknown>; settlement?: Record<string, unknown>;
}

async function cloneOf(template: string, phase: string): Promise<string> {
  const name = `erase_${phase}_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  return name;
}

async function tombstoneState(pool: pg.Pool, namingPatterns: string[]): Promise<Record<string, unknown>> {
  const one = async (sql: string) => (await q(pool, sql))[0] ?? {};
  const named: Record<string, number> = {};
  const tabs = await q(pool, `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE (schemaname='public' AND tablename LIKE 'gameplay\\_%') OR schemaname='gameplay_partitions' ORDER BY 1`);
  for (const { t } of tabs) { const n = Number((await q(pool, `SELECT count(*)::int AS n FROM ${t} x WHERE x::text LIKE ANY($1::text[])`, [namingPatterns]))[0]!.n); if (n) named[t as string] = n; }
  return {
    erasure_days_rows: (await one("SELECT count(*)::int AS n FROM gameplay_erasure_days")).n,
    erasure_days_tombstones_total: (await one("SELECT coalesce(sum(tombstones),0)::int AS n FROM gameplay_erasure_days")).n,
    credit_lines_erased_rows: (await one("SELECT count(*)::int AS n FROM gameplay_credit_lines WHERE tombstone_id IS NOT NULL")).n,
    credit_lines_total: (await one("SELECT count(*)::int AS n FROM gameplay_credit_lines")).n,
    erasure_fence: await one("SELECT * FROM gameplay_erasure_fence"),
    users_left: (await one("SELECT count(*)::int AS n FROM users")).n,
    audit_account_deleted: (await one("SELECT count(*)::int AS n FROM security_audit_events WHERE event_type='account_deleted'")).n,
    tablesStillNamingAnErasedPlayer: named,
  };
}

async function runPhase(template: string, phase: "single" | "seq10" | "seq200" | "conc10" | "settle-only", all: Player[]): Promise<PhaseResult> {
  const name = await cloneOf(template, phase);
  clockMs = dayCloseMs(RULES, D + DAYS - 1) + 60_000;
  let c = open(name, () => clockMs);
  const tables = await tableList(c.pool);
  const before = await rowCounts(c.pool, tables);
  await c.close();
  c = open(name, () => clockMs);
  // pick erasure targets: heaviest first for "single", spread across the ranking for the rest
  const ranked = [...all].sort((a, b) => b.sessions - a.sessions);
  const targets = phase === "single" ? [ranked[0]!] : phase === "seq10" ? ranked.filter((_, i) => i % Math.floor(all.length / 10) === 0).slice(0, 10)
    : phase === "conc10" ? ranked.filter((_, i) => i % Math.floor(all.length / 10) === 3).slice(0, 10) : phase === "settle-only" ? [] : [...all];
  const statsBefore = await (async () => { const p = new pg.Pool({ connectionString: (() => { const u = new URL(URL_ENV); u.pathname = `/${name}`; return u.toString(); })(), max: 1 }); const x = await tableStats(p); await p.end(); return x; })();
  const dl0 = Number((await q(admin, "SELECT deadlocks FROM pg_stat_database WHERE datname=$1", [name]))[0]?.deadlocks ?? 0);
  await admin.query("CHECKPOINT");
  const store = createDrizzleAccountDeletionStore(c.db);
  const times: number[] = []; const errors: string[] = []; const counts: Record<string, number> = {};
  const eraseOne = async (p: Player) => {
    const t0 = performance.now();
    try {
      const res = await store.erase(p.id);
      for (const [k, v] of Object.entries(res)) if (typeof v === "number") counts[k] = (counts[k] ?? 0) + v;
    } catch (e) { errors.push(`${p.id}: ${(e as { code?: string }).code ?? ""} ${String(e).slice(0, 160)}`); }
    times.push(performance.now() - t0);
  };
  let settlement: Record<string, unknown> | undefined;
  const settle = async () => {
    const t0 = performance.now(); const perDay: { day: number; ms: number; err?: string }[] = [];
    for (let d = D + SETTLED_DAYS; d < D + DAYS; d++) {
      const t = performance.now();
      try { await c.svc.settleDay(d); perDay.push({ day: d, ms: +(performance.now() - t).toFixed(1) }); }
      catch (e) { perDay.push({ day: d, ms: +(performance.now() - t).toFixed(1), err: `${(e as { code?: string }).code ?? ""} ${String(e).slice(0, 120)}` }); }
    }
    settlement = { totalMs: +(performance.now() - t0).toFixed(1), perDay };
  };
  const lsn0 = await lsn();
  const w0 = performance.now();
  if (phase === "conc10") {
    // settlement and the ten erasures start in the same tick; settlement is also kicked off a second time part-way
    // through so a day close lands while erasures are queued behind the fence.
    await Promise.all([settle(), ...targets.map(eraseOne)]);
  } else if (phase === "settle-only") {
    await settle();
  } else {
    for (const p of targets) await eraseOne(p);
  }
  const wallMs = performance.now() - w0;
  const lsn1 = await lsn();
  let retried: Record<string, unknown> | undefined;
  if (phase === "conc10") {
    // the maintenance loop's next tick: whatever the burst left unsettled is settled by a plain retry (outside the WAL window)
    const t = performance.now(); const res: string[] = [];
    for (let d = D + SETTLED_DAYS; d < D + DAYS; d++) { try { await c.svc.settleDay(d); res.push(`D+${d - D} ok`); } catch (e) { res.push(`D+${d - D} ${(e as { code?: string }).code ?? ""} ${String(e).slice(0, 80)}`); } }
    retried = { ms: +(performance.now() - t).toFixed(1), res };
  }
  const walBytes = await lsnDiff(lsn0, lsn1);
  await c.close(); // backends exit: pending stats flush
  await admin.query("SELECT pg_sleep(1.5)");
  const u = new URL(URL_ENV); u.pathname = `/${name}`;
  const reader = new pg.Pool({ connectionString: u.toString(), max: 2 });
  const after = await rowCounts(reader, tables);
  const statsAfter = await tableStats(reader);
  const dl1 = Number((await q(admin, "SELECT deadlocks FROM pg_stat_database WHERE datname=$1", [name]))[0]?.deadlocks ?? 0);
  const ts = await tombstoneState(reader, targets.map((p) => `%${p.id}%`));
  // integrity: every settled day must still verify after the erasures
  const verify: Record<string, string> = {};
  const vsvc = new GameplayService({ db: drizzle(reader) as unknown as Db, rules: RULES, now: () => clockMs });
  for (let d = D; d < D + DAYS; d++) { try { await vsvc.verifyDay(d); verify[`D+${d - D}`] = "ok"; } catch (e) { verify[`D+${d - D}`] = ((e as { code?: string; message?: string }).code ?? "") + " " + String((e as Error).message).slice(0, 80); } }
  (ts as Record<string, unknown>).verifyDayAfter = verify;
  (ts as Record<string, unknown>).settlementStatus = await vsvc.settlementStatus();
  await reader.end();
  const rows: PhaseResult["rows"] = {};
  for (const t of tables) rows[t] = { before: before[t]!, after: after[t]!, net: after[t]! - before[t]! };
  const stats: PhaseResult["stats"] = {};
  for (const t of Object.keys(statsAfter)) {
    const a = statsAfter[t]!, b = statsBefore[t] ?? { ins: 0, upd: 0, del: 0, dead: 0, live: 0, av: 0 };
    stats[t] = { ins: a.ins - b.ins, upd: a.upd - b.upd, del: a.del - b.del, dead_delta: a.dead - b.dead, autovacuum_delta: a.av - b.av };
  }
  return { phase, erased: targets.length - errors.length, ids: targets.map((p) => p.id).slice(0, 3), errors, wallMs: +wallMs.toFixed(1), perErasure: times.length ? summary(times) : (null as never), walBytesClusterWide: walBytes, rows, stats, deadlocksDb: dl1 - dl0, erasureResultCounts: counts, tombstoneState: ts, settlement: settlement ? { ...settlement, retriedAfterBurst: retried } : undefined };
}

async function main() {
  const t0 = Date.now();
  console.log(`LOCAL, SINGLE RUN, NOT A CAPACITY FIGURE. players=${PLAYERS} seed=${SEED}`);
  const ver = (await q(admin, "SHOW server_version"))[0]!.server_version;
  const av = (await q(admin, "SHOW autovacuum"))[0]!.autovacuum;
  const { template, players, seedStats } = await seed();
  console.log(`seeded template ${template} in ${((Date.now() - t0) / 1000).toFixed(1)} s`, seedStats);
  const tplPool = new pg.Pool({ connectionString: (() => { const u = new URL(URL_ENV); u.pathname = `/${template}`; return u.toString(); })(), max: 2 });
  const tables = await tableList(tplPool);
  const tplRows = await rowCounts(tplPool, tables);
  await tplPool.end();
  const phases: PhaseResult[] = [];
  for (const ph of ["single", "seq10", "seq200", "settle-only", "conc10"] as const) {
    const r = await runPhase(template, ph, players);
    phases.push(r);
    console.log(`${ph}: erased ${r.erased}/${ph === "settle-only" ? 0 : r.erased + r.errors.length} wall ${r.wallMs} ms per-erasure`, r.perErasure, `WAL ${r.walBytesClusterWide} B deadlocks(db) ${r.deadlocksDb} errors ${r.errors.length}`);
  }
  const result = { rules: RULESET, label: "LOCAL, SINGLE RUN, NOT A CAPACITY FIGURE", postgres: ver, autovacuum: av, players: PLAYERS, seed: SEED, days: DAYS, settledInTemplate: SETTLED_DAYS, seedStats, templateRows: tplRows, phases, totalSeconds: (Date.now() - t0) / 1000 };
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log("done", ((Date.now() - t0) / 1000).toFixed(1), "s; template db kept:", template, "(drop with DROP DATABASE)");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
