/**
 * Rule set 1001 regression on PostgreSQL: a fixed multi-day scenario through
 * the service (sessions, retries, concurrent applies, a flip, a refused
 * repeat push, day close, reads), then every stored gameplay row that does
 * not carry a wall-clock timestamp, hashed. The value was recorded by running
 * this same file on the code before rule set 1002's path, day-boundary,
 * walk-order and zone partition work (commit 685852b). Skipped without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DAY_MS, PILOT_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService } from "./service.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the 1001 PostgreSQL regression was NOT verified";
const RECORDED = "1f182b602965e7cd5041e2c5ba6c969c2f5cc8048a26e10855c6dc76294a500a";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + hour * 3_600_000;

let t: TestDb;
let clock = at(D, 9);
let svc: GameplayService;

before(async () => {
  if (!DATABASE_URL) return;
  t = await createTestDb(DATABASE_URL, "rules_reg1001", { gameplay: true, sessionPaths: false });
  svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
});
after(async () => {
  if (DATABASE_URL) await t.drop();
});

async function walk(user: string, sid: string, endMs: number, units: string[]) {
  await t.pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time)
     VALUES ($1, $2, $3, 'verified', 2500, 1500, $4, $5, $6)`, [`mv-${sid}`, user, sid, units, endMs - 1_500_000, endMs]);
  return svc.applySession(user, sid);
}

test("1001 on PostgreSQL: the stored record of a fixed scenario is the recorded one", { skip: SKIP }, async () => {
  for (const u of ["ana", "ben", "cal", "dee"]) await t.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
  const out: unknown[] = [];
  clock = at(D, 12);
  out.push(await walk("ana", "a0", at(D, 8), ["u-03", "u-01", "u-02", "u-01"]));
  out.push(await walk("ben", "b0", at(D, 9), ["u-02", "u-04"]));
  out.push(await walk("ben", "b1", at(D, 10), ["u-02"])); // one push a day on someone else's ground
  out.push(await walk("cal", "c0", at(D, 11), ["u-04", "u-05"]));
  // Concurrent applies of one session: applied once.
  await t.pool.query(`INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time)
     VALUES ('mv-d0', 'dee', 'd0', 'verified', 900, 700, $1, $2, $3)`, [["u-01", "u-06"], at(D, 11.5) - 700_000, at(D, 11.5)]);
  const same = await Promise.all([1, 2, 3, 4, 5].map(() => svc.applySession("dee", "d0")));
  out.push(same.filter((r) => !r.replayed).length);
  clock = at(D + 1, 12);
  out.push(await walk("ana", "a1", at(D + 1, 8), ["u-02", "u-04"]));
  out.push(await walk("cal", "c1", at(D + 1, 9), ["u-01", "u-03"]));
  out.push(await svc.applyPushes([{ eventId: "srv-1", unitId: "u-07", walkerId: "dee", day: D + 1, push: { kind: "shade", strength: 20 } }]));
  clock = at(D + 2, 3);
  out.push(await svc.settleDueDays());
  out.push(await svc.myHoldings("ana"), await svc.myCredits("cal", 1), await svc.leaderboard("ben", 1, "player_credits"));

  const dump = async (q: string) => (await t.pool.query(q)).rows;
  out.push(
    await dump("SELECT event_id, seq, unit_id, walker_id, day, push_kind, shade_strength, outcome, previous_holder_id, new_holder_id, strength_before, strength_after, holding_rules_version, source_session_id FROM gameplay_push_events ORDER BY seq"),
    await dump("SELECT unit_id, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day, version, holding_rules_version FROM gameplay_units ORDER BY unit_id"),
    await dump("SELECT * FROM gameplay_unit_day_states ORDER BY unit_id, day"),
    await dump("SELECT movement_verification_id, user_id, day, applied, skipped, rejected, outcomes, holding_rules_version FROM gameplay_applied_sessions ORDER BY movement_verification_id"),
    await dump("SELECT day, season, ruleset, holding_rules_version, takeover_policy, take_budget, unit_zone_rule, config, config_digest FROM gameplay_day_rules ORDER BY day"),
    await dump("SELECT walker_id, day, holding_rules_version, takes_used FROM gameplay_walker_days ORDER BY walker_id, day"),
    await dump("SELECT * FROM gameplay_unit_challenges ORDER BY unit_id, walker_id"),
    await dump(`SELECT day, season, status, ruleset, economy_rules_version, holding_rules_version, pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro,
      burned_micro, returned_micro, day_share_micro, players, problems, clubs_status, clubs_problems, input_digest FROM gameplay_day_settlements ORDER BY day`),
    await dump("SELECT * FROM gameplay_credit_lines ORDER BY day, player_id"),
  );
  const fp = createHash("sha256").update(JSON.stringify(out)).digest("hex");
  if (process.env.MOVENRUN_PRINT_MEASUREMENTS) console.log(`1001 PostgreSQL fingerprint: ${fp}`);
  assert.equal(fp, RECORDED);
});
