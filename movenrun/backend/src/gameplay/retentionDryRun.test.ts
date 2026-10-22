/**
 * The retention dry run never changes anything: it refuses non-local
 * databases before connecting, runs in a READ ONLY transaction that is rolled
 * back, and never emits DROP, DELETE, TRUNCATE or any other write.
 *
 * The PostgreSQL cases are skipped, loudly, when MOVENRUN_TEST_DATABASE_URL is
 * not set; the pure and fake-client cases always run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "./pgTestDb.js";
import {
  assertLocalDatabaseUrl, assertReadOnlySql, DestructiveSqlError, evaluateRetention, NonLocalDatabaseError, PLANNING_POLICY,
  validatePolicy, withReadOnlyTransaction, type QueryClient, type RetentionDryRunPolicy,
} from "./retentionDryRun.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the retention dry run was NOT verified against PostgreSQL";
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Independent of the module's own keyword list: the three statements the task forbids outright. */
const DESTRUCTIVE = /(^|[^a-z0-9_])(drop|delete|truncate)([^a-z0-9_]|$)/i;

const policy = (asOfDay: number, extra: Partial<RetentionDryRunPolicy> = {}): RetentionDryRunPolicy => ({ ...PLANNING_POLICY, asOfDay, ...extra });

test("only local database URLs are accepted", () => {
  for (const ok of [
    "postgres://u:p@localhost:5432/db",
    "postgresql://u@127.0.0.1/db",
    "postgres://u@[::1]:5432/db",
    "postgres:///db?host=/var/run/postgresql",
  ]) assert.doesNotThrow(() => assertLocalDatabaseUrl(ok), ok);
  for (const bad of [
    "postgres://u:p@db.abcdefgh.supabase.co:5432/postgres",
    "postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    "postgres://u@10.0.0.5/db",
    "postgres://u@192.168.1.2/db",
    "postgres://u@localhost.example.com/db",
    "postgres://u@127.0.0.2/db",
    "postgres://u@localhost/db?host=db.example.com",
    "postgres://u@localhost/db?hostaddr=203.0.113.9",
    "postgres://u@localhost/db?service=prod",
    "postgres://u@/db",
    "mysql://u@localhost/db",
    "not a url",
  ]) assert.throws(() => assertLocalDatabaseUrl(bad), NonLocalDatabaseError, bad);
});

test("the CLI refuses a non-local URL before connecting", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/gameplay-retention-dryrun.ts", "--as-of-day", "100"], {
    cwd: BACKEND,
    env: { ...process.env, MOVENRUN_RETENTION_DRYRUN_DATABASE_URL: "postgres://u:p@db.example.invalid:5432/postgres" },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Refusing db\.example\.invalid/);
  assert.doesNotMatch(r.stderr, /ENOTFOUND|ECONNREFUSED|getaddrinfo/); // it never tried to resolve or connect
});

test("the SQL guard refuses every write, DDL and multi-statement text", () => {
  for (const bad of [
    "DROP TABLE gameplay_partitions.gameplay_push_events_d1",
    "drop table x",
    "DELETE FROM gameplay_player_day_proofs WHERE day < 1",
    "TRUNCATE gameplay_applied_sessions",
    "UPDATE movement_verifications SET traversed_hex_ids = NULL",
    "INSERT INTO x VALUES (1)",
    "ALTER TABLE x DETACH PARTITION y",
    "VACUUM gameplay_unit_challenges",
    "SELECT 1; DROP TABLE x",
    "WITH d AS (DELETE FROM x RETURNING 1) SELECT count(*) FROM d",
    "SELECT * FROM gameplay_units FOR UPDATE",
    "SELECT pg_terminate_backend(1)",
    "SELECT nextval('gameplay_push_seq')",
    "COMMIT",
    "",
  ]) assert.throws(() => assertReadOnlySql(bad), DestructiveSqlError, bad);
  for (const ok of [
    "BEGIN", "SET TRANSACTION READ ONLY", "ROLLBACK",
    "SELECT count(*)::bigint AS n FROM security_audit_events WHERE event_type NOT IN ('session_refreshed', 'account_deleted')",
    "SELECT to_regclass($1) IS NOT NULL AS ok",
  ]) assert.doesNotThrow(() => assertReadOnlySql(ok), ok);
});

test("policy validation keeps the cascade and proof couplings", () => {
  assert.deepEqual(validatePolicy(policy(200)), []);
  assert.ok(validatePolicy(policy(200, { movementSummaryDays: 7 })).some((p) => p.includes("cascades")));
  assert.ok(validatePolicy(policy(200, { proofDays: 7 })).some((p) => p.includes("outlive")));
  assert.ok(validatePolicy(policy(-1)).length > 0);
});

/** A fake pg client: records every statement and answers the catalog and count queries with fixed rows. */
function fakeClient(opts: { readOnly?: string; failOn?: RegExp } = {}) {
  const sent: string[] = [];
  const client: QueryClient = {
    async query(sql: string) {
      sent.push(sql);
      if (opts.failOn?.test(sql)) throw new Error("boom");
      if (sql.includes("transaction_read_only")) return { rows: [{ ro: opts.readOnly ?? "on" }] };
      if (sql.includes("to_regclass")) return { rows: [{ ok: true }] };
      if (sql.includes("FROM gameplay_day_settlements")) return { rows: [{ day: 100 }, { day: 101 }, { day: 102 }] };
      if (sql.includes("pg_inherits")) {
        return { rows: [100, 101, 102, 103, 130].flatMap((d) => [
          { name: `gameplay_push_events_d${d}`, bytes: 131072 }, { name: `gameplay_walker_days_d${d}`, bytes: 65536 }]) };
      }
      if (sql.includes("GROUP BY")) return { rows: [{ day: 100, n: 7 }, { day: 103, n: 2 }] };
      if (sql.includes("count(*)")) return { rows: [{ n: 5 }] };
      return { rows: [] };
    },
  };
  return { client, sent };
}

test("evaluation opens a READ ONLY transaction, rolls it back, and emits no destructive SQL", async () => {
  const { client, sent } = fakeClient();
  const report = await evaluateRetention(client, policy(130, { holdDays: [101] }));
  assert.equal(sent[0], "BEGIN");
  assert.equal(sent[1], "SET TRANSACTION READ ONLY");
  assert.equal(sent[sent.length - 1], "ROLLBACK");
  assert.equal(sent.filter((s) => s === "ROLLBACK").length, 1);
  assert.ok(!sent.some((s) => /COMMIT/i.test(s)));
  for (const s of sent) assert.doesNotMatch(s, DESTRUCTIVE, s);
  assert.equal(report.dryRun, true);
  // Days 100-103 are past 14 days at day 130; day 130 is inside the window and not reported.
  const drops = report.findings.filter((f) => f.action === "drop_partition");
  assert.deepEqual([...new Set(drops.map((f) => f.day))], [100, 101, 102, 103]);
  assert.ok(drops.every((f) => !f.eligible && f.blockers.includes("no_verified_archive")));
  assert.ok(drops.find((f) => f.day === 101)!.blockers.includes("legal_hold"));
  assert.ok(drops.find((f) => f.day === 103)!.blockers.includes("day_not_settled"));
  // Row candidates: day 100 settled and not held is eligible; day 103 is blocked (not settled).
  const receipts = report.findings.filter((f) => f.target === "gameplay_applied_sessions");
  assert.deepEqual(receipts.map((f) => [f.rows, f.eligible]), [[7, true], [2, false]]);
});

test("a transaction that is not read only is refused, and a failure still rolls back", async () => {
  const notRo = fakeClient({ readOnly: "off" });
  await assert.rejects(evaluateRetention(notRo.client, policy(130)), /not read only/);
  assert.equal(notRo.sent[notRo.sent.length - 1], "ROLLBACK");
  const failing = fakeClient({ failOn: /pg_inherits/ });
  await assert.rejects(evaluateRetention(failing.client, policy(130)), /boom/);
  assert.equal(failing.sent[failing.sent.length - 1], "ROLLBACK");
  for (const s of [...notRo.sent, ...failing.sent]) assert.doesNotMatch(s, DESTRUCTIVE);
});

test("PostgreSQL: the dry run lists old partitions, drops nothing, and its transaction refuses writes", { skip: SKIP }, async () => {
  const t = await createTestDb(DATABASE_URL!, "retention_dryrun", { gameplay: true });
  try {
    await t.pool.query("SELECT gameplay_ensure_day_partitions(100, 130)");
    await t.pool.query(`INSERT INTO security_audit_events (id, event_type, created_at) VALUES ('a1', 'session_refreshed', now() - interval '40 days'),
      ('a2', 'account_deleted', now() - interval '400 days')`);
    const partitions = async () => Number((await t.pool.query(`SELECT count(*) AS n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gameplay_partitions' AND c.relkind = 'r'`)).rows[0].n);
    const before = await partitions();
    assert.equal(before, 62);

    const c = await t.pool.connect();
    const logged: string[] = [];
    const recording: QueryClient = { query: async (sql, params) => { logged.push(sql); return c.query(sql, params as unknown[]); } };
    try {
      const report = await evaluateRetention(recording, policy(140));
      // Days 100..125 are older than 14 days at day 140: 26 days x 2 tables, none settled, none archived.
      const drops = report.findings.filter((f) => f.action === "drop_partition");
      assert.equal(drops.length, 52);
      assert.ok(drops.every((f) => !f.eligible && f.blockers.includes("day_not_settled") && f.blockers.includes("no_verified_archive")));
      assert.deepEqual(report.absentTables, []);
      const audit = report.findings.find((f) => f.target === "security_audit_events (session_refreshed)");
      assert.equal(audit?.rows, 1);
      assert.ok(!report.findings.some((f) => f.target.includes("security events"))); // account_deleted is kept
      for (const s of logged) assert.doesNotMatch(s, DESTRUCTIVE, s);

      // The transaction it uses is enforced by PostgreSQL: a write inside it fails with 25006.
      await assert.rejects(
        withReadOnlyTransaction(recording, async () => c.query("DELETE FROM security_audit_events")),
        (err: { code?: string }) => err.code === "25006",
      );
      assert.equal((await c.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0].ro, "off"); // rolled back, session clean
    } finally {
      c.release();
    }
    assert.equal(await partitions(), before);
    assert.equal(Number((await t.pool.query("SELECT count(*) AS n FROM security_audit_events")).rows[0].n), 2);
  } finally {
    await t.drop();
  }
});

test("PostgreSQL: without 0011 the gameplay tables are reported absent, not created", { skip: SKIP }, async () => {
  const t = await createTestDb(DATABASE_URL!, "retention_dryrun_no0011", { gameplay: false });
  try {
    const c = await t.pool.connect();
    try {
      const report = await evaluateRetention(c as unknown as QueryClient, policy(140));
      assert.ok(report.absentTables.includes("public.gameplay_push_events"));
      assert.ok(!report.absentTables.includes("public.movement_verifications"));
    } finally {
      c.release();
    }
    assert.equal(Number((await t.pool.query("SELECT count(*) AS n FROM pg_tables WHERE tablename LIKE 'gameplay_%'")).rows[0].n), 0);
  } finally {
    await t.drop();
  }
});

test("refuses libpq environment overrides that point away from this machine", () => {
  const url = "postgres://u@localhost:5432/db";
  assert.throws(() => assertLocalDatabaseUrl(url, { PGHOST: "db.example.com" }), NonLocalDatabaseError);
  assert.throws(() => assertLocalDatabaseUrl(url, { PGHOSTADDR: "10.0.0.5" }), NonLocalDatabaseError);
  assert.throws(() => assertLocalDatabaseUrl(url, { PGSERVICE: "prod" }), NonLocalDatabaseError);
  assert.doesNotThrow(() => assertLocalDatabaseUrl(url, { PGHOST: "/var/run/postgresql" }));
  assert.doesNotThrow(() => assertLocalDatabaseUrl(url, {}));
});
