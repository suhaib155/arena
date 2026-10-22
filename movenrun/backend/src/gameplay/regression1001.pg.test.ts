/**
 * Rule set 1001 regression on PostgreSQL: a fixed multi-day scenario through
 * the service (sessions, retries, concurrent applies, a flip, a refused
 * repeat push, a server batch, day close, reads), then the stored game state,
 * hashed.
 *
 * The stored shape changed with migration 0011 revisions 2 and 3 (bigint
 * units, player numbers, outcome codes, refusals as counters), so what is
 * hashed is the game state itself, in a shape both schemas can produce:
 * accepted pushes in ledger order (cell, walker, day, outcome, holders,
 * strengths, shade, rules version), units, end-of-day unit states, take
 * counters, open challenges, pinned day rules, settlement headers and credit
 * lines, plus every service result. Wall-clock columns, the internal event id
 * spelling and the settlement input digest (which hashes that spelling) are
 * left out. `projection()` reads either shape, and this file is
 * self-contained, so it can be copied onto commit 685852b (revision 1, before
 * rule set 1002's work and before the storage revisions) and run there; the
 * recorded value below was produced that way. Skipped without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gridDisk, latLngToCell } from "h3-js";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "../db/client.js";
import { DAY_MS, PILOT_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService } from "./service.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the 1001 PostgreSQL regression was NOT verified";
/** Recorded by running this file on 685852b (migration 0011 revision 1). */
const RECORDED = "47158902f93ae3dc3f573f0c0923a29a578c2d591b44db53f83487081b2c1f70";

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + hour * 3_600_000;
/** Resolution 8 cells: 1001 pushes the pipeline's stored cells as they are. */
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

let admin: pg.Pool;
let pool: pg.Pool;
let dbName: string;
let clock = at(D, 9);
let svc: GameplayService;

function sqlFile(path: string): string[] {
  return readFileSync(join(BACKEND, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
}

before(async () => {
  if (!DATABASE_URL) return;
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  admin.on("error", () => undefined);
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
      .catch((err: { code?: string }) => { if (err.code !== "23505" && err.code !== "42710") throw err; });
  }
  dbName = `rules_reg1001_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  pool.on("error", () => undefined);
  const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const s of [...journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)), ...sqlFile("drizzle-proposed/0011_gameplay_holdings.sql")]) await c.query(s);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  svc = new GameplayService({ db: drizzle(pool) as unknown as Db, rules: RULES, now: () => clock });
});
after(async () => {
  if (!DATABASE_URL) return;
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

async function walk(user: string, sid: string, endMs: number, units: string[]) {
  await pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time)
     VALUES ($1, $2, $3, 'verified', 2500, 1500, $4, $5, $6)`, [`mv-${sid}`, user, sid, units, endMs - 1_500_000, endMs]);
  return svc.applySession(user, sid);
}

/** The stored game state, in one shape for migration 0011 revision 1 (text ids) and revisions 2-3 (compact ids). */
async function projection(): Promise<unknown[]> {
  const rows = async (q: string) => (await pool.query(q)).rows;
  const common = async () => [
    await rows("SELECT day, season, ruleset, holding_rules_version, takeover_policy, take_budget, unit_zone_rule, config, config_digest FROM gameplay_day_rules ORDER BY day"),
    await rows(`SELECT day, season, status, ruleset, economy_rules_version, holding_rules_version, pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro,
      burned_micro, returned_micro, day_share_micro, players, problems, clubs_status, clubs_problems FROM gameplay_day_settlements ORDER BY day`),
    await rows("SELECT * FROM gameplay_credit_lines ORDER BY day, player_id"),
    await rows("SELECT user_id, day, applied, skipped, rejected FROM gameplay_applied_sessions WHERE user_id IS NOT NULL ORDER BY user_id, day, applied, skipped, rejected"),
  ];
  const compact = (await rows("SELECT 1 FROM information_schema.columns WHERE table_name = 'gameplay_units' AND column_name = 'unit'")).length > 0;
  if (compact) {
    const cell = (col: string) => `lpad(to_hex(${col}), 15, '0')`;
    return [
      await rows(`SELECT ${cell("e.unit")} AS cell, w.user_id AS walker, e.day, (ARRAY['claimed','reinforced','eroded','flipped'])[e.outcome] AS outcome,
          ph.user_id AS previous_holder, nh.user_id AS new_holder, e.strength_before, e.strength_after, e.shade_strength, e.holding_rules_version
        FROM gameplay_push_events e JOIN gameplay_players w ON w.player_no = e.walker_no
        LEFT JOIN gameplay_players ph ON ph.player_no = e.previous_holder_no LEFT JOIN gameplay_players nh ON nh.player_no = e.new_holder_no ORDER BY e.seq`),
      await rows(`SELECT ${cell("unit")} AS cell, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day, version, holding_rules_version
        FROM gameplay_units ORDER BY 1`),
      await rows(`SELECT ${cell("s.unit")} AS cell, s.day, p.user_id AS holder, s.strength, s.level, s.shade, s.deeded, s.masked, s.fortified, s.holding_rules_version
        FROM gameplay_unit_day_states s LEFT JOIN gameplay_players p ON p.player_no = s.holder_no ORDER BY 1, 2`),
      await rows("SELECT p.user_id AS walker, d.day, d.takes_used, d.holding_rules_version FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no ORDER BY 1, 2"),
      await rows(`SELECT ${cell("unit")} AS cell, walker_id, first_day, holding_rules_version FROM gameplay_unit_challenges ORDER BY 1, 2`),
      ...(await common()),
    ];
  }
  return [
    await rows(`SELECT unit_id AS cell, walker_id AS walker, day, outcome, previous_holder_id AS previous_holder, new_holder_id AS new_holder,
        strength_before, strength_after, CASE WHEN push_kind = 'shade' THEN shade_strength ELSE 0 END AS shade_strength, holding_rules_version
      FROM gameplay_push_events WHERE outcome IN ('claimed', 'reinforced', 'eroded', 'flipped') ORDER BY seq`),
    await rows(`SELECT unit_id AS cell, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day, version, holding_rules_version
      FROM gameplay_units ORDER BY 1`),
    await rows(`SELECT unit_id AS cell, day, holder_id AS holder, strength, level, ground = 'shade' AS shade, deeded, masked, fortified, holding_rules_version
      FROM gameplay_unit_day_states ORDER BY 1, 2`),
    await rows("SELECT walker_id AS walker, day, takes_used, holding_rules_version FROM gameplay_walker_days ORDER BY 1, 2"),
    await rows("SELECT unit_id AS cell, walker_id, first_day, holding_rules_version FROM gameplay_unit_challenges ORDER BY 1, 2"),
    ...(await common()),
  ];
}

test("1001 on PostgreSQL: the stored game state of a fixed scenario is the one recorded on 685852b", { skip: SKIP }, async () => {
  for (const u of ["ana", "ben", "cal", "dee"]) await pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
  const out: unknown[] = [];
  clock = at(D, 12);
  out.push(await walk("ana", "a0", at(D, 8), [C[2]!, C[0]!, C[1]!, C[0]!]));
  out.push(await walk("ben", "b0", at(D, 9), [C[1]!, C[3]!]));
  out.push(await walk("ben", "b1", at(D, 10), [C[1]!])); // one push a day on someone else's ground
  out.push(await walk("cal", "c0", at(D, 11), [C[3]!, C[4]!]));
  // Concurrent applies of one session: applied once.
  await pool.query(`INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time)
     VALUES ('mv-d0', 'dee', 'd0', 'verified', 900, 700, $1, $2, $3)`, [[C[0]!, C[5]!], at(D, 11.5) - 700_000, at(D, 11.5)]);
  const same = await Promise.all([1, 2, 3, 4, 5].map(() => svc.applySession("dee", "d0")));
  out.push(same.filter((r) => !r.replayed).length);
  clock = at(D + 1, 12);
  out.push(await walk("ana", "a1", at(D + 1, 8), [C[1]!, C[3]!]));
  out.push(await walk("cal", "c1", at(D + 1, 9), [C[0]!, C[2]!]));
  out.push(await svc.applyPushes([{ eventId: `srv-1:${C[6]!}`, unitId: C[6]!, walkerId: "dee", day: D + 1, push: { kind: "shade", strength: 20 } }]));
  clock = at(D + 2, 3);
  out.push(await svc.settleDueDays());
  out.push(await svc.myHoldings("ana"), await svc.myCredits("cal", 1), await svc.leaderboard("ben", 1, "player_credits"));
  out.push(...(await projection()));
  const fp = createHash("sha256").update(JSON.stringify(out)).digest("hex");
  if (process.env.MOVENRUN_PRINT_MEASUREMENTS) console.log(`1001 PostgreSQL fingerprint: ${fp}`);
  assert.equal(fp, RECORDED);
});
