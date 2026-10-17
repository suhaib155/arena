/** Gameplay rules, the flag, and static checks on the proposed migration. No database needed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DAY_MS, PILOT_PROPOSAL, dayOf, dayStartMs, gameplayRulesFromEnv, lastClosedDay, seasonOf } from "./rules.js";

const drizzleDir = new URL("../../drizzle/", import.meta.url);
const proposedDir = new URL("../../drizzle-proposed/", import.meta.url);
const up = readFileSync(new URL("0011_gameplay_holdings.sql", proposedDir), "utf8");
const down = readFileSync(new URL("0011_gameplay_holdings.down.sql", proposedDir), "utf8");

test("gameplay is off unless MOVENRUN_GAMEPLAY_ENABLED is exactly true", () => {
  for (const value of [undefined, "", "1", "TRUE", "yes", "false", " true"]) {
    assert.equal(gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: value, MOVENRUN_GAMEPLAY_SEASON_START_DAY: "20000" }), null, String(value));
  }
  const rules = gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: "true", MOVENRUN_GAMEPLAY_SEASON_START_DAY: "20000" });
  assert.equal(rules?.seasonOneStartDay, 20000);
  assert.equal(rules?.ruleset, PILOT_PROPOSAL.ruleset);
});

test("enabled without a season start (D1) refuses to start instead of guessing", () => {
  for (const value of [undefined, "", "-1", "1.5", "soon"]) {
    assert.throws(() => gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: "true", MOVENRUN_GAMEPLAY_SEASON_START_DAY: value }), /SEASON_START_DAY/);
  }
});

test("day attribution, seasons and day close follow the pilot clock", () => {
  const rules = { ...PILOT_PROPOSAL, seasonOneStartDay: 100 };
  assert.equal(dayOf(rules, 100 * DAY_MS), 100);
  assert.equal(dayOf(rules, 101 * DAY_MS - 1), 100);
  assert.equal(dayStartMs(rules, 100), 100 * DAY_MS);
  assert.equal(dayOf({ dayOffsetMinutes: 330 }, 100 * DAY_MS - 330 * 60_000), 100);
  assert.equal(seasonOf(rules, 99), null);
  assert.equal(seasonOf(rules, 100), 1);
  assert.equal(seasonOf(rules, 189), 1);
  assert.equal(seasonOf(rules, 190), 2);
  // Day 100 closes at midnight plus the two-hour grace.
  assert.equal(lastClosedDay(rules, 101 * DAY_MS + rules.dayCloseGraceMs - 1), 99);
  assert.equal(lastClosedDay(rules, 101 * DAY_MS + rules.dayCloseGraceMs), 100);
});

test("the pilot proposal keeps the owner's push rule and the source's fixed numbers", () => {
  assert.equal(PILOT_PROPOSAL.holding.shadeDecayMultiplier, 3); // SOURCE §4
  assert.equal(PILOT_PROPOSAL.economyRulesVersion, 1); // V3 economy numbers unchanged
  assert.ok(PILOT_PROPOSAL.districtControl.shadeWeight.numerator > 0); // SOURCE §4: shade counts
  assert.notEqual(PILOT_PROPOSAL.holding.rulesVersion, 9001); // never the simulator's version
});

test("0011 is proposed only: not in drizzle/, its journal or its checksums", () => {
  assert.ok(!readdirSync(drizzleDir).some((f) => f.startsWith("0011")));
  const journal = readFileSync(new URL("meta/_journal.json", drizzleDir), "utf8");
  const sums = readFileSync(new URL("CHECKSUMS.sha256", drizzleDir), "utf8");
  assert.ok(!journal.includes("0011") && !sums.includes("0011"));
  assert.ok(journal.includes("0010_google_sign_in_exchanges"), "0011 follows the live chain's latest migration");
});

test("0011 enables RLS on every table it creates, grants nothing to anon, and its rollback drops them all", () => {
  const created = [...up.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1]!);
  assert.equal(created.length, 11);
  for (const t of created) {
    assert.match(up, new RegExp(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`), t);
    assert.match(down, new RegExp(`DROP TABLE IF EXISTS "${t}"`), t);
    assert.ok(t.startsWith("gameplay_"), t);
  }
  assert.doesNotMatch(up, /\bGRANT\b[^;]*\bTO\s+anon\b/);
  assert.doesNotMatch(up, /\bGRANT\s+(ALL|INSERT|UPDATE|DELETE|TRUNCATE)/);
  assert.doesNotMatch(up, /\bFOR\s+(ALL|INSERT|UPDATE|DELETE)\b/, "no write policy for any role");
  // The rollback touches only what 0011 created.
  for (const m of down.matchAll(/DROP (TABLE|INDEX|FUNCTION) IF EXISTS (?:public\.)?"?([a-z_]+)"?/g)) {
    assert.ok(m[2]!.startsWith("gameplay_") || m[2] === "movement_verifications_verified_end_time_idx", m[2]);
  }
});
