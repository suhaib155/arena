/**
 * Gameplay storage bench (G3/G4). Measures what the PROPOSED migration 0011
 * costs on disk, on a disposable local PostgreSQL, by driving the real
 * GameplayService with synthetic players.
 *
 *   MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:55491/postgres \
 *     node --import tsx scripts/gameplay-storage-bench.ts --profile full \
 *       --out /path/bench.json --markdown /path/bench.md
 *
 * Options: --profile quick|full|capacity|integration|churn (default quick), --proposed <file> (default
 * drizzle-proposed/0011_gameplay_holdings.sql), --only <scenario name>,
 * --out <json>, --markdown <md>, --keep (do not drop the bench databases),
 * --from <json> (re-project a saved run without touching any database),
 * --service-root <backend dir> (run another checkout's GameplayService, rule
 * sets, migration chain and 0011 instead of this one's: how the old shape is
 * measured with the same harness), --baseline <json> (a saved run of the old
 * shape, for the old-versus-new tables).
 *
 * Safety: the URL must point at this machine (localhost, 127.0.0.1, ::1 or a
 * Unix socket). Anything else is refused before a connection is made. Each
 * scenario creates its own database and drops it afterwards.
 *
 * The schema is read at run time: the committed chain from
 * drizzle/meta/_journal.json, then the proposed file. Every relation the
 * proposed file creates is found by comparing the catalog before and after,
 * so a table added to 0011 later shows up in the report without editing this
 * script. Rows are written by GameplayService itself (applySession,
 * settleDueDays, createClub, joinClub), so the bytes measured are the bytes
 * the service writes. The "alternative" measurements at the end copy the
 * c6dc208 column layout into scratch tables; on revision 2 (where those
 * columns are gone) only the movement cell-list cost is measured there, and
 * revision 2's own measurements run instead: empty day partitions, the
 * takers lookup, erasure through the real store, DELETE+VACUUM against a
 * partition drop, and each settlement's temp-file spill.
 *
 * Query plans come from auto_explain (ANALYZE, BUFFERS) on a connection the
 * service uses, so they are the statements the service actually sends, with
 * its real parameters.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { latLngToCell, cellToParent, polygonToCells, gridDisk, cellArea, getResolution } from "h3-js";
import type { Db } from "../src/db/client.js";
import { DAY_MS, rulesetFor as localRulesetFor, type GameplayRules } from "../src/gameplay/rules.js";
import type { GameplayService as GameplayServiceT } from "../src/gameplay/service.js";
import { cellToInt8 } from "../src/gameplay/cells.js";
import { createDrizzleAccountDeletionStore } from "../src/identity/accountDeletion.js";
import {
  DEFAULT_THRESHOLDS, KEEP_EVERYTHING, KEEP_EVERYTHING_V2, MIB, PROPOSED_RETENTION, projectStorage, TTL_45_PER_PUSH_PROOF,
  type LoadProfile, type RetentionPolicy, type RowCosts,
} from "../src/gameplay/capacity.js";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── arguments and safety ──────────────────────────────────────────────── */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const URL_ENV = process.env.MOVENRUN_BENCH_DATABASE_URL ?? "";
if (!arg("from")) {
  if (!URL_ENV) {
    console.error("MOVENRUN_BENCH_DATABASE_URL is not set (a local, disposable PostgreSQL superuser URL).");
    process.exit(2);
  }
  const baseUrl = new URL(URL_ENV);
  const host = baseUrl.hostname.replace(/^\[|\]$/g, "");
  const socketHost = baseUrl.searchParams.get("host") ?? "";
  if (!(["localhost", "127.0.0.1", "::1"].includes(host) || (host === "" && socketHost.startsWith("/")))) {
    console.error(`Refusing ${baseUrl.hostname || "(empty host)"}: the bench only runs against a local, disposable PostgreSQL.`);
    process.exit(2);
  }
}
/** The backend whose service, rules, journal and 0011 are measured (default: this one). */
const BACKEND = arg("service-root") ?? HERE;
type ServiceCtor = new (deps: { db: Db; rules: GameplayRules; now?: () => number; unitBudget?: number | null }) => GameplayServiceT;
let GameplayService: ServiceCtor;
let GameplayError: new (...a: never[]) => Error & { code: string };
let rulesetFor: typeof localRulesetFor = localRulesetFor;
async function loadService(): Promise<void> {
  const svc = await import(pathToFileURL(join(BACKEND, "src/gameplay/service.ts")).href);
  const rules = await import(pathToFileURL(join(BACKEND, "src/gameplay/rules.ts")).href);
  GameplayService = svc.GameplayService;
  GameplayError = svc.GameplayError;
  rulesetFor = rules.rulesetFor;
}
const PROFILE = arg("profile") ?? "quick";
const PROPOSED = arg("proposed") ?? "drizzle-proposed/0011_gameplay_holdings.sql";
const ONLY = arg("only");
const KEEP = flag("keep");

/* ── deterministic randomness ──────────────────────────────────────────── */

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
type Rng = () => number;
function uuid(rng: Rng): string {
  const h = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ── synthetic geography ───────────────────────────────────────────────── */

// A synthetic play area. Nothing here is anyone's real location.
const CENTER = { lat: 52.37, lng: 4.9 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

interface Pt { lat: number; lng: number }
function offset(p: Pt, dxM: number, dyM: number): Pt {
  return { lat: p.lat + dyM / M_PER_DEG_LAT, lng: p.lng + dxM / mPerDegLng(p.lat) };
}
function distM(a: Pt, b: Pt): number {
  const dy = (a.lat - b.lat) * M_PER_DEG_LAT;
  const dx = (a.lng - b.lng) * mPerDegLng(a.lat);
  return Math.hypot(dx, dy);
}
function randomPointInDisk(rng: Rng, c: Pt, radiusM: number): Pt {
  const r = radiusM * Math.sqrt(rng());
  const t = rng() * 2 * Math.PI;
  return offset(c, r * Math.cos(t), r * Math.sin(t));
}

/** A walk of `meters`, sampled every `stepM`, with heading drift, kept inside the area. */
function walk(rng: Rng, start: Pt, meters: number, radiusM: number, stepM = 10): Pt[] {
  const pts: Pt[] = [start];
  let p = start;
  let heading = rng() * 2 * Math.PI;
  for (let d = 0; d < meters; d += stepM) {
    heading += (rng() - 0.5) * 0.35;
    if (distM(p, CENTER) > radiusM) {
      // Turn back toward the centre.
      heading = Math.atan2((CENTER.lng - p.lng) * mPerDegLng(p.lat), (CENTER.lat - p.lat) * M_PER_DEG_LAT) + (rng() - 0.5);
    }
    p = offset(p, stepM * Math.sin(heading), stepM * Math.cos(heading));
    pts.push(p);
  }
  return pts;
}

/** Cells that contain a fix, first touch, deduplicated (as cellsForObservations does). */
function cellsOf(points: Pt[], res: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of points) {
    const c = latLngToCell(p.lat, p.lng, res);
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

function areaCells(res: number, radiusM: number): string[] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const p = offset(CENTER, radiusM * Math.cos(t), radiusM * Math.sin(t));
    ring.push([p.lat, p.lng]);
  }
  return polygonToCells([ring], res);
}

/* ── scenarios ─────────────────────────────────────────────────────────── */

interface Scenario {
  name: string;
  /** Holding rules version the service runs (rules.ts RULESETS): 1001 stores cells as given, 1002 needs res 10 units. */
  rulesVersion: number;
  res: 8 | 9 | 10;
  density: "dense" | "sparse";
  players: number;
  days: number;
  activeShare: number;
  sessionsPerActiveDay: number;
  walkKm: [number, number];
  clubShare: number;
  checkpoints: number[];
  hostile?: { accounts: number; sessionsPerDay: number; units: number };
  /** Run the auto_explain probes at the end of this scenario. */
  explain?: boolean;
  /** Measure the scratch-table alternatives at the end of this scenario. */
  alternatives?: boolean;
  /** Per-walker daily unit budget passed to the service: undefined = its default (300), null = off. Ignored by a service without one. */
  unitBudget?: number | null;
  /**
   * Churn study only (profile "churn"): storage parameters set on gameplay_unit_challenges right after 0011 is applied,
   * as `ALTER TABLE ... SET (...)`, e.g. { autovacuum_vacuum_scale_factor: 0 }. Bench-side; the service is unchanged.
   */
  challengeReloptions?: Record<string, number>;
  /** Churn study only: a plain VACUUM (never VACUUM FULL) of gameplay_unit_challenges after every N applied sessions, standing in for an autovacuum that keeps up at walking pace. */
  challengeVacuumEvery?: number;
  /** Churn study only: a plain VACUUM of gameplay_unit_challenges once per day, after the day's applies. */
  challengeVacuumDaily?: boolean;
}

const AREA_RADIUS_M = { dense: 2_000, sparse: 12_000 } as const;

const PROFILES: Record<string, Scenario[]> = {
  quick: [
    { name: "quick-res10-dense", rulesVersion: 1002, res: 10, density: "dense", players: 30, days: 4, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [2, 4], explain: true, alternatives: true,
      hostile: { accounts: 1, sessionsPerDay: 2, units: 500 } },
  ],
  full: [
    { name: "res8-dense-250", rulesVersion: 1001, res: 8, density: "dense", players: 250, days: 30, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [10, 20, 30], alternatives: true },
    { name: "res9-dense-250", rulesVersion: 1001, res: 9, density: "dense", players: 250, days: 30, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [10, 20, 30], alternatives: true },
    { name: "res10-dense-250", rulesVersion: 1002, res: 10, density: "dense", players: 250, days: 30, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [10, 20, 30], alternatives: true },
    { name: "res10-sparse-250", rulesVersion: 1002, res: 10, density: "sparse", players: 250, days: 30, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [10, 20, 30], alternatives: true },
    { name: "res10-dense-250-a9", rulesVersion: 1001, res: 10, density: "dense", players: 250, days: 30, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [30], alternatives: true },
    { name: "res10-dense-1000", rulesVersion: 1002, res: 10, density: "dense", players: 1000, days: 20, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [5, 10, 20], explain: true, alternatives: true },
    { name: "res10-hostile", rulesVersion: 1002, res: 10, density: "dense", players: 100, days: 7, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [7], alternatives: true,
      hostile: { accounts: 5, sessionsPerDay: 20, units: 500 } },
  ],
  // Revision 2 sizing: rule set 1002 at resolution 10, 100 to 1000 players for 14 days, and
  // twice the earlier hostile load (10 accounts x 20 sessions x 500 units for 7 days) with and without the unit budget.
  capacity: [
    ...[100, 200, 500, 1000].map((players): Scenario => ({
      name: `cap-res10-${players}`, rulesVersion: 1002, res: 10, density: "dense", players, days: 14, activeShare: 0.6, sessionsPerActiveDay: 1.5,
      walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [7, 14], alternatives: true, explain: players === 1000,
    })),
    { name: "cap-res10-hostile2x", rulesVersion: 1002, res: 10, density: "dense", players: 100, days: 7, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [7], alternatives: true,
      hostile: { accounts: 10, sessionsPerDay: 20, units: 500 } },
    { name: "cap-res10-hostile2x-nobudget", rulesVersion: 1002, res: 10, density: "dense", players: 100, days: 7, activeShare: 0.6, sessionsPerActiveDay: 1.5, walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [7], alternatives: true,
      hostile: { accounts: 10, sessionsPerDay: 20, units: 500 }, unitBudget: null },
  ],
  // Revision 3 (integration of storage revision 2 and rule set 1002): 1 to 1000 players for 14 days
  // (a 14-day raw retention window), with 1002's session paths written as the movement pipeline would.
  integration: [1, 100, 200, 500, 1000].map((players): Scenario => ({
    name: `r3-res10-${players}`, rulesVersion: 1002, res: 10, density: "dense", players, days: 14, activeShare: 0.6, sessionsPerActiveDay: 1.5,
    walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [7, 14], explain: players === 1000,
  })),
  // Churn options for gameplay_unit_challenges (G34_DATA_LIFECYCLE.md section 5): the same 200 players and walks
  // (the seed depends only on players, resolution and density), 14 days, with the table's vacuum regime varied.
  // The service and its delete-and-insert write pattern are unchanged.
  churn: ([
    ["churn-200-default", {}],
    ["churn-200-autovacuum-table", { challengeReloptions: { autovacuum_vacuum_scale_factor: 0, autovacuum_vacuum_threshold: 200, autovacuum_vacuum_cost_delay: 0, autovacuum_analyze_scale_factor: 0.05 } }],
    ["churn-200-vacuum-daily", { challengeVacuumDaily: true }],
    ["churn-200-vacuum-every-50", { challengeVacuumEvery: 50 }],
  ] as [string, Partial<Scenario>][]).map(([name, extra]): Scenario => ({
    name, rulesVersion: 1002, res: 10, density: "dense", players: 200, days: 14, activeShare: 0.6, sessionsPerActiveDay: 1.5,
    walkKm: [1.5, 4.5], clubShare: 0.7, checkpoints: [7, 14], ...extra,
  })),
};

/* ── database helpers ──────────────────────────────────────────────────── */

function sqlFile(path: string): string[] {
  return readFileSync(join(BACKEND, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
}

async function runInTx(pool: pg.Pool, statements: string[]): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const s of statements) await c.query(s);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

async function relations(pool: pg.Pool): Promise<Map<string, string>> {
  const r = await pool.query(`SELECT c.relname, c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'i', 'I')`);
  return new Map(r.rows.map((x) => [x.relname as string, x.kind as string]));
}

interface TableSize {
  table: string;
  rows: number;
  heap: number;
  indexes: number;
  toast: number;
  other: number;
  total: number;
  deadTuples: number;
  bytesPerRow: number | null;
}

async function tableSizes(pool: pg.Pool, schema = "public"): Promise<TableSize[]> {
  const r = await pool.query(`
    SELECT c.relname AS table, pg_relation_size(c.oid) AS heap, pg_indexes_size(c.oid) AS indexes,
           CASE WHEN c.reltoastrelid <> 0 THEN pg_total_relation_size(c.reltoastrelid) ELSE 0 END AS toast,
           pg_total_relation_size(c.oid) AS total, coalesce(s.n_dead_tup, 0) AS dead
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     ORDER BY c.relname`, [schema]);
  const out: TableSize[] = [];
  for (const x of r.rows) {
    const cnt = await pool.query(`SELECT count(*)::bigint AS n FROM "${schema}"."${x.table}"`);
    let total = Number(x.total);
    let heap = Number(x.heap);
    let indexes = Number(x.indexes);
    let toast = Number(x.toast);
    // A partitioned parent holds nothing itself: add its partitions.
    const parts = await pool.query(`SELECT c.oid FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace n ON n.oid = p.relnamespace WHERE n.nspname = $1 AND p.relname = $2`, [schema, x.table]);
    for (const p of parts.rows) {
      const s = await pool.query(`SELECT pg_relation_size($1::oid) AS heap, pg_indexes_size($1::oid) AS idx, pg_total_relation_size($1::oid) AS total,
        (SELECT CASE WHEN reltoastrelid <> 0 THEN pg_total_relation_size(reltoastrelid) ELSE 0 END FROM pg_class WHERE oid = $1::oid) AS toast`, [p.oid]);
      heap += Number(s.rows[0].heap); indexes += Number(s.rows[0].idx); total += Number(s.rows[0].total); toast += Number(s.rows[0].toast);
    }
    const rows = Number(cnt.rows[0].n);
    out.push({ table: x.table, rows, heap, indexes, toast, other: total - heap - indexes - toast, total, deadTuples: Number(x.dead), bytesPerRow: rows > 0 ? total / rows : null });
  }
  return out;
}

async function indexSizes(pool: pg.Pool, table: string): Promise<{ index: string; bytes: number }[]> {
  const r = await pool.query(`SELECT i.relname AS index, pg_relation_size(i.oid) AS bytes FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid WHERE t.relname = $1 ORDER BY i.relname`, [table]);
  return r.rows.map((x) => ({ index: x.index, bytes: Number(x.bytes) }));
}

const dbSize = async (pool: pg.Pool) => Number((await pool.query("SELECT pg_database_size(current_database()) AS b")).rows[0].b);

/* ── one scenario ──────────────────────────────────────────────────────── */

interface Checkpoint {
  day: number;
  databaseBytes: number;
  tables: TableSize[];
  /** Same, after VACUUM FULL (only at the last checkpoint). */
  compact?: TableSize[];
  compactDatabaseBytes?: number;
}

interface ScenarioResult {
  scenario: Scenario;
  /** v1: 0011 as at 1541a01 (text ids, a row per push); v2: revision 2 (partitioned, compact, refusals as counters). */
  shape?: "v1" | "v2";
  /** Pushes the service processed (accepted and refused outcomes), normal and hostile. */
  pushes?: { normal: number; hostile: number; ledgerRows: number };
  hostileOutcomes?: Record<string, number>;
  /** Temp files written by each day's settlement (pg_stat_database), the sort spill. */
  settleSpill?: { day: number; tempFiles: number; tempBytes: number; ms: number }[];
  /** Cluster WAL written by the scenario's daily writes and settlements, measurement VACUUMs excluded (pg_current_wal_lsn differences; cluster-wide). */
  walBytes?: number;
  /** Revision 3: 1002 session path rows written beside the verifications. */
  sessionPaths?: number;
  /** Churn study: plain VACUUMs of gameplay_unit_challenges the scenario ran, and the table each day before any measurement VACUUM. */
  challengeVacuums?: number;
  challengeSamples?: { day: number; bytes: number; live: number; dead: number }[];
  /** Revision 2 only: bytes of one empty day partition, per partitioned table. */
  emptyPartition?: Record<string, number>;
  partitions?: number;
  takers?: Record<string, unknown>;
  reclaim?: Record<string, unknown>;
  erasure?: { ms: number; rowsBefore: number; rowsAfter: number };
  proposedFile: string;
  proposedTables: string[];
  proposedIndexes: string[];
  publicTablesBefore: number;
  publicTablesAfter: number;
  emptySchema: { databaseBytes: number; gameplayBytes: number; tables: TableSize[] };
  /** Every public table right after migrating, before any row: the fixed cost subtracted for marginal bytes per row. */
  emptyTables: TableSize[];
  sessions: number;
  hostileSessions: number;
  unitsPerSession: { mean: number; p50: number; p95: number; max: number };
  outcomes: Record<string, number>;
  retries: { replays: number; rowsBefore: number; rowsAfter: number; bytesBefore: number; bytesAfter: number } | null;
  checkpoints: Checkpoint[];
  pushEventIndexes: { index: string; bytes: number }[];
  dayStatesPerPush: number;
  distinctUnits: number;
  districtMapUnits: number;
  clubs: number;
  districts: number;
  authFootprint: { auditBytesPerRow: number; authSessionBytesPerRow: number; rows: number } | null;
  alternatives: Record<string, unknown> | null;
  explain: Record<string, { query: string; executionMs: number | null; plan: string }[]> | null;
  seconds: number;
}

const SEASON_START = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);

async function pooled<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const t0 = Date.now();
  const rng = mulberry32(0x6d6f7665 ^ s.players ^ (s.res << 16) ^ (s.density === "dense" ? 1 : 2));
  const admin = new pg.Pool({ connectionString: URL_ENV });
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  }
  const dbName = `gameplay_bench_${randomBytes(5).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(URL_ENV);
  url.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
  pool.on("error", () => undefined);
  const db = drizzle(pool) as unknown as Db;
  try {
    // Schema: the committed chain, then the proposed file, both read now.
    const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    await runInTx(pool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
    const before = await relations(pool);
    await runInTx(pool, sqlFile(PROPOSED));
    if (s.challengeReloptions) {
      const opts = Object.entries(s.challengeReloptions).map(([k, v]) => {
        if (!/^[a-z_]+$/.test(k) || !Number.isFinite(v)) throw new Error(`bad storage parameter ${k}`);
        return `${k} = ${v}`;
      });
      await pool.query(`ALTER TABLE gameplay_unit_challenges SET (${opts.join(", ")})`);
    }
    const after = await relations(pool);
    const created = [...after.keys()].filter((k) => !before.has(k));
    const proposedTables = created.filter((k) => ["r", "p"].includes(after.get(k)!)).sort();
    const proposedIndexes = created.filter((k) => ["i", "I"].includes(after.get(k)!)).sort();
    const publicTablesBefore = [...before.values()].filter((k) => ["r", "p"].includes(k)).length;
    const publicTablesAfter = [...after.values()].filter((k) => ["r", "p"].includes(k)).length;
    await pool.query("VACUUM ANALYZE");
    const emptyTables = await tableSizes(pool);
    const emptySchema = {
      databaseBytes: await dbSize(pool),
      gameplayBytes: emptyTables.filter((t) => proposedTables.includes(t.table)).reduce((a, t) => a + t.total, 0),
      tables: emptyTables.filter((t) => proposedTables.includes(t.table)),
    };

    let clock = at(SEASON_START - 1, 12);
    const base = rulesetFor(s.rulesVersion);
    const rules: GameplayRules = { ...base, holding: { ...base.holding }, seasonOneStartDay: SEASON_START, maxDaysPerRun: 31 };
    const service = new GameplayService({ db, rules, now: () => clock, ...(s.unitBudget !== undefined ? { unitBudget: s.unitBudget } : {}) });
    const shape: "v1" | "v2" = proposedTables.includes("gameplay_player_day_proofs") ? "v2" : "v1";

    // Players, each with a Supabase identity as the live path creates.
    const radius = AREA_RADIUS_M[s.density];
    const players = Array.from({ length: s.players }, () => ({ id: uuid(rng), home: randomPointInDisk(rng, CENTER, radius) }));
    const abusers = Array.from({ length: s.hostile?.accounts ?? 0 }, () => ({ id: uuid(rng), home: CENTER }));
    const everyone = [...players, ...abusers];
    await pool.query(`INSERT INTO users (id) SELECT unnest($1::text[])`, [everyone.map((p) => p.id)]);
    await pool.query(`INSERT INTO auth_identities (id, user_id, provider, provider_subject, verification_status)
      SELECT gen_random_uuid()::text, u, 'supabase', gen_random_uuid()::text, 'verified' FROM unnest($1::text[]) AS u`, [everyone.map((p) => p.id)]);

    // District map (D20 stand-in): every cell of the area, district = its resolution-6 parent.
    const mapCells = areaCells(s.res, radius + 1_000);
    for (let i = 0; i < mapCells.length; i += 20_000) {
      const chunk = mapCells.slice(i, i + 20_000);
      if (shape === "v2") {
        await pool.query(`INSERT INTO gameplay_unit_districts (unit, district_id, districts_version)
          SELECT u, d, 'bench-1' FROM unnest($1::bigint[], $2::text[]) AS t(u, d)`, [chunk.map(cellToInt8), chunk.map((c) => cellToParent(c, 6))]);
      } else {
        await pool.query(`INSERT INTO gameplay_unit_districts (unit_id, district_id, districts_version)
          SELECT u, d, 'bench-1' FROM unnest($1::text[], $2::text[]) AS t(u, d)`, [chunk, chunk.map((c) => cellToParent(c, 6))]);
      }
    }
    const districts = new Set(mapCells.map((c) => cellToParent(c, 6))).size;

    // Clubs: one per ten players; clubShare of players in one. Effective from season day 1 (D18 next day).
    const nClubs = Math.max(1, Math.round(s.players / 10));
    const clubIds = Array.from({ length: nClubs }, (_, i) => `club-${String(i).padStart(4, "0")}-${uuid(rng).slice(0, 8)}`);
    const members = players.filter(() => rng() < s.clubShare);
    for (let i = 0; i < members.length; i++) {
      const club = i % nClubs;
      if (i < nClubs) await service.createClub(members[i]!.id, clubIds[club]!, `Bench club ${String(club).padStart(4, "0")}`);
      else await service.joinClub(members[i]!.id, clubIds[club]!);
    }

    const unitsPerSession: number[] = [];
    const outcomes: Record<string, number> = {};
    const hostileOutcomes: Record<string, number> = {};
    const settleSpill: NonNullable<ScenarioResult["settleSpill"]> = [];
    let sessions = 0;
    let hostileSessions = 0;
    let retries: ScenarioResult["retries"] = null;
    const checkpoints: Checkpoint[] = [];
    let explain: ScenarioResult["explain"] = null;
    const hostileBlock = s.hostile ? gridDisk(latLngToCell(CENTER.lat, CENTER.lng, s.res), 14).slice(0, s.hostile.units) : [];
    const lastDay = SEASON_START + s.days - 1;
    // Rule set 1002 pushes the stored session path; the movement pipeline writes it (resolution 10, walk order)
    // beside the verification and keeps the resolution 8 cells in traversed_hex_ids.
    const writesPaths = Boolean(rules.units.source) && proposedTables.includes("gameplay_session_paths");
    let sessionPaths = 0;
    let challengeVacuums = 0;
    const challengeSamples: { day: number; bytes: number; live: number; dead: number }[] = [];
    const lsn = async () => String((await pool.query("SELECT pg_current_wal_lsn()::text AS l")).rows[0].l);
    let walBytes = 0;

    for (let day = SEASON_START; day <= lastDay; day++) {
      const walDayStart = await lsn();
      const todays: { userId: string; clientSessionId: string; id: string; cells: string[]; meters: number; seconds: number; end: number; hostile?: boolean }[] = [];
      for (const p of players) {
        if (rng() >= s.activeShare) continue;
        const n = Math.floor(s.sessionsPerActiveDay) + (rng() < s.sessionsPerActiveDay % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const meters = 1000 * (s.walkKm[0] + rng() * (s.walkKm[1] - s.walkKm[0]));
          const cells = cellsOf(walk(rng, randomPointInDisk(rng, p.home, 300), meters, radius), s.res).slice(0, rules.maxUnitsPerSession);
          const seconds = Math.round(meters / 1.4);
          const end = at(day, 6 + rng() * 15);
          todays.push({ userId: p.id, clientSessionId: uuid(rng), id: uuid(rng), cells, meters: Math.round(meters), seconds, end });
          unitsPerSession.push(cells.length);
        }
      }
      for (const a of abusers) {
        for (let k = 0; k < s.hostile!.sessionsPerDay; k++) {
          const end = at(day, 1 + (k * 20) / s.hostile!.sessionsPerDay);
          todays.push({ userId: a.id, clientSessionId: uuid(rng), id: uuid(rng), cells: hostileBlock, meters: 40_000, seconds: 28_000, end, hostile: true });
          hostileSessions += 1;
        }
      }
      // Verified movement rows, shaped as the movement pipeline writes them.
      await pool.query(`
        INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, confidence,
          start_time, end_time, movement_mode, rules_version, started_at, finished_at, paused_ms, sealed, seal_methods, seal_event_count, created_at)
        SELECT t.id, t.u, t.c, 'verified', t.m, t.s, string_to_array(t.cells, ','), 0.92, t.e - t.s * 1000, t.e, 'onFoot', 1, t.e - t.s * 1000 - 5000, t.e + 2000, 0,
               -- A closed loop, as the sealing engine reports one (rule 3: unsealed sessions claim nothing), received a minute after it ended.
               true, ARRAY['return_to_start']::text[], 1, (to_timestamp((t.e + 60000)::float8 / 1000) AT TIME ZONE current_setting('TimeZone'))
          FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[], $6::text[], $7::bigint[]) AS t(id, u, c, m, s, cells, e)`,
        [todays.map((x) => x.id), todays.map((x) => x.userId), todays.map((x) => x.clientSessionId), todays.map((x) => x.meters),
          todays.map((x) => x.seconds), todays.map((x) => (writesPaths ? [...new Set(x.cells.map((c) => cellToParent(c, 8)))] : x.cells).join(",")), todays.map((x) => x.end)]);
      if (writesPaths) {
        for (const x of todays) {
          await pool.query(`INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
            VALUES ($1, 1, 10, $2::bigint[], $3::varbit, 0, false)`, [x.id, x.cells.map(cellToInt8), x.cells.map(() => "0").join("")]);
          sessionPaths += 1;
        }
      }
      clock = at(day, 23.5);
      const isProbeDay = s.explain && day === lastDay;
      const toApply = isProbeDay ? todays.slice(0, -1) : todays;
      let sinceVacuum = 0;
      let vacuuming: Promise<unknown> = Promise.resolve();
      await pooled(toApply, 8, async (x) => {
        if (s.challengeVacuumEvery && ++sinceVacuum >= s.challengeVacuumEvery) {
          sinceVacuum = 0;
          await vacuuming;
          vacuuming = pool.query("VACUUM gameplay_unit_challenges");
          challengeVacuums += 1;
        }
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await service.applySession(x.userId, x.clientSessionId);
            const into = x.hostile ? hostileOutcomes : outcomes;
            for (const [o, n] of Object.entries(r.outcomes)) into[o] = (into[o] ?? 0) + n;
            into.skipped = (into.skipped ?? 0) + r.skipped;
            into.rejected = (into.rejected ?? 0) + r.rejected;
            sessions += 1;
            return;
          } catch (err) {
            if (err instanceof GameplayError && err.code === "concurrent_push_retry" && attempt < 8) continue;
            throw err;
          }
        }
      });
      await vacuuming;
      if (s.challengeVacuumDaily) {
        await pool.query("VACUUM gameplay_unit_challenges");
        challengeVacuums += 1;
      }
      // Normal retries: clients re-sending apply for sessions already applied.
      if (day === SEASON_START + 1 && retries === null) {
        const sample = todays.slice(0, Math.min(50, todays.length));
        const rowsNow = async () => (await tableSizes(pool)).filter((t) => proposedTables.includes(t.table));
        await pool.query("VACUUM");
        const b = await rowsNow();
        for (const x of sample) {
          const r = await service.applySession(x.userId, x.clientSessionId);
          if (!r.replayed) throw new Error("retry was not a replay");
        }
        await pool.query("VACUUM");
        const a = await rowsNow();
        retries = { replays: sample.length, rowsBefore: b.reduce((q, t) => q + t.rows, 0), rowsAfter: a.reduce((q, t) => q + t.rows, 0),
          bytesBefore: b.reduce((q, t) => q + t.total, 0), bytesAfter: a.reduce((q, t) => q + t.total, 0) };
      }
      if (isProbeDay) {
        explain = await probes(url.toString(), rules, todays[todays.length - 1]!, players, clubIds[0]!, day, (c) => { clock = c; });
      }
      clock = at(day + 1, 3);
      const temp = async () => {
        await new Promise((r) => setTimeout(r, 1100)); // cumulative stats are flushed when a backend goes idle
        await pool.query("SELECT pg_stat_clear_snapshot()");
        const t = (await pool.query("SELECT temp_files, temp_bytes FROM pg_stat_database WHERE datname = current_database()")).rows[0];
        return { files: Number(t.temp_files), bytes: Number(t.temp_bytes) };
      };
      const t1 = await temp();
      const ts = Date.now();
      await service.settleDueDays();
      const ms = Date.now() - ts;
      const t2 = await temp();
      settleSpill.push({ day: day - SEASON_START + 1, tempFiles: t2.files - t1.files, tempBytes: t2.bytes - t1.bytes, ms });
      // WAL of the day's writes and settlement only (not the measurement VACUUMs below). Cluster-wide.
      walBytes += Number((await pool.query("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn) AS b", [walDayStart])).rows[0].b);
      const n = day - SEASON_START + 1;
      if (PROFILE === "churn") {
        // Before any measurement VACUUM: the table as the day's writes left it. Stats are flushed when backends go idle.
        await new Promise((r) => setTimeout(r, 600));
        await pool.query("SELECT pg_stat_clear_snapshot()");
        const c = (await pool.query(`SELECT pg_total_relation_size('gameplay_unit_challenges') AS b,
          (SELECT count(*) FROM gameplay_unit_challenges) AS live,
          coalesce((SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'gameplay_unit_challenges'), 0) AS dead`)).rows[0];
        challengeSamples.push({ day: n, bytes: Number(c.b), live: Number(c.live), dead: Number(c.dead) });
      }
      if (s.checkpoints.includes(n)) {
        await pool.query("VACUUM ANALYZE");
        const cp: Checkpoint = { day: n, databaseBytes: await dbSize(pool), tables: await tableSizes(pool) };
        if (n === s.days) {
          await pool.query("VACUUM FULL");
          await pool.query("ANALYZE");
          cp.compact = await tableSizes(pool);
          cp.compactDatabaseBytes = await dbSize(pool);
        }
        checkpoints.push(cp);
        const pe = cp.tables.find((t) => t.table === "gameplay_push_events");
        console.error(`  ${s.name} day ${n}: database ${(cp.databaseBytes / MIB).toFixed(1)} MiB, push rows ${pe?.rows ?? "?"}, ${(pe?.bytesPerRow ?? 0).toFixed(0)} B/row`);
      }
    }

    const final = checkpoints[checkpoints.length - 1]!.tables;
    const rowsOf = (t: string) => final.find((x) => x.table === t)?.rows ?? 0;
    const pushEventIndexes = await indexSizes(pool, "gameplay_push_events");
    const authFootprint = await measureAuth(pool, everyone.map((p) => p.id), rng);
    const alternatives = s.alternatives ? await measureAlternatives(pool) : null;
    const counted = (o: Record<string, number>) => Object.entries(o).filter(([k]) => k !== "skipped" && k !== "rejected").reduce((a, [, v]) => a + v, 0);
    const pushes = { normal: counted(outcomes), hostile: counted(hostileOutcomes), ledgerRows: rowsOf("gameplay_push_events") };
    const v2 = shape === "v2" ? await measureV2(pool) : {};
    const takers = await measureTakers(pool, shape, SEASON_START + s.days - 1);
    const erasure = await measureErasure(pool, db, players.map((p) => p.id));
    const reclaim = await measureReclaim(pool, shape, SEASON_START);
    const sorted = [...unitsPerSession].sort((a, b) => a - b);
    return {
      scenario: s, shape, pushes, hostileOutcomes, settleSpill, ...v2, takers, erasure, reclaim, proposedFile: PROPOSED, proposedTables, proposedIndexes, publicTablesBefore, publicTablesAfter, emptySchema,
      emptyTables, sessions, hostileSessions,
      unitsPerSession: {
        mean: unitsPerSession.reduce((a, b) => a + b, 0) / Math.max(1, unitsPerSession.length),
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, max: sorted[sorted.length - 1] ?? 0,
      },
      outcomes, retries, checkpoints, pushEventIndexes,
      dayStatesPerPush: rowsOf("gameplay_unit_day_states") / Math.max(1, pushes.normal + pushes.hostile),
      distinctUnits: rowsOf("gameplay_units"), districtMapUnits: mapCells.length, clubs: nClubs, districts,
      authFootprint, alternatives, explain, walBytes, sessionPaths, challengeVacuums, challengeSamples, seconds: (Date.now() - t0) / 1000,
    };
  } finally {
    await pool.end();
    admin.on("error", () => undefined);
    if (!KEEP) await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    else console.error(`  kept database ${dbName}`);
    await admin.end();
  }
}

/* ── auth and audit footprint (0000–0010 tables) ───────────────────────── */

/** One rotated auth session and one session_refreshed audit row per token refresh, shaped as the identity code writes them. */
async function measureAuth(pool: pg.Pool, userIds: string[], rng: Rng) {
  const n = 20_000;
  const users = Array.from({ length: n }, () => userIds[Math.floor(rng() * userIds.length)]!);
  const b = await tableSizes(pool);
  await pool.query(`
    INSERT INTO auth_sessions (id, user_id, family_id, refresh_token_hash, security_version, user_agent_hash, expires_at, last_used_at, rotated_at, status)
    SELECT gen_random_uuid()::text, u, gen_random_uuid()::text, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 0,
           encode(sha256(u::bytea), 'hex'), now() + interval '30 days', now(), now(), 'rotated'
      FROM unnest($1::text[]) AS u`, [users]);
  await pool.query(`
    INSERT INTO security_audit_events (id, user_id, event_type, subject_id, metadata)
    SELECT gen_random_uuid()::text, u, 'session_refreshed', gen_random_uuid()::text, NULL FROM unnest($1::text[]) AS u`, [users]);
  await pool.query("VACUUM ANALYZE auth_sessions");
  await pool.query("VACUUM ANALYZE security_audit_events");
  const a = await tableSizes(pool);
  const delta = (t: string) => (a.find((x) => x.table === t)!.total - b.find((x) => x.table === t)!.total) / n;
  return { auditBytesPerRow: delta("security_audit_events"), authSessionBytesPerRow: delta("auth_sessions"), rows: n };
}

/* ── alternatives, measured on scratch copies ──────────────────────────── */

async function hasColumns(pool: pg.Pool, table: string, cols: string[]): Promise<boolean> {
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
  const have = new Set(r.rows.map((x) => x.column_name as string));
  return cols.every((c) => have.has(c));
}

async function measureAlternatives(pool: pg.Pool): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const pe = ["event_id", "seq", "unit_id", "walker_id", "day", "push_kind", "shade_strength", "outcome", "previous_holder_id", "new_holder_id",
    "strength_before", "strength_after", "holding_rules_version", "source_session_id"];
  if (!(await hasColumns(pool, "gameplay_push_events", pe))) {
    // Revision 2: the ledger is already compact; only the movement cell-list cost is measured here.
    await pool.query("DROP SCHEMA IF EXISTS bench_alt CASCADE");
    await pool.query("CREATE SCHEMA bench_alt");
    out.sessionCells = await measureSessionCells(pool);
    await pool.query("DROP SCHEMA bench_alt CASCADE");
    return out;
  }
  await pool.query("DROP SCHEMA IF EXISTS bench_alt CASCADE");
  await pool.query("CREATE SCHEMA bench_alt");
  const size = async (t: string) => (await tableSizes(pool, "bench_alt")).find((x) => x.table === t)!;
  const rows = Number((await pool.query("SELECT count(*) AS n FROM gameplay_push_events")).rows[0].n);
  const cur = (await tableSizes(pool)).find((x) => x.table === "gameplay_push_events")!;
  out.current = { rows, bytesPerRow: cur.bytesPerRow, heapPerRow: cur.heap / rows, indexesPerRow: cur.indexes / rows };

  // A. Compact ledger: H3 cell as bigint, players and sessions as integer surrogates,
  //    outcome as smallint; the event id is derived (session, unit), not stored.
  await pool.query(`
    CREATE TABLE bench_alt.players AS SELECT row_number() OVER (ORDER BY id)::int AS player_no, id FROM users;
    CREATE UNIQUE INDEX ON bench_alt.players (id);
    CREATE TABLE bench_alt.sessions AS SELECT row_number() OVER (ORDER BY id)::int AS session_no, id FROM movement_verifications;
    CREATE UNIQUE INDEX ON bench_alt.sessions (id);
    CREATE TABLE bench_alt.push_events_compact (
      seq bigint NOT NULL, day integer NOT NULL, unit bigint NOT NULL, session_no integer, walker_no integer NOT NULL,
      previous_holder_no integer, new_holder_no integer, outcome smallint NOT NULL, kind_shade smallint NOT NULL,
      strength_before smallint NOT NULL, strength_after smallint NOT NULL, rules_version smallint NOT NULL,
      created_at timestamp NOT NULL, PRIMARY KEY (session_no, unit));
    INSERT INTO bench_alt.push_events_compact
    SELECT e.seq, e.day, ('x' || lpad(e.unit_id, 16, '0'))::bit(64)::bigint, s.session_no, w.player_no, ph.player_no, nh.player_no,
           array_position(ARRAY['claimed','reinforced','eroded','flipped','refused_deeded','refused_masked','refused_daily_limit','refused_take_budget'], e.outcome)::smallint,
           CASE WHEN e.push_kind = 'shade' THEN e.shade_strength ELSE 0 END, e.strength_before, e.strength_after, e.holding_rules_version - 1000, e.created_at
      FROM gameplay_push_events e JOIN bench_alt.players w ON w.id = e.walker_id
      LEFT JOIN bench_alt.players ph ON ph.id = e.previous_holder_id LEFT JOIN bench_alt.players nh ON nh.id = e.new_holder_id
      LEFT JOIN bench_alt.sessions s ON s.id = e.source_session_id;
    CREATE UNIQUE INDEX ON bench_alt.push_events_compact (seq);
    CREATE UNIQUE INDEX ON bench_alt.push_events_compact (walker_no, unit, day) WHERE outcome IN (3, 4);
    CREATE INDEX ON bench_alt.push_events_compact (unit, day);
    CREATE INDEX ON bench_alt.push_events_compact USING brin (day);`);
  await pool.query("VACUUM ANALYZE bench_alt.push_events_compact");
  const compact = await size("push_events_compact");
  out.compactLedger = { rows: compact.rows, bytesPerRow: compact.bytesPerRow, heapPerRow: compact.heap / compact.rows, indexesPerRow: compact.indexes / compact.rows };

  // B. Coarse audit proof after the raw TTL: event digest + transition, no player ids, BRIN on day.
  await pool.query(`
    CREATE TABLE bench_alt.push_proofs (day integer NOT NULL, unit bigint NOT NULL, event_digest bytea NOT NULL,
      outcome smallint NOT NULL, strength_before smallint NOT NULL, strength_after smallint NOT NULL);
    INSERT INTO bench_alt.push_proofs
    SELECT e.day, ('x' || lpad(e.unit_id, 16, '0'))::bit(64)::bigint, substring(sha256(convert_to(e.event_id || '|' || e.walker_id, 'UTF8')) FROM 1 FOR 16),
           array_position(ARRAY['claimed','reinforced','eroded','flipped','refused_deeded','refused_masked','refused_daily_limit','refused_take_budget'], e.outcome)::smallint,
           e.strength_before, e.strength_after FROM gameplay_push_events e ORDER BY e.day, e.seq;
    CREATE INDEX ON bench_alt.push_proofs USING brin (day);`);
  await pool.query("VACUUM ANALYZE bench_alt.push_proofs");
  const proofs = await size("push_proofs");
  out.coarseProof = { rows: proofs.rows, bytesPerRow: proofs.bytesPerRow };

  // C. Day digest: one row per day, sha256 over the day's canonical entries in seq order.
  await pool.query(`
    CREATE TABLE bench_alt.day_digests AS
    SELECT day, count(*)::int AS entries, sha256(convert_to(string_agg(event_id || ':' || outcome || ':' || strength_before || '>' || strength_after, ',' ORDER BY seq), 'UTF8')) AS entries_sha256
      FROM gameplay_push_events GROUP BY day;
    ALTER TABLE bench_alt.day_digests ADD PRIMARY KEY (day);`);
  await pool.query("VACUUM ANALYZE bench_alt.day_digests");
  const dig = await size("day_digests");
  out.dayDigest = { rows: dig.rows, bytesPerRow: dig.bytesPerRow, total: dig.total };

  // C2. Player-day proof: one row per walker and day, the digest of that walker's events and transitions.
  await pool.query(`
    CREATE TABLE bench_alt.player_day_proofs AS
    SELECT e.day, w.player_no, count(*)::int AS pushes,
           count(*) FILTER (WHERE e.outcome IN ('claimed', 'flipped'))::smallint AS gained,
           count(*) FILTER (WHERE e.outcome LIKE 'refused%')::smallint AS refused,
           sha256(convert_to(string_agg(e.event_id || ':' || e.outcome || ':' || e.strength_before || '>' || e.strength_after, ',' ORDER BY e.seq), 'UTF8')) AS events_sha256
      FROM gameplay_push_events e JOIN bench_alt.players w ON w.id = e.walker_id GROUP BY e.day, w.player_no;
    ALTER TABLE bench_alt.player_day_proofs ADD PRIMARY KEY (day, player_no);`);
  await pool.query("VACUUM ANALYZE bench_alt.player_day_proofs");
  const pdp = await size("player_day_proofs");
  out.playerDayProof = { rows: pdp.rows, bytesPerRow: pdp.bytesPerRow };

  // D. Snapshot compaction: drop unit day states superseded by a later state of the same unit on or before the last settled day.
  if (await hasColumns(pool, "gameplay_unit_day_states", ["unit_id", "day"])) {
    const r = await pool.query(`
      WITH last AS (SELECT coalesce(max(day), -1) AS d FROM gameplay_day_settlements)
      SELECT count(*) FILTER (WHERE s.day < (SELECT max(t.day) FROM gameplay_unit_day_states t WHERE t.unit_id = s.unit_id AND t.day <= (SELECT d FROM last))) AS superseded,
             count(*) AS total FROM gameplay_unit_day_states s`);
    const st = (await tableSizes(pool)).find((x) => x.table === "gameplay_unit_day_states")!;
    out.snapshotCompaction = { rows: Number(r.rows[0].total), superseded: Number(r.rows[0].superseded), bytesPerRow: st.bytesPerRow,
      bytesAfterCompaction: (Number(r.rows[0].total) - Number(r.rows[0].superseded)) * (st.bytesPerRow ?? 0) };
  }

  // E. Partitioning by day: the same rows in 10-day range partitions; then drop the oldest.
  await pool.query(`
    CREATE TABLE bench_alt.push_events_parted (LIKE public.gameplay_push_events INCLUDING DEFAULTS) PARTITION BY RANGE (day);
    ALTER TABLE bench_alt.push_events_parted ALTER COLUMN seq DROP IDENTITY IF EXISTS;`);
  const days = await pool.query("SELECT min(day) AS lo, max(day) AS hi FROM gameplay_push_events");
  const lo = Number(days.rows[0].lo);
  const hi = Number(days.rows[0].hi);
  const parts: string[] = [];
  for (let d = lo; d <= hi; d += 10) {
    const name = `push_events_p${d}`;
    parts.push(name);
    await pool.query(`CREATE TABLE bench_alt.${name} PARTITION OF bench_alt.push_events_parted FOR VALUES FROM (${d}) TO (${d + 10})`);
  }
  await pool.query(`
    ALTER TABLE bench_alt.push_events_parted ADD PRIMARY KEY (event_id, day);
    CREATE UNIQUE INDEX ON bench_alt.push_events_parted (seq, day);
    CREATE UNIQUE INDEX ON bench_alt.push_events_parted (walker_id, unit_id, day) WHERE outcome IN ('eroded', 'flipped');
    CREATE INDEX ON bench_alt.push_events_parted (unit_id, day);
    CREATE INDEX ON bench_alt.push_events_parted (walker_id, day);
    CREATE INDEX ON bench_alt.push_events_parted (source_session_id) WHERE source_session_id IS NOT NULL;
    INSERT INTO bench_alt.push_events_parted SELECT * FROM public.gameplay_push_events;`);
  await pool.query("VACUUM ANALYZE bench_alt.push_events_parted");
  const parted = await size("push_events_parted");
  const dbBefore = await dbSize(pool);
  await pool.query(`DROP TABLE bench_alt.${parts[0]}`);
  const dbAfter = await dbSize(pool);
  await pool.query(`CREATE TABLE bench_alt.empty_part (LIKE bench_alt.push_events_parted INCLUDING ALL)`);
  const empty = await size("empty_part");
  out.partitioning = { partitions: parts.length, rows: parted.rows, bytesPerRow: parted.bytesPerRow, droppedOldestFreedBytes: dbBefore - dbAfter, emptyPartitionBytes: empty.total };

  out.sessionCells = await measureSessionCells(pool);
  await pool.query("DROP SCHEMA bench_alt CASCADE");
  return out;
}

/** F. Session cell lists nulled after their TTL: what a movement_verifications row costs without them (in bench_alt). */
async function measureSessionCells(pool: pg.Pool) {
  const size = async (t: string) => (await tableSizes(pool, "bench_alt")).find((x) => x.table === t)!;
  await pool.query(`
    CREATE TABLE bench_alt.mv_full AS SELECT * FROM movement_verifications;
    CREATE TABLE bench_alt.mv_nocells AS SELECT * FROM movement_verifications;
    UPDATE bench_alt.mv_nocells SET traversed_hex_ids = NULL;`);
  await pool.query("VACUUM FULL bench_alt.mv_nocells");
  for (const t of ["mv_full", "mv_nocells"]) {
    await pool.query(`ALTER TABLE bench_alt.${t} ADD PRIMARY KEY (id); CREATE UNIQUE INDEX ON bench_alt.${t} (user_id, client_session_id);
      CREATE INDEX ON bench_alt.${t} (user_id); CREATE INDEX ON bench_alt.${t} (end_time) WHERE status = 'verified';`);
    await pool.query(`VACUUM ANALYZE bench_alt.${t}`);
  }
  const mvFull = await size("mv_full");
  const mvNo = await size("mv_nocells");
  const cells = Number((await pool.query("SELECT coalesce(sum(cardinality(traversed_hex_ids)), 0) AS n FROM movement_verifications")).rows[0].n);
  return { rows: mvFull.rows, bytesPerRowWithCells: mvFull.bytesPerRow, bytesPerRowWithoutCells: mvNo.bytesPerRow,
    cells, bytesPerCell: cells > 0 ? (mvFull.total - mvNo.total) / cells : null, toastBytes: mvFull.toast };
}

/* ── revision 2: partitions, the takers lookup, erasure and reclaim ────── */

async function partitionsOf(pool: pg.Pool, parent: string): Promise<string[]> {
  const r = await pool.query(`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = $1 ORDER BY c.relname`, [parent]);
  return r.rows.map((x) => x.relname as string);
}

/** Bytes of one empty day partition of each partitioned table, with its indexes (far-future day, dropped afterwards). */
async function measureV2(pool: pg.Pool): Promise<Pick<ScenarioResult, "emptyPartition" | "partitions">> {
  const far = 90_000;
  await pool.query("SELECT gameplay_ensure_day_partitions($1, $1)", [far]);
  const emptyPartition: Record<string, number> = {};
  for (const t of ["gameplay_push_events", "gameplay_walker_days"]) {
    const name = `${t}_d${far}`;
    emptyPartition[t] = Number((await pool.query(`SELECT pg_total_relation_size('gameplay_partitions.${name}'::regclass) AS b`)).rows[0].b);
    await pool.query(`DROP TABLE gameplay_partitions.${name}`);
  }
  return { emptyPartition, partitions: (await partitionsOf(pool, "gameplay_push_events")).length };
}

async function explainJson(c: pg.PoolClient, query: string, params: unknown[]) {
  const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, params);
  const top = r.rows[0]["QUERY PLAN"][0];
  const nodes: string[] = [];
  const walk = (n: Record<string, unknown>) => {
    nodes.push(`${n["Node Type"]}${n["Index Name"] ? ` ${n["Index Name"]}` : ""}${n["Relation Name"] ? ` on ${n["Relation Name"]}` : ""}`);
    for (const k of (n.Plans as Record<string, unknown>[] | undefined) ?? []) walk(k);
  };
  walk(top.Plan);
  return { executionMs: top["Execution Time"] as number, sharedHit: top.Plan["Shared Hit Blocks"], sharedRead: top.Plan["Shared Read Blocks"], nodes };
}

/**
 * "Who took this unit today": the lookup applySession makes for each batch
 * (one-push rule and challenges), and the dispute lookup for one unit. On v1
 * the full (unit_id, day) index is compared with a partial one on takes only.
 */
async function measureTakers(pool: pg.Pool, shape: "v1" | "v2", day: number): Promise<Record<string, unknown>> {
  const c = await pool.connect();
  const out: Record<string, unknown> = { day };
  try {
    await c.query("ANALYZE gameplay_push_events");
    if (shape === "v2") {
      const units = (await c.query(`SELECT unit::text AS u FROM gameplay_push_events WHERE day = $1 GROUP BY unit ORDER BY count(*) DESC LIMIT 500`, [day])).rows.map((x) => x.u);
      out.units = units.length;
      out.batchTakes = await explainJson(c, `SELECT e.unit, p.user_id FROM gameplay_push_events e JOIN gameplay_players p ON p.player_no = e.walker_no
        WHERE e.day = $1 AND e.unit = ANY($2::bigint[]) AND e.outcome IN (3, 4)`, [day, units]);
      out.oneUnitTakes = await explainJson(c, `SELECT walker_no, outcome FROM gameplay_push_events WHERE day = $1 AND unit = $2 AND outcome IN (3, 4)`, [day, units[0]]);
      out.oneUnitAllPushes = await explainJson(c, `SELECT walker_no, outcome FROM gameplay_push_events WHERE day = $1 AND unit = $2`, [day, units[0]]);
      out.indexes = (await c.query(`SELECT i.relname AS index, pg_relation_size(i.oid) AS bytes FROM pg_inherits h JOIN pg_class i ON i.oid = h.inhrelid
        JOIN pg_class pi ON pi.oid = h.inhparent WHERE pi.relname IN ('gameplay_push_events_takers_idx', 'gameplay_push_events_one_push_per_walker_unit_day', 'gameplay_push_events_pkey')
          AND i.relname LIKE '%_d' || $1 || '_%'`, [day])).rows.map((x) => ({ index: x.index, bytes: Number(x.bytes) }));
    } else {
      const units = (await c.query(`SELECT unit_id AS u FROM gameplay_push_events WHERE day = $1 GROUP BY unit_id ORDER BY count(*) DESC LIMIT 500`, [day])).rows.map((x) => x.u);
      out.units = units.length;
      const q = `SELECT unit_id, walker_id FROM gameplay_push_events WHERE day = $1 AND unit_id = ANY($2::text[]) AND outcome IN ('eroded', 'flipped')`;
      out.batchTakesFullIndex = await explainJson(c, q, [day, units]);
      out.fullIndexBytes = Number((await c.query(`SELECT pg_relation_size('gameplay_push_events_unit_day_idx'::regclass) AS b`)).rows[0].b);
      await c.query("BEGIN");
      await c.query(`DROP INDEX gameplay_push_events_unit_day_idx`);
      await c.query(`CREATE INDEX bench_takers_partial ON gameplay_push_events (unit_id, day) WHERE outcome IN ('eroded', 'flipped')`);
      await c.query("ANALYZE gameplay_push_events");
      out.batchTakesPartialIndex = await explainJson(c, q, [day, units]);
      out.oneUnitAllPushesPartialIndex = await explainJson(c, `SELECT walker_id, outcome FROM gameplay_push_events WHERE day = $1 AND unit_id = $2`, [day, units[0]]);
      out.partialIndexBytes = Number((await c.query(`SELECT pg_relation_size('bench_takers_partial'::regclass) AS b`)).rows[0].b);
      await c.query("ROLLBACK");
    }
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    out.error = String(err);
  } finally {
    c.release();
  }
  return out;
}

/** Account deletion through the real erasure store (accountDeletion.ts), for the player with most sessions. */
async function measureErasure(pool: pg.Pool, db: Db, ids: string[]): Promise<ScenarioResult["erasure"]> {
  const count = async () => Number((await pool.query("SELECT count(*) AS n FROM gameplay_push_events")).rows[0].n);
  const heavy = (await pool.query(`SELECT user_id FROM movement_verifications WHERE user_id = ANY($1::text[]) GROUP BY user_id ORDER BY count(*) DESC LIMIT 1`, [ids])).rows[0]?.user_id;
  if (!heavy) return undefined;
  const rowsBefore = await count();
  const t = Date.now();
  try {
    await createDrizzleAccountDeletionStore(db).erase(heavy);
  } catch (err) {
    return { ms: -1, rowsBefore, rowsAfter: rowsBefore, error: String(err) } as ScenarioResult["erasure"];
  }
  return { ms: Date.now() - t, rowsBefore, rowsAfter: await count() };
}

/**
 * Retiring a day of raw ledger: DELETE plus VACUUM on an unpartitioned copy
 * (what a non-partitioned table must do) against dropping the day partition
 * (revision 2). Read-only for v1's real tables; the copy is scratch.
 */
async function measureReclaim(pool: pg.Pool, shape: "v1" | "v2", firstDay: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const day = firstDay + 1;
  await pool.query("DROP TABLE IF EXISTS public.bench_flat");
  await pool.query("CREATE TABLE public.bench_flat (LIKE public.gameplay_push_events INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING INDEXES)");
  await pool.query("INSERT INTO public.bench_flat OVERRIDING SYSTEM VALUE SELECT * FROM public.gameplay_push_events");
  await pool.query("VACUUM ANALYZE public.bench_flat");
  const flatSize = async () => Number((await pool.query("SELECT pg_total_relation_size('public.bench_flat'::regclass) AS b")).rows[0].b);
  const flatBefore = await flatSize();
  const dayRows = Number((await pool.query("SELECT count(*) AS n FROM public.bench_flat WHERE day = $1", [day])).rows[0].n);
  let t = Date.now();
  await pool.query("DELETE FROM public.bench_flat WHERE day = $1", [day]);
  const deleteMs = Date.now() - t;
  t = Date.now();
  await pool.query("VACUUM public.bench_flat");
  const vacuumMs = Date.now() - t;
  const afterVacuum = await flatSize();
  t = Date.now();
  await pool.query("VACUUM FULL public.bench_flat");
  const vacuumFullMs = Date.now() - t;
  const afterFull = await flatSize();
  await pool.query("DROP TABLE public.bench_flat");
  out.deleteRoute = { day, dayRows, tableBytes: flatBefore, deleteMs, vacuumMs, freedByVacuum: flatBefore - afterVacuum, vacuumFullMs, freedByVacuumFull: flatBefore - afterFull,
    note: "VACUUM leaves the space to the table (reused, not returned); VACUUM FULL returns it but rewrites the table under an exclusive lock" };
  if (shape === "v2") {
    let freed = 0;
    let ms = 0;
    for (const t2 of ["gameplay_push_events", "gameplay_walker_days"]) {
      const name = `gameplay_partitions.${t2}_d${day}`;
      const bytes = Number((await pool.query(`SELECT pg_total_relation_size('${name}'::regclass) AS b`)).rows[0].b);
      const s = Date.now();
      await pool.query(`DROP TABLE ${name}`);
      ms += Date.now() - s;
      freed += bytes;
    }
    out.dropRoute = { day, freedBytes: freed, ms, note: "push ledger and walker-day partitions of that day; files unlinked at once, no dead tuples, no VACUUM" };
  }
  return out;
}

/* ── query plans of the hot paths, as the service sends them ───────────── */

async function probes(url: string, rules: GameplayRules, last: { userId: string; clientSessionId: string }, players: { id: string }[], clubId: string, day: number,
  setClock: (c: number) => void): Promise<Record<string, { query: string; executionMs: number | null; plan: string }[]>> {
  const notices: string[] = [];
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  pool.on("error", () => undefined);
  pool.on("connect", (client) => {
    client.on("notice", (n) => { if (n.message) notices.push(n.message); });
    void client.query(`LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_analyze = on; SET auto_explain.log_buffers = on;
      SET auto_explain.log_timing = on; SET auto_explain.log_nested_statements = off; SET auto_explain.log_level = 'notice'; SET client_min_messages = 'notice'`);
  });
  const db = drizzle(pool) as unknown as Db;
  let clock = at(day, 23.5);
  const svc = new GameplayService({ db, rules, now: () => clock });
  const out: Record<string, { query: string; executionMs: number | null; plan: string }[]> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    notices.length = 0;
    await fn();
    out[name] = notices.filter((m) => m.includes("Query Text:")).map((m) => {
      const q = (m.match(/Query Text: ([\s\S]*?)\n(?=\S)/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const ms = m.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? m.match(/duration: ([\d.]+) ms/)?.[1];
      return { query: q.slice(0, 400), executionMs: ms ? Number(ms) : null, plan: m.slice(m.indexOf("\n") + 1) };
    });
  };
  try {
    await run("applySession (new)", () => svc.applySession(last.userId, last.clientSessionId));
    await run("applySession (replay)", () => svc.applySession(last.userId, last.clientSessionId));
    clock = at(day + 1, 3);
    setClock(clock);
    await run("settleDay", () => svc.settleDay(day));
    const heavy = (await pool.query("SELECT holder_id FROM gameplay_units WHERE holder_id IS NOT NULL GROUP BY holder_id ORDER BY count(*) DESC LIMIT 1")).rows[0]?.holder_id ?? players[0]!.id;
    await run("myHoldings", () => svc.myHoldings(heavy));
    await run("myCredits", () => svc.myCredits(heavy, 1));
    await run("leaderboard player_credits", () => svc.leaderboard(heavy, 1, "player_credits"));
    await run("leaderboard club_district_days", () => svc.leaderboard(heavy, 1, "club_district_days"));
    await run("clubDay", () => svc.clubDay(clubId, day).catch(() => null));
    await run("districtsDay", () => svc.districtsDay(day).catch(() => null));
  } finally {
    await pool.end();
  }
  return out;
}

/* ── coefficients and projections ──────────────────────────────────────── */

const lastRows = (r: ScenarioResult, table: string) => r.checkpoints[r.checkpoints.length - 1]!.tables.find((x) => x.table === table)?.rows ?? 0;

/** Tables the projection model prices. Anything else 0011 creates is reported as unmodelled. */
const MODELLED = new Set(["gameplay_push_events", "gameplay_unit_day_states", "gameplay_units", "gameplay_applied_sessions", "gameplay_credit_lines",
  "gameplay_day_settlements", "gameplay_club_days", "gameplay_district_days", "gameplay_unit_districts", "gameplay_day_rules", "gameplay_walker_days",
  "gameplay_unit_challenges", "gameplay_clubs", "gameplay_club_memberships"]);

/** Marginal bytes per row at the last checkpoint: (total - empty table) / rows. */
function marginal(r: ScenarioResult, t: TableSize | undefined): number | null {
  if (!t || t.rows === 0) return null;
  const empty = r.emptyTables.find((x) => x.table === t.table)?.total ?? 0;
  return Math.max(0, t.total - empty) / t.rows;
}

/** Slack on current-state tables for row churn between vacuums (compact bytes x this). */
const STATE_CHURN_FACTOR = 1.5;

function statePerRow(r: ScenarioResult, table: string): number {
  const cp = r.checkpoints[r.checkpoints.length - 1]!;
  const t = cp.compact?.find((x) => x.table === table);
  const m = marginal(r, t);
  return m === null ? perRow(r, table) : m * STATE_CHURN_FACTOR;
}

function perRow(r: ScenarioResult, table: string, fallback = 0): number {
  const t = r.checkpoints[r.checkpoints.length - 1]!.tables.find((x) => x.table === table);
  return marginal(r, t) ?? fallback;
}

/** Bytes per row of a partitioned table with the fixed cost of its day partitions taken out (that is `partitionDay`). */
function partitionedPerRow(r: ScenarioResult, table: string): number {
  const t = r.checkpoints[r.checkpoints.length - 1]!.tables.find((x) => x.table === table);
  if (!t || t.rows === 0) return 0;
  return Math.max(0, t.total - (r.partitions ?? 0) * (r.emptyPartition?.[table] ?? 0)) / t.rows;
}

function costsFrom(r: ScenarioResult): RowCosts {
  const alt = r.alternatives as { sessionCells?: { bytesPerRowWithoutCells: number; bytesPerCell: number | null }; coarseProof?: { bytesPerRow: number }; playerDayProof?: { bytesPerRow: number } } | null;
  if (r.shape === "v2") {
    const v1 = costsFrom({ ...r, shape: "v1" });
    return {
      ...v1,
      pushEvent: partitionedPerRow(r, "gameplay_push_events"),
      walkerDay: partitionedPerRow(r, "gameplay_walker_days"),
      partitionDay: (r.emptyPartition?.gameplay_push_events ?? 0) + (r.emptyPartition?.gameplay_walker_days ?? 0),
      playerDayProof: perRow(r, "gameplay_player_day_proofs"),
      coarseProof: 0,
    };
  }
  return {
    pushEvent: perRow(r, "gameplay_push_events"),
    unitDayState: perRow(r, "gameplay_unit_day_states"),
    appliedSession: perRow(r, "gameplay_applied_sessions"),
    creditLine: perRow(r, "gameplay_credit_lines"),
    daySettlement: perRow(r, "gameplay_day_settlements"),
    clubDay: perRow(r, "gameplay_club_days"),
    districtDay: perRow(r, "gameplay_district_days"),
    movementBase: alt?.sessionCells?.bytesPerRowWithoutCells ?? perRow(r, "movement_verifications"),
    movementPerCell: alt?.sessionCells?.bytesPerCell ?? 0,
    securityAuditEvent: r.authFootprint?.auditBytesPerRow ?? 0,
    authSession: r.authFootprint?.authSessionBytesPerRow ?? 0,
    coarseProof: alt?.coarseProof?.bytesPerRow ?? 0,
    playerDayProof: alt?.playerDayProof?.bytesPerRow ?? 0,
    dayRules: perRow(r, "gameplay_day_rules"),
    walkerDay: perRow(r, "gameplay_walker_days"),
    unitChallenge: statePerRow(r, "gameplay_unit_challenges"),
    // Current-state tables: a small dense area rewrites each row thousands of times, so its
    // as-is bytes per row are mostly dead versions. Price them compact plus churn slack instead.
    unit: statePerRow(r, "gameplay_units"),
    unitDistrict: statePerRow(r, "gameplay_unit_districts"),
  };
}

/** Today's live database, measured read-only by the owner's tooling on 18 Oct (not by this script). */
const LIVE_BASELINE_BYTES = 11.8 * MIB;
const PLAY_AREA_KM2 = 1_000;

const r0 = (results: ScenarioResult[]) => results[0]!;

function projections(results: ScenarioResult[]) {
  const byRes = new Map<number, ScenarioResult>();
  for (const r of results) {
    if (r.scenario.hostile || (r.scenario.res === 10 && r.scenario.rulesVersion !== 1002)) continue;
    const prev = byRes.get(r.scenario.res);
    // Prefer the dense run with most rows for each resolution: worst per-unit contention is not the worst size, so take the largest.
    const rows = (x: ScenarioResult) => x.checkpoints[x.checkpoints.length - 1]!.tables.find((t) => t.table === "gameplay_push_events")?.rows ?? 0;
    if (!prev || (r.scenario.density === "dense" && rows(r) > rows(prev))) byRes.set(r.scenario.res, r);
  }
  const sparse = results.find((r) => r.scenario.density === "sparse" && !r.scenario.hostile);
  const a9 = results.find((r) => r.scenario.res === 10 && r.scenario.rulesVersion === 1001 && !r.scenario.hostile);
  const rows: { label: string; res: number; players: number; seasons: number; mib: number; pct: number; policy: string }[] = [];
  const table: string[] = [];
  const pct = (b: number) => (100 * b) / DEFAULT_THRESHOLDS.quotaBytes;
  // Conservative across runs: the highest day-state ratio and distinct-unit spread measured at res 10 (sparse).
  const dayStatesMax = Math.max(...results.filter((x) => !x.scenario.hostile).map((x) => x.dayStatesPerPush));
  const spreadRun = sparse ?? r0(results);
  const unitsPerPlayer = spreadRun.distinctUnits / spreadRun.scenario.players;
  const load = (r: ScenarioResult, players: number, seasons: number, over: Partial<LoadProfile> = {}): LoadProfile => {
    const cellKm2 = cellArea(latLngToCell(CENTER.lat, CENTER.lng, r.scenario.res), "km2");
    const areaUnits = Math.round(PLAY_AREA_KM2 / cellKm2);
    // Units grow with players, scaled from res 10 by cell area, bounded by the play area.
    const resScale = cellArea(latLngToCell(CENTER.lat, CENTER.lng, 10), "km2") / cellKm2;
    const distinctUnits = Math.min(areaUnits, Math.round(players * unitsPerPlayer * resScale));
    const pushes = r.checkpoints[r.checkpoints.length - 1]!.tables.find((t) => t.table === "gameplay_push_events")?.rows ?? 1;
    const erodedShare = (r.outcomes.eroded ?? 0) / Math.max(1, pushes);
    const windowDays = rulesetFor(r.scenario.rulesVersion).takeover.name === "two-day-challenge" ? 3 : 0;
    const base: LoadProfile = {
      players, activeShare: 0.6, sessionsPerActiveDay: 1.5, unitsPerSession: r.unitsPerSession.mean,
      dayStatesPerPush: Math.max(r.dayStatesPerPush, dayStatesMax), distinctUnits, districtMapUnits: areaUnits, openChallenges: 0,
      walkerDaysPerActiveDay: lastRows(r, "gameplay_walker_days") / Math.max(1, lastRows(r, "gameplay_credit_lines")),
      clubs: Math.round(players / 10), districts: Math.round(PLAY_AREA_KM2 / 36), auditRowsPerActiveDay: 6, days: 90 * seasons, ...over,
    };
    base.openChallenges = Math.min(base.distinctUnits * 2, base.players * base.activeShare * base.sessionsPerActiveDay * base.unitsPerSession * erodedShare * windowDays);
    return base;
  };
  const cell = (b: number) => `${(b / MIB).toFixed(0)} (${pct(b).toFixed(0)}%)`;
  const compactCosts = (r: ScenarioResult): RowCosts => {
    const alt = r.alternatives as { compactLedger?: { bytesPerRow: number } } | null;
    return { ...costsFrom(r), pushEvent: alt?.compactLedger?.bytesPerRow ?? costsFrom(r).pushEvent };
  };
  const POLICIES: { name: string; policy: RetentionPolicy; costs: (r: ScenarioResult) => RowCosts }[] = [
    { name: "keep all (0011 as written)", policy: KEEP_EVERYTHING, costs: costsFrom },
    { name: "TTL 45 d + per-push proof", policy: TTL_45_PER_PUSH_PROOF, costs: costsFrom },
    { name: "proposal: 14 d partitions + player-day proof", policy: PROPOSED_RETENTION, costs: costsFrom },
    { name: "proposal + compact ledger", policy: PROPOSED_RETENTION, costs: compactCosts },
  ];
  const line = (label: string, r: ScenarioResult, players: number, over: Partial<LoadProfile> = {}, pol = POLICIES[0]!) => {
    const costs = pol.costs(r);
    const vals = [1, 2, 3, 4].map((seasons) => {
      const p = projectStorage(load(r, players, seasons, over), costs, pol.policy, LIVE_BASELINE_BYTES);
      rows.push({ label, res: r.scenario.res, players, seasons, mib: p.totalBytes / MIB, pct: pct(p.totalBytes), policy: pol.name });
      return cell(p.totalBytes);
    });
    table.push(`| ${label} | res ${r.scenario.res} | ${players.toLocaleString("en")} | ${pol.name} | ${vals.join(" | ")} |`);
  };
  table.push("| Case | Unit | Players | Policy | 1 season MiB (% of 500) | 2 seasons | 3 seasons | 4 seasons |", "|---|---|---|---|---|---|---|---|");
  for (const pol of POLICIES) {
    for (const res of [8, 9, 10]) {
      const r = byRes.get(res);
      if (!r) continue;
      for (const players of [50, 250, 1000, 5000]) line("normal, dense", r, players, {}, pol);
    }
  }
  const r10 = byRes.get(10);
  const hostile = (players: number) => ({ hostile: { accounts: Math.max(1, Math.round(players / 100)), sessionsPerDay: 20, unitsPerSession: 500, days: 14 } });
  if (r10) {
    for (const pol of [POLICIES[0]!, POLICIES[3]!]) {
      for (const players of [250, 1000]) line("heavy: 3 sessions/active day, 80% active", r10, players, { sessionsPerActiveDay: 3, activeShare: 0.8 }, pol);
      if (sparse) for (const players of [250, 1000]) line("normal, sparse", sparse, players, {}, pol);
      if (a9) for (const players of [250, 1000]) line("normal, dense, rule set 1001 (immediate flip)", a9, players, {}, pol);
      for (const players of [250, 1000]) line("normal + 1% hostile (20 x 500 units/day for 14 days)", r10, players, hostile(players), pol);
    }
  }
  // The most players that stay under the hard-stop line, by resolution and policy.
  const hardStop = Math.min(DEFAULT_THRESHOLDS.hardStopFraction * DEFAULT_THRESHOLDS.quotaBytes, DEFAULT_THRESHOLDS.quotaBytes - DEFAULT_THRESHOLDS.reserveBytes);
  const fits: string[] = ["| Unit | Policy | Players under the hard stop, 1 season | 4 seasons |", "|---|---|---|---|"];
  const maxPlayers = (r: ScenarioResult, pol: (typeof POLICIES)[number], seasons: number) => {
    let lo = 0;
    let hi = 100_000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (projectStorage(load(r, mid, seasons), pol.costs(r), pol.policy, LIVE_BASELINE_BYTES).totalBytes <= hardStop) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const capacity: { res: number; policy: string; seasons1: number; seasons4: number }[] = [];
  for (const res of [8, 9, 10]) {
    const r = byRes.get(res);
    if (!r) continue;
    for (const pol of POLICIES) {
      const c = { res, policy: pol.name, seasons1: maxPlayers(r, pol, 1), seasons4: maxPlayers(r, pol, 4) };
      capacity.push(c);
      fits.push(`| res ${res} | ${pol.name} | ${c.seasons1.toLocaleString("en")} | ${c.seasons4.toLocaleString("en")} |`);
    }
  }
  return { rows, capacity, markdown: table.join("\n") + "\n\n" + fits.join("\n") };
}

/* ── revision 2 projections: old shape against new ─────────────────────── */

const ACCEPTED = ["claimed", "reinforced", "eroded", "flipped"];
const acceptedShareOf = (o: Record<string, number>) => {
  const all = Object.entries(o).filter(([k]) => k !== "skipped" && k !== "rejected").reduce((a, [, v]) => a + v, 0);
  return all > 0 ? ACCEPTED.reduce((a, k) => a + (o[k] ?? 0), 0) / all : 1;
};
const QUOTA_85 = 0.85 * DEFAULT_THRESHOLDS.quotaBytes;

/**
 * The capacity table for the revision 2 decision: rule set 1002 at
 * resolution 10, everything the database holds (gameplay, movement sessions
 * and their cell lists, auth sessions, security audit, the live baseline).
 * (a) keep everything, (b) 14-day raw partitions + 120-day player-day proofs,
 * (c) (b) with the compact ledger: for the old shape the scratch-copy
 * estimate, for the new shape what it measures.
 */
function capacityProjections(current: ScenarioResult[], baseline: ScenarioResult[] | null) {
  const shapes: { shape: "v1" | "v2"; results: ScenarioResult[] }[] = [];
  for (const set of [baseline, current]) {
    if (!set || set.length === 0) continue;
    shapes.push({ shape: set[0]!.shape ?? "v1", results: set });
  }
  const md: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const pct = (b: number) => (100 * b) / DEFAULT_THRESHOLDS.quotaBytes;
  for (const { shape, results } of shapes) {
    const normal = results.filter((r) => !r.scenario.hostile && r.scenario.res === 10);
    if (normal.length === 0) continue;
    const ref = normal.reduce((a, b) => (b.scenario.players > a.scenario.players ? b : a));
    const hostileRun = results.find((r) => r.scenario.hostile && r.scenario.unitBudget !== null);
    const costs = costsFrom(ref);
    const alt = ref.alternatives as { compactLedger?: { bytesPerRow: number } } | null;
    const compact: RowCosts = shape === "v1" ? { ...costs, pushEvent: alt?.compactLedger?.bytesPerRow ?? costs.pushEvent } : costs;
    const unitsPerPlayer = Math.max(...normal.map((r) => r.distinctUnits / r.scenario.players));
    const challengesPerPlayer = Math.max(...normal.map((r) => lastRows(r, "gameplay_unit_challenges") / r.scenario.players));
    const accepted = shape === "v2" ? acceptedShareOf(ref.outcomes) : 1;
    const hostileAccepted = shape === "v2" && hostileRun?.hostileOutcomes ? acceptedShareOf(hostileRun.hostileOutcomes) : 1;
    const cellKm2 = cellArea(latLngToCell(CENTER.lat, CENTER.lng, 10), "km2");
    const areaUnits = Math.round(PLAY_AREA_KM2 / cellKm2);
    const load = (players: number, seasons: number, hostile: boolean): LoadProfile => ({
      players, activeShare: 0.6, sessionsPerActiveDay: 1.5, unitsPerSession: ref.unitsPerSession.mean,
      dayStatesPerPush: Math.max(...normal.map((r) => r.dayStatesPerPush)),
      distinctUnits: Math.min(areaUnits, Math.round(players * unitsPerPlayer)), districtMapUnits: areaUnits,
      openChallenges: Math.min(areaUnits, Math.round(players * challengesPerPlayer)),
      walkerDaysPerActiveDay: lastRows(ref, "gameplay_walker_days") / Math.max(1, lastRows(ref, "gameplay_credit_lines")),
      clubs: Math.round(players / 10), districts: Math.round(PLAY_AREA_KM2 / 36), auditRowsPerActiveDay: 6, days: 90 * seasons,
      acceptedShare: accepted, hostileAcceptedShare: hostileAccepted,
      // The old shape has no unit budget: hostile pushes are bounded only by sessions x 500.
      unitBudget: shape === "v2" ? 300 : undefined,
      // Twice the 1% of the first study: 2% of accounts at 20 sessions x 500 units a day for 14 days.
      ...(hostile ? { hostile: { accounts: Math.max(1, Math.round(players / 50)), sessionsPerDay: 20, unitsPerSession: 500, days: 14 } } : {}),
    });
    const policies: { key: string; name: string; policy: RetentionPolicy; costs: RowCosts }[] = shape === "v1"
      ? [
        { key: "a", name: "old shape, keep everything", policy: KEEP_EVERYTHING, costs },
        { key: "b", name: "old shape, 14 d partitions + 120 d player-day proofs", policy: PROPOSED_RETENTION, costs },
        { key: "c", name: "old shape, (b) + compact ledger (scratch-copy estimate)", policy: PROPOSED_RETENTION, costs: compact },
      ]
      : [
        { key: "a", name: "revision 2, keep everything", policy: KEEP_EVERYTHING_V2, costs },
        { key: "c", name: "revision 2, 14 d partitions + 120 d player-day proofs (= (c), measured)", policy: PROPOSED_RETENTION, costs },
      ];
    md.push(`### ${shape === "v1" ? "Old shape (0011 at 1541a01)" : "Revision 2"}`, "",
      `Reference run ${ref.scenario.name}: ${ref.unitsPerSession.mean.toFixed(1)} units/session, ledger ${costs.pushEvent.toFixed(0)} B/row, accepted share ${(accepted * 100).toFixed(1)}%` +
      `${shape === "v2" ? `, hostile accepted share ${(hostileAccepted * 100).toFixed(1)}%, day partition pair ${costs.partitionDay ?? 0} B, player-day proof ${costs.playerDayProof.toFixed(0)} B/row` : ""}.`, "",
      "| Policy | Players | 1 season MiB (% of 500) | 4 seasons | 1 season + 2% hostile | 4 seasons + 2% hostile |", "|---|---|---|---|---|---|");
    for (const pol of policies) {
      for (const players of [100, 200, 500, 1000]) {
        const cells: string[] = [];
        for (const [seasons, hostile] of [[1, false], [4, false], [1, true], [4, true]] as const) {
          const p = projectStorage(load(players, seasons, hostile), pol.costs, pol.policy, LIVE_BASELINE_BYTES);
          rows.push({ shape, policy: pol.key, players, seasons, hostile, mib: p.totalBytes / MIB, pct: pct(p.totalBytes), byClassMiB: Object.fromEntries(Object.entries(p.byClass).map(([k, v]) => [k, +(v / MIB).toFixed(2)])) });
          cells.push(`${(p.totalBytes / MIB).toFixed(0)} (${pct(p.totalBytes).toFixed(0)}%)`);
        }
        md.push(`| (${pol.key}) ${pol.name} | ${players} | ${cells.join(" | ")} |`);
      }
    }
    md.push("", "| Policy | Players under 85%, 1 season | 4 seasons | 1 season + 2% hostile | 4 seasons + 2% hostile |", "|---|---|---|---|---|");
    for (const pol of policies) {
      const fit = (seasons: number, hostile: boolean) => {
        let lo = 0;
        let hi = 200_000;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (projectStorage(load(mid, seasons, hostile), pol.costs, pol.policy, LIVE_BASELINE_BYTES).totalBytes <= QUOTA_85) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      };
      const f = [fit(1, false), fit(4, false), fit(1, true), fit(4, true)];
      rows.push({ shape, policy: pol.key, under85: f });
      md.push(`| (${pol.key}) ${pol.name} | ${f.map((x) => x.toLocaleString("en")).join(" | ")} |`);
    }
    // Where the bytes go at 1000 players, 4 seasons, for the most compact policy of this shape.
    const last = policies[policies.length - 1]!;
    const b = projectStorage(load(1000, 4, false), last.costs, last.policy, LIVE_BASELINE_BYTES);
    md.push("", `By class at 1000 players, 4 seasons, (${last.key}): ${Object.entries(b.byClass).map(([k, v]) => `${k} ${(v / MIB).toFixed(1)}`).join(", ")} MiB; baseline ${(LIVE_BASELINE_BYTES / MIB).toFixed(1)} MiB.`, "");
  }
  return { rows, markdown: md.join("\n") };
}

/** Old-versus-new measured table, scenario by scenario (same seeds, same synthetic players). */
function comparison(current: ScenarioResult[], baseline: ScenarioResult[]): string {
  const md = ["| Scenario | Shape | Pushes (normal / hostile) | Ledger rows | Ledger MiB | All 0011 tables MiB | movement_verifications MiB | Database MiB | Settle temp MiB (max day) | Settle ms (max day) |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of [...baseline, ...current].sort((a, b) => a.scenario.name.localeCompare(b.scenario.name) || (a.shape ?? "v1").localeCompare(b.shape ?? "v1"))) {
    const cp = r.checkpoints[r.checkpoints.length - 1]!;
    const tot = (pred: (t: TableSize) => boolean) => cp.tables.filter(pred).reduce((a, t) => a + t.total, 0) / MIB;
    const spill = r.settleSpill ?? [];
    md.push(`| ${r.scenario.name} | ${r.shape ?? "v1"} | ${r.pushes ? `${r.pushes.normal} / ${r.pushes.hostile}` : "–"} | ${lastRows(r, "gameplay_push_events")} | ${tot((t) => t.table === "gameplay_push_events").toFixed(1)} | ${tot((t) => r.proposedTables.includes(t.table)).toFixed(1)} | ${tot((t) => t.table === "movement_verifications").toFixed(1)} | ${(cp.databaseBytes / MIB).toFixed(1)} | ${(Math.max(0, ...spill.map((x) => x.tempBytes)) / MIB).toFixed(1)} | ${Math.max(0, ...spill.map((x) => x.ms))} |`);
  }
  return md.join("\n");
}

/* ── report ────────────────────────────────────────────────────────────── */

const fmt = (b: number | null | undefined) => (b === null || b === undefined ? "–" : b.toFixed(0));

function markdown(results: ScenarioResult[], proj: ReturnType<typeof projections>): string {
  const md: string[] = [];
  md.push(`# Gameplay storage bench (${PROFILE})`, "", `Proposed file: \`${PROPOSED}\`. PostgreSQL: see JSON. Written by scripts/gameplay-storage-bench.ts.`, "");
  for (const r of results) {
    const s = r.scenario;
    md.push(`## ${s.name}`, "", `${s.players} players${s.hostile ? ` + ${s.hostile.accounts} hostile` : ""}, ${s.days} days, res ${s.res}, ${s.density}; ${r.sessions} sessions applied (${r.hostileSessions} hostile); units/session mean ${r.unitsPerSession.mean.toFixed(1)}, p50 ${r.unitsPerSession.p50}, p95 ${r.unitsPerSession.p95}, max ${r.unitsPerSession.max}; ${r.seconds.toFixed(0)} s.`, "");
    const unmodelled = r.proposedTables.filter((t) => !MODELLED.has(t));
    if (unmodelled.length > 0) md.push(`**Unmodelled tables (not in the projection; extend capacity.ts):** ${unmodelled.join(", ")}.`, "");
    md.push(`Rule set ${s.rulesVersion}. 0011 creates ${r.proposedTables.length} tables and ${r.proposedIndexes.length} indexes; public tables ${r.publicTablesBefore} → ${r.publicTablesAfter}; empty 0011 schema ${r.emptySchema.gameplayBytes} bytes.`, "");
    md.push(`Outcomes: ${Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}. Day states per push ${r.dayStatesPerPush.toFixed(3)}; distinct units ${r.distinctUnits}; district map ${r.districtMapUnits} units, ${r.districts} districts; ${r.clubs} clubs.`, "");
    if (r.retries) md.push(`Retries: ${r.retries.replays} replays, rows ${r.retries.rowsBefore} → ${r.retries.rowsAfter}, bytes ${r.retries.bytesBefore} → ${r.retries.bytesAfter}.`, "");
    md.push("| Checkpoint day | Table | Rows | Heap | Indexes | TOAST | Total | B/row | Marginal B/row | Dead |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const cp of r.checkpoints) {
      for (const t of cp.tables.filter((x) => r.proposedTables.includes(x.table) || ["movement_verifications", "auth_sessions", "security_audit_events"].includes(x.table))) {
        md.push(`| ${cp.day} | ${t.table} | ${t.rows} | ${t.heap} | ${t.indexes} | ${t.toast} | ${t.total} | ${fmt(t.bytesPerRow)} | ${fmt(marginal(r, t))} | ${t.deadTuples} |`);
      }
      md.push(`| ${cp.day} | **database** | | | | | ${cp.databaseBytes} | | | |`);
      if (cp.compact) {
        for (const t of cp.compact.filter((x) => r.proposedTables.includes(x.table) || x.table === "movement_verifications")) {
          md.push(`| ${cp.day} (VACUUM FULL) | ${t.table} | ${t.rows} | ${t.heap} | ${t.indexes} | ${t.toast} | ${t.total} | ${fmt(t.bytesPerRow)} | ${fmt(marginal(r, t))} | |`);
        }
        md.push(`| ${cp.day} (VACUUM FULL) | **database** | | | | | ${cp.compactDatabaseBytes} | | | |`);
      }
    }
    md.push("", `Push event indexes: ${r.pushEventIndexes.map((i) => `${i.index} ${i.bytes}`).join(", ")}.`, "");
    if (r.challengeSamples?.length) {
      md.push(`gameplay_unit_challenges each day, before any measurement VACUUM (${r.challengeVacuums ?? 0} plain VACUUMs of the table): ${r.challengeSamples.map((x) => `d${x.day} ${(x.bytes / MIB).toFixed(2)} MiB, ${x.live} live, ${x.dead} dead`).join("; ")}.`, "");
    }
    if (r.authFootprint) md.push(`Auth footprint: audit ${r.authFootprint.auditBytesPerRow.toFixed(0)} B/row, auth session ${r.authFootprint.authSessionBytesPerRow.toFixed(0)} B/row (${r.authFootprint.rows} rows each).`, "");
    if (r.alternatives) md.push("Alternatives:", "", "```json", JSON.stringify(r.alternatives, null, 2), "```", "");
    if (r.shape) {
      md.push(`Shape ${r.shape}. Pushes ${JSON.stringify(r.pushes)}. Hostile outcomes ${JSON.stringify(r.hostileOutcomes ?? {})}.`, "");
      if (r.emptyPartition) md.push(`Partitions ${r.partitions}; empty day partition ${JSON.stringify(r.emptyPartition)} bytes.`, "");
      md.push("Takers lookup:", "", "```json", JSON.stringify(r.takers, null, 2), "```", "", "Reclaim:", "", "```json", JSON.stringify(r.reclaim, null, 2), "```", "");
      md.push(`Erasure: ${JSON.stringify(r.erasure)}. Settlement spill by day: ${(r.settleSpill ?? []).map((x) => `d${x.day} ${x.tempFiles} files ${x.tempBytes} B ${x.ms} ms`).join("; ")}.`, "");
    }
    if (r.explain) {
      md.push("Query plans (auto_explain, ANALYZE):", "");
      for (const [name, qs] of Object.entries(r.explain)) {
        md.push(`### ${name}`, "");
        for (const q of qs) md.push(`- ${q.executionMs ?? "?"} ms: \`${q.query.slice(0, 160)}\``);
        md.push("", "```", qs.map((q) => q.plan.trim()).join("\n\n"), "```", "");
      }
    }
  }
  md.push("## Projection", "", "MiB and % of a 500 MiB quota, including the 11.8 MiB live baseline. 60% of players active a day, 1.5 sessions per active day, 6 token refreshes per active day, a 1,000 km² play area.", "", proj.markdown, "");
  return md.join("\n");
}

function extraSections(results: ScenarioResult[]): string {
  const b = arg("baseline");
  const baseline = b ? (JSON.parse(readFileSync(b, "utf8")) as { results: ScenarioResult[] }).results : null;
  if (!baseline && !results.some((r) => r.shape === "v2")) return "";
  const cap = capacityProjections(results, baseline);
  capacityRows = cap.rows;
  return ["## Capacity (revision 2 decision)", "", "MiB and % of a 500 MiB quota, everything included (gameplay, movement sessions and cell lists, auth sessions, security audit, 11.8 MiB live baseline). Rule set 1002, resolution 10, 60% active, 1.5 sessions per active day, 6 token refreshes per active day, 1,000 km² play area.", "",
    cap.markdown, "", ...(baseline ? ["## Old versus new, measured", "", comparison(results, baseline), ""] : [])].join("\n");
}
let capacityRows: Record<string, unknown>[] = [];

async function main() {
  const from = arg("from");
  if (from) {
    // Re-project and re-render saved measurements (after a model change) without re-running the scenarios.
    const saved = JSON.parse(readFileSync(from, "utf8")) as { results: ScenarioResult[] };
    const proj = projections(saved.results);
    const md = markdown(saved.results, proj) + "\n" + extraSections(saved.results);
    const mdOut = arg("markdown");
    if (mdOut) writeFileSync(mdOut, md);
    else console.log(md);
    const out = arg("out");
    if (out) writeFileSync(out, JSON.stringify({ ...saved, costs: Object.fromEntries(saved.results.map((r) => [r.scenario.name, costsFrom(r)])), projection: proj.rows, capacity: proj.capacity, capacityV2: capacityRows }, null, 2));
    return;
  }
  const scenarios = (PROFILES[PROFILE] ?? []).filter((s) => !ONLY || s.name === ONLY);
  if (scenarios.length === 0) throw new Error(`no scenario for profile ${PROFILE}${ONLY ? ` and --only ${ONLY}` : ""}`);
  await loadService();
  const admin = new pg.Pool({ connectionString: URL_ENV });
  const version = (await admin.query("SELECT version() AS v, current_setting('block_size') AS b")).rows[0];
  await admin.end();
  console.error(`Bench on ${version.v} (block ${version.b}); proposed ${PROPOSED}; resolution check ${getResolution(latLngToCell(CENTER.lat, CENTER.lng, 10))}`);
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    console.error(`scenario ${s.name}`);
    results.push(await runScenario(s));
  }
  const proj = projections(results);
  const extra = extraSections(results);
  const report = { ranAt: new Date().toISOString(), postgres: version.v, blockSize: Number(version.b), profile: PROFILE, proposed: PROPOSED,
    liveBaselineBytes: LIVE_BASELINE_BYTES, results, costs: Object.fromEntries(results.map((r) => [r.scenario.name, costsFrom(r)])), projection: proj.rows, capacity: proj.capacity, capacityV2: capacityRows, serviceRoot: BACKEND };
  const out = arg("out");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  const md = markdown(results, proj) + "\n" + extra;
  const mdOut = arg("markdown");
  if (mdOut) writeFileSync(mdOut, md);
  else console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
