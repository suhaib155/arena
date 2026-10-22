/**
 * Gameplay retention DRY RUN (G34_DATA_LIFECYCLE.md). Reports what a proposed
 * retention policy WOULD drop, delete or null, and never does any of it.
 *
 * PROPOSAL / OWNER DECISION: every TTL here is a planning assumption, not
 * live policy. No retention job exists; this module only counts.
 *
 * Guarantees, each enforced in code and covered by retentionDryRun.test.ts:
 *  - The database URL must point at this machine (localhost, 127.0.0.1, ::1
 *    or a Unix socket), the same rule as scripts/gameplay-storage-bench.ts.
 *    Anything else is refused before a connection is made.
 *  - Everything runs inside one transaction opened with BEGIN and then
 *    `SET TRANSACTION READ ONLY`, and is ended with ROLLBACK. PostgreSQL
 *    itself then refuses any write (SQLSTATE 25006).
 *  - Every statement passes through `assertReadOnlySql` first, which refuses
 *    DROP, DELETE, TRUNCATE and every other write or DDL keyword. Values are
 *    always bound parameters; the only identifiers interpolated are partition
 *    names read from the catalog and re-checked against a strict pattern.
 *
 * Nothing here is imported by the service, the router or the wiring, and the
 * gameplay flag (MOVENRUN_GAMEPLAY_ENABLED) is not read.
 */
import { DAY_MS } from "./rules.js";

/* ── local-only guard ──────────────────────────────────────────────────── */

export class NonLocalDatabaseError extends Error {
  constructor(host: string) {
    super(`Refusing ${host || "(empty host)"}: the retention dry run only runs against a local PostgreSQL.`);
    this.name = "NonLocalDatabaseError";
  }
}

/** Throws unless `url` is a postgres URL whose host is localhost, 127.0.0.1, ::1 or a Unix socket directory. */
export function assertLocalDatabaseUrl(url: string, env: Record<string, string | undefined> = process.env): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new NonLocalDatabaseError("(unparseable URL)");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new NonLocalDatabaseError(u.protocol);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const socketHost = u.searchParams.get("host") ?? "";
  // libpq lets a `host` query parameter override the authority; only a socket directory is accepted there.
  if (socketHost && !socketHost.startsWith("/")) throw new NonLocalDatabaseError(socketHost);
  const local = ["localhost", "127.0.0.1", "::1"].includes(host) || (host === "" && socketHost.startsWith("/"));
  if (!local) throw new NonLocalDatabaseError(u.hostname);
  for (const k of ["hostaddr", "service"]) {
    if (u.searchParams.has(k)) throw new NonLocalDatabaseError(`${k}=${u.searchParams.get(k)}`);
  }
  // libpq-style environment overrides could redirect the connection; refuse any that do not point at this machine.
  for (const k of ["PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE"]) {
    if (env[k]) throw new NonLocalDatabaseError(`${k}=${env[k]}`);
  }
  const pgHost = env.PGHOST ?? "";
  if (pgHost && !pgHost.startsWith("/") && !["localhost", "127.0.0.1", "::1"].includes(pgHost)) throw new NonLocalDatabaseError(`PGHOST=${pgHost}`);
}

/* ── read-only SQL guard ───────────────────────────────────────────────── */

export class DestructiveSqlError extends Error {
  constructor(keyword: string) {
    super(`retention dry run refused a statement containing ${keyword}`);
    this.name = "DestructiveSqlError";
  }
}

/** Write, DDL and maintenance keywords the dry run must never send. */
export const FORBIDDEN_SQL_KEYWORDS = Object.freeze([
  "DROP", "DELETE", "TRUNCATE", "UPDATE", "INSERT", "MERGE", "ALTER", "CREATE", "GRANT", "REVOKE",
  "VACUUM", "CLUSTER", "REINDEX", "COPY", "CALL", "DO", "LOCK", "COMMIT", "REFRESH", "COMMENT",
  "SECURITY", "NEXTVAL", "SETVAL", "LO_UNLINK", "PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND",
]);

/** The only statements allowed to open and close the transaction. */
const CONTROL = new Set(["BEGIN", "SET TRANSACTION READ ONLY", "ROLLBACK", "SET LOCAL STATEMENT_TIMEOUT = '30S'"]);

/** Throws DestructiveSqlError unless `sql` is a read-only SELECT (or one of the transaction control statements). */
export function assertReadOnlySql(sql: string): void {
  const flat = sql.replace(/\s+/g, " ").trim();
  if (CONTROL.has(flat.toUpperCase())) return;
  // Literals and comments are checked too: nothing is stripped, so a keyword
  // inside a string is refused as well (values are always bound parameters).
  const upper = flat.toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(upper)) throw new DestructiveSqlError(upper.split(" ")[0] ?? "(empty)");
  if (upper.includes(";")) throw new DestructiveSqlError(";");
  for (const k of FORBIDDEN_SQL_KEYWORDS) {
    if (new RegExp(`(^|[^A-Z0-9_])${k}([^A-Z0-9_]|$)`).test(upper)) throw new DestructiveSqlError(k);
  }
  // SELECT ... FOR UPDATE / FOR SHARE would take row locks.
  if (/\bFOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE|KEY\s+SHARE)\b/.test(upper)) throw new DestructiveSqlError("FOR UPDATE/SHARE");
}

/* ── policy ────────────────────────────────────────────────────────────── */

/** PLANNING ASSUMPTIONS (G34_DATA_LIFECYCLE.md section 2), not live policy. */
export interface RetentionDryRunPolicy {
  /** Game day the policy is evaluated at (UTC day index, floor(ms / DAY_MS)). */
  asOfDay: number;
  /** Raw ledger and walker-day partitions, receipts and superseded snapshots: days kept after the day. */
  rawDays: number;
  /** Player-day proofs. */
  proofDays: number;
  /** gameplay_session_paths rows. */
  sessionPathDays: number;
  /** movement_verifications.traversed_hex_ids, then set to NULL. */
  cellListDays: number;
  /** movement_verifications summary rows (cascades to receipts and session paths). */
  movementSummaryDays: number;
  /** security_audit_events of type session_refreshed (X-25 proposal). */
  auditRoutineDays: number;
  /** Other security_audit_events, except the anonymous account_deleted rows, which are kept. */
  auditSecurityDays: number;
  /** Days under legal hold: never proposed for any action. */
  holdDays: readonly number[];
}

export const PLANNING_POLICY: Omit<RetentionDryRunPolicy, "asOfDay"> = Object.freeze({
  rawDays: 14,
  proofDays: 120,
  sessionPathDays: 14,
  cellListDays: 14,
  movementSummaryDays: 120,
  auditRoutineDays: 30,
  auditSecurityDays: 180,
  holdDays: Object.freeze([]) as readonly number[],
});

export function validatePolicy(p: RetentionDryRunPolicy): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(p.asOfDay) || p.asOfDay < 0) problems.push("asOfDay must be a non-negative integer day index");
  for (const k of ["rawDays", "proofDays", "sessionPathDays", "cellListDays", "movementSummaryDays", "auditRoutineDays", "auditSecurityDays"] as const) {
    if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 3650) problems.push(`${k} must be an integer from 1 to 3650`);
  }
  if (!p.holdDays.every((d) => Number.isInteger(d) && d >= 0)) problems.push("holdDays must be non-negative integer day indexes");
  // Coupling (G34_STORAGE_CAPACITY.md 9.2): deleting a movement summary cascades to its receipt and session path.
  if (p.movementSummaryDays < Math.max(p.rawDays, p.sessionPathDays)) problems.push("movementSummaryDays must be at least rawDays and sessionPathDays (the summary row cascades to receipts and session paths)");
  if (p.proofDays < p.rawDays) problems.push("proofDays must be at least rawDays (proofs must outlive the raw partitions they prove)");
  return problems;
}

/* ── report ────────────────────────────────────────────────────────────── */

export type DryRunActionKind = "drop_partition" | "delete_rows" | "null_column";

export interface DryRunFinding {
  /** What a retention job WOULD do. Never done here. */
  action: DryRunActionKind;
  target: string;
  /** Game day of the partition (drop_partition only). */
  day?: number;
  rows: number;
  /** Bytes a partition drop would return at once (drop_partition); row actions return none to the quota without VACUUM FULL. */
  bytes?: number;
  /** true when no blocker applies under the given policy. */
  eligible: boolean;
  blockers: string[];
}

export interface DryRunReport {
  dryRun: true;
  readOnlyTransaction: true;
  policy: RetentionDryRunPolicy;
  lastSettledDay: number | null;
  absentTables: string[];
  findings: DryRunFinding[];
  totals: { eligibleRows: number; eligiblePartitionBytes: number; blockedRows: number };
  notes: string[];
}

/** The minimum a pg client must offer. Every call goes through `guardedQuery`. */
export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const PARTITION_NAME = /^(gameplay_push_events|gameplay_walker_days)_d([0-9]{1,7})$/;

async function guardedQuery(c: QueryClient, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  assertReadOnlySql(sql);
  return (await c.query(sql, params)).rows;
}

/**
 * Runs `fn` inside BEGIN; SET TRANSACTION READ ONLY; ...; ROLLBACK. The
 * transaction is always rolled back, also on success: nothing it could have
 * done survives.
 */
export async function withReadOnlyTransaction<T>(c: QueryClient, fn: (q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
  await guardedQuery(c, "BEGIN");
  try {
    await guardedQuery(c, "SET TRANSACTION READ ONLY");
    await guardedQuery(c, "SET LOCAL statement_timeout = '30s'");
    const ro = await guardedQuery(c, "SELECT current_setting('transaction_read_only') AS ro");
    if (ro[0]?.ro !== "on") throw new Error("transaction is not read only; refusing to continue");
    return await fn((sql, params) => guardedQuery(c, sql, params));
  } finally {
    await guardedQuery(c, "ROLLBACK");
  }
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Evaluates `policy` against the database behind `c` and reports what it WOULD affect. Read only. Callers must pass a client they have already checked with `assertLocalDatabaseUrl`, as the CLI does. */
export async function evaluateRetention(c: QueryClient, policy: RetentionDryRunPolicy): Promise<DryRunReport> {
  const problems = validatePolicy(policy);
  if (problems.length > 0) throw new Error(`invalid policy: ${problems.join("; ")}`);
  const held = new Set(policy.holdDays);
  const cutoff = (days: number) => policy.asOfDay - days; // a day strictly below this is past its TTL

  return withReadOnlyTransaction(c, async (q) => {
    const findings: DryRunFinding[] = [];
    const absentTables: string[] = [];
    const notes: string[] = [
      "DRY RUN: nothing was dropped, deleted, truncated or updated. The transaction was READ ONLY and rolled back.",
      "Every TTL is a PROPOSAL / OWNER DECISION. No retention job, archive or manifest exists.",
    ];
    const exists = async (rel: string) => (await q("SELECT to_regclass($1) IS NOT NULL AS ok", [rel]))[0]?.ok === true;
    const tables = ["public.gameplay_day_settlements", "public.gameplay_push_events", "public.gameplay_walker_days", "public.gameplay_player_day_proofs",
      "public.gameplay_applied_sessions", "public.gameplay_session_paths", "public.gameplay_unit_day_states", "public.movement_verifications", "public.security_audit_events"];
    const present = new Set<string>();
    for (const t of tables) (await exists(t)) ? present.add(t) : absentTables.push(t);
    const has = (t: string) => present.has(`public.${t}`);

    let lastSettledDay: number | null = null;
    const settled = new Set<number>();
    if (has("gameplay_day_settlements")) {
      for (const r of await q("SELECT day FROM gameplay_day_settlements WHERE status = 'settled' ORDER BY day")) settled.add(num(r.day));
      lastSettledDay = settled.size > 0 ? Math.max(...settled) : null;
    }
    const dayBlockers = (day: number, ttlDays: number): string[] => {
      const b: string[] = [];
      if (day >= cutoff(ttlDays)) b.push("within_ttl");
      if (!settled.has(day)) b.push("day_not_settled");
      if (held.has(day)) b.push("legal_hold");
      return b;
    };

    // 1. Raw day partitions: ledger and walker days. A drop needs a settled day, a verified archive and no hold.
    if (has("gameplay_push_events") || has("gameplay_walker_days")) {
      const parts = await q(`SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
          FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'gameplay_partitions' AND p.relname IN ('gameplay_push_events', 'gameplay_walker_days')
         ORDER BY c.relname`);
      for (const p of parts) {
        const name = String(p.name);
        const m = PARTITION_NAME.exec(name);
        if (!m) {
          findings.push({ action: "drop_partition", target: `gameplay_partitions.${name}`, rows: 0, bytes: num(p.bytes), eligible: false, blockers: ["unrecognised_partition_name"] });
          continue;
        }
        const day = Number(m[2]);
        if (day >= cutoff(policy.rawDays)) continue; // inside the raw window: not a candidate, not reported
        const rows = num((await q(`SELECT count(*)::bigint AS n FROM gameplay_partitions."${name}"`))[0]?.n);
        const blockers = dayBlockers(day, policy.rawDays);
        blockers.push("no_verified_archive"); // the archive and manifest are not built (section 3 of the lifecycle doc)
        findings.push({ action: "drop_partition", target: `gameplay_partitions.${name}`, day, rows, bytes: num(p.bytes), eligible: false, blockers });
      }
      notes.push("Partition drops are always reported as blocked by no_verified_archive until an owner-approved archive and manifest exist.");
    }

    // Row-level candidates. Counts are split into eligible (settled, not held) and blocked.
    const byDay = async (target: string, sqlText: string, params: unknown[], ttl: number, action: DryRunActionKind = "delete_rows") => {
      const rows = await q(sqlText, params);
      let eligible = 0;
      const blocked = new Map<string, number>();
      for (const r of rows) {
        const day = num(r.day);
        const n = num(r.n);
        const b = dayBlockers(day, ttl).filter((x) => x !== "within_ttl");
        if (b.length === 0) eligible += n;
        else for (const x of b) blocked.set(x, (blocked.get(x) ?? 0) + n);
      }
      if (eligible > 0) findings.push({ action, target, rows: eligible, eligible: true, blockers: [] });
      for (const [b, n] of blocked) findings.push({ action, target, rows: n, eligible: false, blockers: [b] });
    };

    if (has("gameplay_player_day_proofs")) {
      await byDay("gameplay_player_day_proofs", "SELECT day, count(*)::bigint AS n FROM gameplay_player_day_proofs WHERE day < $1 GROUP BY day", [cutoff(policy.proofDays)], policy.proofDays);
    }
    if (has("gameplay_applied_sessions")) {
      await byDay("gameplay_applied_sessions", "SELECT day, count(*)::bigint AS n FROM gameplay_applied_sessions WHERE day < $1 GROUP BY day", [cutoff(policy.rawDays)], policy.rawDays);
    }
    if (has("gameplay_session_paths") && has("movement_verifications")) {
      await byDay("gameplay_session_paths", `SELECT floor(m.end_time / $2::float8)::int AS day, count(*)::bigint AS n
          FROM gameplay_session_paths sp JOIN movement_verifications m ON m.id = sp.movement_verification_id
         WHERE m.end_time < $1::bigint * $2::bigint GROUP BY 1`, [cutoff(policy.sessionPathDays), DAY_MS], policy.sessionPathDays);
    }
    if (has("gameplay_unit_day_states")) {
      // Superseded: a later state of the same unit exists on or before the last settled day. The latest state per unit is always kept.
      if (lastSettledDay !== null) {
        await byDay("gameplay_unit_day_states (superseded)", `SELECT s.day, count(*)::bigint AS n FROM gameplay_unit_day_states s
           WHERE s.day < $1 AND s.day <= $2
             AND EXISTS (SELECT 1 FROM gameplay_unit_day_states l WHERE l.unit = s.unit AND l.day > s.day AND l.day <= $2)
           GROUP BY s.day`, [cutoff(policy.rawDays), lastSettledDay], policy.rawDays);
      } else {
        notes.push("No settled day: no unit day state is superseded yet.");
      }
    }
    if (has("movement_verifications")) {
      await byDay("movement_verifications.traversed_hex_ids", `SELECT floor(end_time / $2::float8)::int AS day, count(*)::bigint AS n FROM movement_verifications
         WHERE traversed_hex_ids IS NOT NULL AND end_time < $1::bigint * $2::bigint GROUP BY 1`, [cutoff(policy.cellListDays), DAY_MS], policy.cellListDays, "null_column");
      await byDay("movement_verifications (summary rows)", `SELECT floor(end_time / $2::float8)::int AS day, count(*)::bigint AS n FROM movement_verifications
         WHERE end_time < $1::bigint * $2::bigint GROUP BY 1`, [cutoff(policy.movementSummaryDays), DAY_MS], policy.movementSummaryDays);
      if (has("gameplay_applied_sessions")) {
        const cascade = await q(`SELECT count(*)::bigint AS n FROM gameplay_applied_sessions a JOIN movement_verifications m ON m.id = a.movement_verification_id
           WHERE m.end_time < $1::bigint * $2::bigint`, [cutoff(policy.movementSummaryDays), DAY_MS]);
        const n = num(cascade[0]?.n);
        if (n > 0) notes.push(`Deleting those movement summaries would also cascade to ${n} gameplay_applied_sessions rows (ON DELETE CASCADE).`);
      }
    }
    if (has("security_audit_events")) {
      // Audit rows have no game day: blockers are only the TTL. account_deleted (anonymous) is always kept.
      const routine = await q(`SELECT count(*)::bigint AS n FROM security_audit_events WHERE event_type = 'session_refreshed' AND created_at < (now() - make_interval(days => $1::int))`, [policy.auditRoutineDays]);
      const sec = await q(`SELECT count(*)::bigint AS n FROM security_audit_events WHERE event_type NOT IN ('session_refreshed', 'account_deleted') AND created_at < (now() - make_interval(days => $1::int))`, [policy.auditSecurityDays]);
      for (const [target, r] of [["security_audit_events (session_refreshed)", routine], ["security_audit_events (security events)", sec]] as const) {
        const n = num(r[0]?.n);
        if (n > 0) findings.push({ action: "delete_rows", target, rows: n, eligible: false, blockers: ["x25_owner_decision"] });
      }
      notes.push("Audit ages are measured against the database clock (now()), not asOfDay.");
    }

    const totals = {
      eligibleRows: findings.filter((f) => f.eligible).reduce((a, f) => a + f.rows, 0),
      eligiblePartitionBytes: findings.filter((f) => f.eligible && f.action === "drop_partition").reduce((a, f) => a + (f.bytes ?? 0), 0),
      blockedRows: findings.filter((f) => !f.eligible).reduce((a, f) => a + f.rows, 0),
    };
    return { dryRun: true, readOnlyTransaction: true, policy, lastSettledDay, absentTables, findings, totals, notes };
  });
}

/** Markdown rendering of a report, for the CLI. */
export function renderReport(r: DryRunReport): string {
  const lines = [
    "# Gameplay retention DRY RUN (PROPOSAL / OWNER DECISION; nothing was changed)",
    "",
    `As of day ${r.policy.asOfDay}; last settled day ${r.lastSettledDay ?? "none"}. Raw ${r.policy.rawDays} d, proofs ${r.policy.proofDays} d, session paths ${r.policy.sessionPathDays} d, cell lists ${r.policy.cellListDays} d, movement summaries ${r.policy.movementSummaryDays} d, audit ${r.policy.auditRoutineDays}/${r.policy.auditSecurityDays} d, held days ${r.policy.holdDays.length}.`,
    "",
  ];
  if (r.absentTables.length > 0) lines.push(`Absent (not evaluated): ${r.absentTables.join(", ")}.`, "");
  lines.push("| Would | Target | Day | Rows | Bytes | Eligible | Blockers |", "|---|---|---|---|---|---|---|");
  for (const f of r.findings) lines.push(`| ${f.action} | ${f.target} | ${f.day ?? ""} | ${f.rows} | ${f.bytes ?? ""} | ${f.eligible ? "yes" : "no"} | ${f.blockers.join(", ")} |`);
  if (r.findings.length === 0) lines.push("| (nothing) | | | | | | |");
  lines.push("", `Totals: eligible rows ${r.totals.eligibleRows}, eligible partition bytes ${r.totals.eligiblePartitionBytes}, blocked rows ${r.totals.blockedRows}.`, "", ...r.notes.map((n) => `- ${n}`));
  return lines.join("\n");
}
