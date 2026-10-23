/**
 * Gameplay retention DRY RUN. Reports the day partitions and rows a proposed
 * retention policy WOULD drop, delete or null on a LOCAL PostgreSQL, and
 * changes nothing. PROPOSAL / OWNER DECISION: the TTLs are planning
 * assumptions (docs/G34_DATA_LIFECYCLE.md), not live policy.
 *
 *   MOVENRUN_RETENTION_DRYRUN_DATABASE_URL=postgres://user@127.0.0.1:5432/db \
 *     node --import tsx scripts/gameplay-retention-dryrun.ts [--as-of-day N] \
 *       [--raw-days 14] [--proof-days 120] [--session-path-days 14] \
 *       [--cell-list-days 14] [--movement-summary-days 120] \
 *       [--audit-routine-days 30] [--audit-security-days 180] \
 *       [--hold-days 20370,20371] [--json]
 *
 * Safety (src/gameplay/retentionDryRun.ts, tested in retentionDryRun.test.ts):
 *  - a URL whose host is not localhost, 127.0.0.1, ::1 or a Unix socket is
 *    refused before any connection is made;
 *  - everything runs in one READ ONLY transaction that is rolled back;
 *  - every statement is checked first and DROP, DELETE, TRUNCATE (and every
 *    other write or DDL keyword) is refused.
 * The URL is read from the environment, never from an argument, so it does
 * not land in shell history or process listings.
 */
import pg from "pg";
import { DAY_MS } from "../src/gameplay/rules.js";
import {
  assertLocalDatabaseUrl, evaluateRetention, PLANNING_POLICY, renderReport, validatePolicy, type RetentionDryRunPolicy,
} from "../src/gameplay/retentionDryRun.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function intArg(name: string, fallback: number): number {
  const v = arg(name);
  if (v === undefined) return fallback;
  if (!/^[0-9]+$/.test(v)) throw new Error(`--${name} must be a whole number`);
  return Number(v);
}

async function main(): Promise<void> {
  const url = process.env.MOVENRUN_RETENTION_DRYRUN_DATABASE_URL ?? "";
  if (!url) {
    console.error("MOVENRUN_RETENTION_DRYRUN_DATABASE_URL is not set (a local PostgreSQL URL).");
    process.exit(2);
  }
  try {
    assertLocalDatabaseUrl(url);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
  const holds = arg("hold-days");
  const policy: RetentionDryRunPolicy = {
    asOfDay: intArg("as-of-day", Math.floor(Date.now() / DAY_MS)),
    rawDays: intArg("raw-days", PLANNING_POLICY.rawDays),
    proofDays: intArg("proof-days", PLANNING_POLICY.proofDays),
    sessionPathDays: intArg("session-path-days", PLANNING_POLICY.sessionPathDays),
    cellListDays: intArg("cell-list-days", PLANNING_POLICY.cellListDays),
    movementSummaryDays: intArg("movement-summary-days", PLANNING_POLICY.movementSummaryDays),
    auditRoutineDays: intArg("audit-routine-days", PLANNING_POLICY.auditRoutineDays),
    auditSecurityDays: intArg("audit-security-days", PLANNING_POLICY.auditSecurityDays),
    holdDays: holds ? holds.split(",").map((d) => {
      if (!/^[0-9]+$/.test(d.trim())) throw new Error("--hold-days takes comma-separated day indexes");
      return Number(d.trim());
    }) : [],
  };
  const problems = validatePolicy(policy);
  if (problems.length > 0) {
    console.error(`Invalid policy: ${problems.join("; ")}`);
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url, application_name: "movenrun-retention-dryrun" });
  await client.connect();
  try {
    const report = await evaluateRetention(client, policy);
    console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : renderReport(report));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
