/** Gameplay rules, the flag, and static checks on the proposed migration. No database needed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  DAY_MS, DEFAULT_RULES_VERSION, PILOT_PROPOSAL, RULESETS, SIM_PILOT_2_PROPOSAL, UnknownRulesVersionError, dayOf, dayStartMs, gameplayRulesFromEnv,
  isUnitUnder, lastClosedDay, rulesetDigest, rulesetFor, rulesetProblems, seasonOf, takeoverRuleOf,
} from "./rules.js";
import { VERIFIED_STEPS_V1 } from "./path.js";

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
  assert.equal(created.length, 14);
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

/* ── versioned rule sets ────────────────────────────────────────────────── */

const ON = { MOVENRUN_GAMEPLAY_ENABLED: "true", MOVENRUN_GAMEPLAY_SEASON_START_DAY: "20000" };

test("rule sets: 1001 (A9 immediate, no budget, unit = zone) is the default; 1002 is sim-pilot-2's three levers, selectable only by name", () => {
  assert.equal(DEFAULT_RULES_VERSION, 1001);
  assert.equal(gameplayRulesFromEnv(ON)?.holding.rulesVersion, 1001);
  assert.equal(gameplayRulesFromEnv(ON)?.takeover.name, "immediate");
  assert.equal(gameplayRulesFromEnv(ON)?.takeBudget, null);
  const p2 = gameplayRulesFromEnv({ ...ON, MOVENRUN_GAMEPLAY_RULES_VERSION: "1002" })!;
  assert.equal(p2.ruleset, "server-sim-pilot-2-proposal");
  assert.deepEqual(p2.takeover, {
    name: "two-day-challenge", policyVersion: 2, windowDays: 3, floor: 50, immediateBelowStrength: 30,
    secondPush: { rule: "min-elapsed-server-receipt", version: 1, minElapsedMs: 20 * 3_600_000 },
  });
  assert.deepEqual(p2.takeBudget, { perWalkerPerDay: 13, counting: "takes-v1", order: "walk-order-v1" });
  assert.deepEqual(p2.units, {
    unit: { kind: "h3", resolution: 10 }, zone: { kind: "h3-parent", resolution: 9 }, mixedHolderZone: "each-holder-holds-zone",
    source: { kind: "session-path", rule: VERIFIED_STEPS_V1 }, partition: "per-holder-min-level-v1",
  });
  assert.deepEqual(p2.dayAttribution, { rule: "d1-last-verified-fix", version: 1 }, "D1, named");
  // The same levers as the simulator's sim-pilot-2 (shared/src/sim/pilotRuleset.ts), under a server version.
  assert.deepEqual(p2.holding.takeover, { challenge: { windowDays: 3, floor: 50, immediateBelowStrength: 30 }, maxFlipsPerUnitPerDay: null });
  assert.notEqual(p2.holding.rulesVersion, 9002);
  // Everything else is 1001's: only the three levers differ.
  // (dayAttribution names D1 in 1002; 1001 runs the same D1 unnamed, so its recorded identity stays as it was.)
  const { ruleset: _a, holding: _b, takeover: _c, takeBudget: _d, units: _e, dayAttribution: _k, ...rest2 } = SIM_PILOT_2_PROPOSAL;
  const { ruleset: _f, holding: _g, takeover: _h, takeBudget: _i, units: _j, ...rest1 } = PILOT_PROPOSAL;
  assert.deepEqual(rest2, rest1);
  assert.deepEqual({ ...SIM_PILOT_2_PROPOSAL.holding, rulesVersion: 0, takeover: undefined }, { ...PILOT_PROPOSAL.holding, rulesVersion: 0, takeover: undefined });
});

test("rule sets: an unknown or malformed version fails closed, at start-up and on lookup", () => {
  for (const v of ["", "9002", "9001", "1003", "0", "abc", "1001 ", "-1"]) {
    assert.throws(() => gameplayRulesFromEnv({ ...ON, MOVENRUN_GAMEPLAY_RULES_VERSION: v }), /RULES_VERSION/, v);
  }
  for (const v of [9002, 1003, 0, "1001", null, undefined, Number.NaN]) assert.throws(() => rulesetFor(v), UnknownRulesVersionError, String(v));
  assert.equal(rulesetFor(1002), SIM_PILOT_2_PROPOSAL);
});

test("rule sets: every known set is valid, frozen in its identity, and a changed config is a different digest", () => {
  for (const [version, r] of RULESETS) {
    assert.equal(r.holding.rulesVersion, version);
    assert.deepEqual(rulesetProblems(r), [], r.ruleset);
    assert.ok(Object.isFrozen(r));
  }
  assert.notEqual(rulesetDigest(PILOT_PROPOSAL), rulesetDigest(SIM_PILOT_2_PROPOSAL));
  assert.equal(rulesetDigest({ ...SIM_PILOT_2_PROPOSAL }), rulesetDigest(SIM_PILOT_2_PROPOSAL), "key order and copies do not matter");
  assert.notEqual(rulesetDigest({ ...SIM_PILOT_2_PROPOSAL, takeBudget: { perWalkerPerDay: 12, counting: "takes-v1" } }), rulesetDigest(SIM_PILOT_2_PROPOSAL));
  // Season start and the per-run limits are not part of a rule set's identity.
  assert.equal(rulesetDigest({ ...SIM_PILOT_2_PROPOSAL, maxDaysPerRun: 5 }), rulesetDigest(SIM_PILOT_2_PROPOSAL));
});

test("rule sets: inconsistent or out-of-range sets are reported", () => {
  const p2 = SIM_PILOT_2_PROPOSAL;
  assert.ok(rulesetProblems({ ...p2, holding: { ...p2.holding, takeover: undefined } }).includes("holding.takeover does not match the takeover policy"));
  assert.ok(rulesetProblems({ ...p2, holding: { ...p2.holding, rulesVersion: 9002 } }).includes("9000-9999 are the simulator's versions"));
  const weak = { ...p2.takeover, floor: 35 } as const;
  assert.ok(rulesetProblems({ ...p2, takeover: weak, holding: { ...p2.holding, takeover: takeoverRuleOf(weak) } }).some((x) => x.includes("outlast")));
  assert.ok(rulesetProblems({ ...p2, takeBudget: { perWalkerPerDay: 0, counting: "takes-v1" } }).length > 0);
  assert.ok(rulesetProblems({ ...p2, units: { ...p2.units, zone: { kind: "h3-parent", resolution: 10 } } }).length > 0);
  assert.ok(rulesetProblems({ ...p2, units: { unit: { kind: "stored" }, zone: { kind: "h3-parent", resolution: 9 }, mixedHolderZone: "each-holder-holds-zone" } }).length > 0);
});

test("D5 units: 1002 accepts only resolution 10 cells; 1001 takes the stored cells as they are", () => {
  const res10 = "8a194ad14c07fff";
  const res9 = "89194ad14c3ffff";
  const res8 = "88194ad14dfffff";
  assert.ok(isUnitUnder(SIM_PILOT_2_PROPOSAL.units, res10));
  for (const bad of [res9, res8, "u-1", "", "8a194ad14c07ff"]) assert.ok(!isUnitUnder(SIM_PILOT_2_PROPOSAL.units, bad), bad);
  for (const any of [res10, res9, res8, "u-1"]) assert.ok(isUnitUnder(PILOT_PROPOSAL.units, any), any);
  assert.ok(!isUnitUnder(PILOT_PROPOSAL.units, "x".repeat(65)));
});

test("0011: the rule, counter and challenge tables are server only, and the rollback says it destroys the gameplay record", () => {
  for (const t of ["gameplay_day_rules", "gameplay_walker_days", "gameplay_unit_challenges"]) {
    assert.doesNotMatch(up, new RegExp(`GRANT[^;]*ON public\\.${t}\\b`), t);
    assert.doesNotMatch(up, new RegExp(`CREATE POLICY[^;]*ON "${t}"`), t);
  }
  assert.match(up, /REFERENCES "gameplay_day_rules" \("day", "holding_rules_version"\)/);
  assert.match(down, /NOT A HARMLESS ROLLBACK/);
  assert.match(down, /permanently destroys every gameplay/);
});
