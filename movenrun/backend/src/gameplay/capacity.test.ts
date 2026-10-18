import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capacityTripwire, createCapacityGuard, DEFAULT_THRESHOLDS, DEFAULT_UNIT_BUDGET, gameplayCapacityFromEnv, KEEP_EVERYTHING, KEEP_EVERYTHING_V2, MIB, projectStorage, PROPOSED_RETENTION, remainingPushBudget, TTL_45_PER_PUSH_PROOF,
  type LoadProfile, type RowCosts,
} from "./capacity.js";

const COSTS: RowCosts = {
  pushEvent: 600, unitDayState: 300, unit: 550, appliedSession: 500, creditLine: 300, daySettlement: 900,
  clubDay: 250, districtDay: 300, unitDistrict: 110, movementBase: 450, movementPerCell: 19,
  securityAuditEvent: 270, authSession: 630, coarseProof: 70, playerDayProof: 90,
  dayRules: 2000, walkerDay: 150, unitChallenge: 120,
};

const LOAD: LoadProfile = {
  players: 1000, activeShare: 0.6, sessionsPerActiveDay: 1.5, unitsPerSession: 40, dayStatesPerPush: 0.5,
  distinctUnits: 60_000, districtMapUnits: 60_000, openChallenges: 6_000, walkerDaysPerActiveDay: 1, clubs: 100, districts: 28, auditRowsPerActiveDay: 6, days: 90,
};

/* ── projection ─────────────────────────────────────────────────────────── */

test("keep-everything projection is rows times measured bytes, class by class", () => {
  const p = projectStorage(LOAD, COSTS, KEEP_EVERYTHING, 0);
  const pushes = 1000 * 0.6 * 1.5 * 40 * 90;
  assert.equal(p.byClass.push_ledger, pushes * 600);
  assert.equal(p.byClass.unit_day_states, pushes * 0.5 * 300);
  assert.equal(p.byClass.units, 60_000 * 550);
  assert.equal(p.byClass.proofs, 0);
  assert.equal(p.byClass.take_counters, 1000 * 0.6 * 90 * 150);
  assert.equal(p.byClass.challenges, 6_000 * 120);
  assert.equal(p.byClass.movement_sessions, 1000 * 0.6 * 1.5 * 90 * 450 + pushes * 19);
  // Audit rows are kept (X-25 undecided); rotated auth sessions are already pruned after 37 days.
  assert.equal(p.byClass.auth_audit, 1000 * 0.6 * 6 * (90 * 270 + 37 * 630));
  const sum = Object.values(p.byClass).reduce((a, b) => a + b, 0);
  assert.equal(p.totalBytes, sum);
  assert.equal(p.gameplayBytes, sum - p.byClass.auth_audit!);
});

test("projection grows linearly with seasons when nothing is deleted", () => {
  const one = projectStorage(LOAD, COSTS, KEEP_EVERYTHING, 0);
  const four = projectStorage({ ...LOAD, days: 360 }, COSTS, KEEP_EVERYTHING, 0);
  // Units and the district map are fixed by the area; everything else scales.
  const fixed = one.byClass.units! + one.byClass.district_map! + one.byClass.challenges!;
  assert.ok(Math.abs(four.gameplayBytes - fixed - 4 * (one.gameplayBytes - fixed)) < 1e-3);
});

test("a 45-day TTL caps the raw ledger and keeps a coarse proof per push for the rest", () => {
  const kept = projectStorage({ ...LOAD, days: 360 }, COSTS, TTL_45_PER_PUSH_PROOF, 0);
  const perDay = 1000 * 0.6 * 1.5 * 40;
  assert.equal(kept.byClass.push_ledger, perDay * 45 * 600 * 1.15);
  assert.equal(kept.byClass.proofs, perDay * (360 - 45) * 70);
  // Over four seasons it keeps under 30% of what keeping everything would.
  const all = projectStorage({ ...LOAD, days: 360 }, COSTS, KEEP_EVERYTHING, 0);
  assert.ok(kept.totalBytes < 0.3 * all.totalBytes);
});

test("the proposal keeps 14 raw days in dropped partitions and one proof per player-day for 120 days", () => {
  const p = projectStorage({ ...LOAD, days: 360 }, COSTS, PROPOSED_RETENTION, 0);
  const perDay = 1000 * 0.6 * 1.5 * 40;
  assert.equal(p.byClass.push_ledger, perDay * 14 * 600, "partitions are dropped whole: no slack");
  assert.equal(p.byClass.proofs, 1000 * 0.6 * 120 * 90);
  assert.ok(Math.abs(p.byClass.applied_sessions! - 1000 * 0.6 * 1.5 * 14 * 500 * 1.15) < 1e-6);
  // One season and four seasons differ only by the durable aggregates and audit.
  const one = projectStorage(LOAD, COSTS, PROPOSED_RETENTION, 0);
  assert.equal(one.byClass.push_ledger, p.byClass.push_ledger);
  assert.ok(p.byClass.settlements! > one.byClass.settlements!);
});

test("hostile pushes add rows and are retained while inside the TTL", () => {
  const hostile = { accounts: 10, sessionsPerDay: 20, unitsPerSession: 500, days: 14 };
  const base = projectStorage(LOAD, COSTS, KEEP_EVERYTHING, 0);
  const attacked = projectStorage({ ...LOAD, hostile }, COSTS, KEEP_EVERYTHING, 0);
  assert.equal(attacked.byClass.push_ledger! - base.byClass.push_ledger!, 10 * 20 * 500 * 14 * 600);
  const retainedAttack = projectStorage({ ...LOAD, hostile }, COSTS, PROPOSED_RETENTION, 0);
  const retainedBase = projectStorage(LOAD, COSTS, PROPOSED_RETENTION, 0);
  assert.ok(retainedAttack.byClass.push_ledger! > retainedBase.byClass.push_ledger!);
});

test("quota fraction includes the baseline", () => {
  const p = projectStorage({ ...LOAD, players: 0 }, COSTS, KEEP_EVERYTHING, 250 * MIB);
  assert.ok(p.quotaFraction >= 0.5 && p.quotaFraction < 0.6);
});

/* ── tripwire ───────────────────────────────────────────────────────────── */

const Q = DEFAULT_THRESHOLDS.quotaBytes;

test("ok below the warn line with slow growth", () => {
  const d = capacityTripwire({ usedBytes: 0.3 * Q, dailyGrowthBytes: 1 * MIB });
  assert.equal(d.level, "ok");
  assert.equal(d.acceptPushes, true);
  assert.equal(d.pushBudgetFactor, 1);
  assert.ok(d.daysToHardStop !== null && d.daysToHardStop > 100);
});

test("each line is crossed at its fraction of the quota", () => {
  assert.equal(capacityTripwire({ usedBytes: 0.6 * Q, dailyGrowthBytes: 0 }).level, "warn");
  assert.equal(capacityTripwire({ usedBytes: 0.75 * Q, dailyGrowthBytes: 0 }).level, "backpressure");
  assert.equal(capacityTripwire({ usedBytes: 0.85 * Q, dailyGrowthBytes: 0 }).level, "hard_stop");
  assert.equal(capacityTripwire({ usedBytes: 0.5999 * Q, dailyGrowthBytes: 0 }).level, "ok");
});

test("fast growth escalates one level ahead of the line", () => {
  // 50% used, warn line 50 MiB away, growing 5 MiB a day: 10 days < 14.
  const d = capacityTripwire({ usedBytes: 0.5 * Q, dailyGrowthBytes: 5 * MIB });
  assert.equal(d.level, "warn");
  assert.ok(d.reasons.includes("warn_within_days"));
  // In backpressure and the hard stop is under a week away: stop now.
  const e = capacityTripwire({ usedBytes: 0.8 * Q, dailyGrowthBytes: 10 * MIB });
  assert.equal(e.level, "hard_stop");
  assert.equal(e.acceptPushes, false);
});

test("backpressure shrinks the push budget linearly toward a quarter", () => {
  const atLine = capacityTripwire({ usedBytes: 0.75 * Q, dailyGrowthBytes: 0 });
  assert.equal(atLine.pushBudgetFactor, 1);
  const nearStop = capacityTripwire({ usedBytes: 0.8499 * Q, dailyGrowthBytes: 0 });
  assert.ok(nearStop.pushBudgetFactor > 0.25 && nearStop.pushBudgetFactor < 0.26);
  assert.equal(nearStop.acceptPushes, true);
});

test("the reserve lowers the hard stop when it is larger than the margin above the fraction", () => {
  const t = { ...DEFAULT_THRESHOLDS, reserveBytes: 100 * MIB };
  // Hard stop at min(85%, quota - 100 MiB) = 400 MiB = 80%.
  assert.equal(capacityTripwire({ usedBytes: 0.81 * Q, dailyGrowthBytes: 0, thresholds: t }).level, "hard_stop");
});

test("fails closed on an unreadable size or a bad configuration", () => {
  assert.equal(capacityTripwire({ usedBytes: NaN, dailyGrowthBytes: 0 }).level, "hard_stop");
  assert.equal(capacityTripwire({ usedBytes: -1, dailyGrowthBytes: 0 }).acceptPushes, false);
  assert.equal(capacityTripwire({ usedBytes: 0, dailyGrowthBytes: 0, thresholds: { ...DEFAULT_THRESHOLDS, quotaBytes: 0 } }).reasons[0], "invalid_thresholds");
  assert.equal(capacityTripwire({ usedBytes: 0, dailyGrowthBytes: 0, thresholds: { ...DEFAULT_THRESHOLDS, warnFraction: 0.9 } }).level, "hard_stop");
  // Unknown growth is reported but does not by itself stop anything.
  const g = capacityTripwire({ usedBytes: 0.1 * Q, dailyGrowthBytes: NaN });
  assert.equal(g.level, "ok");
  assert.ok(g.reasons.includes("growth_unknown"));
});

test("remaining push budget", () => {
  const ok = capacityTripwire({ usedBytes: 0, dailyGrowthBytes: 0 });
  assert.equal(remainingPushBudget(300, 120, ok), 180);
  assert.equal(remainingPushBudget(300, 400, ok), 0);
  const stop = capacityTripwire({ usedBytes: Q, dailyGrowthBytes: 0 });
  assert.equal(remainingPushBudget(300, 0, stop), 0);
  const half = { acceptPushes: true, pushBudgetFactor: 0.5 };
  assert.equal(remainingPushBudget(300, 100, half), 50);
  assert.equal(remainingPushBudget(0, 0, ok), 0);
});

/* ── revision 2: compact ledger, unit budget ───────────────────────────── */

test("refusals as counters: only the accepted share of pushes is a ledger row", () => {
  const all = projectStorage(LOAD, COSTS, KEEP_EVERYTHING_V2, 0);
  const half = projectStorage({ ...LOAD, acceptedShare: 0.5 }, COSTS, KEEP_EVERYTHING_V2, 0);
  assert.equal(all.byClass.push_ledger! - half.byClass.push_ledger!, 1000 * 0.6 * 1.5 * 40 * 90 * 0.5 * 600);
});

test("the unit budget caps hostile pushes but not the movement cells the pipeline stores", () => {
  const hostile = { accounts: 10, sessionsPerDay: 20, unitsPerSession: 500, days: 14 };
  const base = projectStorage(LOAD, COSTS, KEEP_EVERYTHING_V2, 0);
  const capped = projectStorage({ ...LOAD, hostile, unitBudget: 300, hostileAcceptedShare: 1 }, COSTS, KEEP_EVERYTHING_V2, 0);
  const open = projectStorage({ ...LOAD, hostile, hostileAcceptedShare: 1 }, COSTS, KEEP_EVERYTHING_V2, 0);
  assert.equal(capped.byClass.push_ledger! - base.byClass.push_ledger!, 10 * 14 * 300 * 600);
  assert.equal(open.byClass.push_ledger! - base.byClass.push_ledger!, 10 * 14 * 10_000 * 600);
  assert.equal(capped.byClass.movement_sessions, open.byClass.movement_sessions);
});

test("partition overhead is paid per kept day", () => {
  const costs = { ...COSTS, partitionDay: 64 * 1024 };
  const keep = projectStorage(LOAD, costs, KEEP_EVERYTHING_V2, 0);
  const keepNone = projectStorage(LOAD, COSTS, KEEP_EVERYTHING_V2, 0);
  assert.equal(keep.byClass.push_ledger! - keepNone.byClass.push_ledger!, 90 * 64 * 1024);
  const prop = projectStorage(LOAD, costs, PROPOSED_RETENTION, 0);
  const propNone = projectStorage(LOAD, COSTS, PROPOSED_RETENTION, 0);
  assert.equal(prop.byClass.push_ledger! - propNone.byClass.push_ledger!, 15 * 64 * 1024);
});

/* ── guard ─────────────────────────────────────────────────────────────── */

test("the guard caches its read, fails closed on a throw and recovers on the next read", async () => {
  let t = 0;
  let reads = 0;
  let size: () => number = () => 10 * MIB;
  const guard = createCapacityGuard({ readSizeBytes: async () => { reads++; return size(); }, now: () => t, refreshMs: 1000 });
  assert.equal((await guard()).acceptPushes, true);
  t = 500;
  await guard();
  assert.equal(reads, 1, "reused inside the refresh window");
  size = () => { throw new Error("down"); };
  t = 1500;
  const failed = await guard();
  assert.deepEqual([failed.level, failed.acceptPushes, failed.pushBudgetFactor, failed.reasons], ["hard_stop", false, 0, ["size_unreadable"]]);
  size = () => 10 * MIB;
  t = 3000;
  assert.equal((await guard()).level, "ok");
});

test("the guard treats a non-number size as unreadable", async () => {
  const guard = createCapacityGuard({ readSizeBytes: async () => "12" as unknown as number });
  assert.equal((await guard()).acceptPushes, false);
});

test("the guard extrapolates growth only after an hour of history", async () => {
  let t = 0;
  let bytes = 100 * MIB;
  const guard = createCapacityGuard({ readSizeBytes: async () => bytes, now: () => t, refreshMs: 0 });
  assert.equal((await guard()).level, "ok");
  t = 30 * 60_000;
  bytes = 110 * MIB;
  assert.equal((await guard()).level, "ok", "half an hour of history: no extrapolation");
  t = 2 * 3_600_000;
  bytes = 160 * MIB; // 60 MiB in two hours: 720 MiB a day
  const d = await guard();
  assert.notEqual(d.level, "ok");
  assert.ok(d.reasons.includes("warn_within_days"));
});

test("the guard uses its thresholds and stops at the hard line", async () => {
  const thresholds = { ...DEFAULT_THRESHOLDS, quotaBytes: 100 * MIB };
  const guard = createCapacityGuard({ readSizeBytes: async () => 99 * MIB, thresholds });
  const d = await guard();
  assert.deepEqual([d.level, d.acceptPushes], ["hard_stop", false]);
});

/* ── configuration ─────────────────────────────────────────────────────── */

test("capacity configuration: defaults, overrides and refusals", () => {
  assert.deepEqual(gameplayCapacityFromEnv({}), { unitBudget: DEFAULT_UNIT_BUDGET, quotaBytes: null });
  assert.equal(DEFAULT_UNIT_BUDGET, 300);
  assert.deepEqual(gameplayCapacityFromEnv({ MOVENRUN_GAMEPLAY_UNIT_BUDGET: "120", MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB: "500" }), { unitBudget: 120, quotaBytes: 500 * MIB });
  for (const bad of ["0", "-1", "1.5", "", "abc", "300 "]) {
    assert.throws(() => gameplayCapacityFromEnv({ MOVENRUN_GAMEPLAY_UNIT_BUDGET: bad }), /UNIT_BUDGET/);
  }
  for (const bad of ["49", "0", "x", "500MiB"]) {
    assert.throws(() => gameplayCapacityFromEnv({ MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB: bad }), /QUOTA_MIB/);
  }
});
