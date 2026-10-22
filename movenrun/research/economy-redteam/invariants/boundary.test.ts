/**
 * Server-authority invariants that need no database (B4).
 *
 * Every assertion runs the real, unmodified functions at cb27318. Tests named
 * "documents defect" or "documents gap" or "requires ratification" are
 * EXPECTED to pass: they assert that the problematic behaviour occurs, so the
 * suite stays green while the behaviour stays reproducible. The report is
 * docs/parallel/economy-redteam/SERVER_AUTHORITY_INVARIANTS.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { latLngToCell } from "h3-js";
import { applyPush, newUnit, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import {
  bitsToFlags, cellToInt8, deriveSessionPath, flagsToBits, pushUnitsOf, sessionPathRuleProblems, steppedUnitsOf, VERIFIED_STEPS_V1,
  type PathFix, type SessionPathRule,
} from "../../../backend/src/gameplay/path.ts";
import { applyServerLedger } from "../../../backend/src/gameplay/policy.ts";
import {
  DAY_MS, gameplayRulesFromEnv, lastClosedDay, PILOT_PROPOSAL, rulesetDigest, rulesetFor, rulesetProblems, SIM_PILOT_2_PROPOSAL,
} from "../../../backend/src/gameplay/rules.ts";
import { capacityTripwire, DEFAULT_UNIT_BUDGET, gameplayCapacityFromEnv, remainingPushBudget } from "../../../backend/src/gameplay/capacity.ts";
import { createGameplayRouter } from "../../../backend/src/gameplay/router.ts";
import { submitMovementSchema, MAX_POINTS } from "../../../backend/src/movement/http/validation.ts";
import { structuralRejections, MAX_SESSION_AGE_MS } from "../../../backend/src/movement/domain/verification.ts";
import { IdentityError } from "../../../backend/src/identity/domain/errors.ts";
import { densify, fix, HERE, ll, loadManifest, mulberry32, proofDigest, T0, type ProofLedgerRow } from "./helpers.ts";

const P2 = SIM_PILOT_2_PROPOSAL;
const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const res10 = (x: number, y: number) => { const p = ll(x, y); return latLngToCell(p.lat, p.lng, 10); };

/** Events exactly as GameplayService.applySession builds them (service.ts:411). */
function sessionEvents(movementId: string, walkerId: string, units: readonly string[], day: number): PushEvent[] {
  return units.map((unitId) => ({ eventId: `mv:${movementId}:${unitId}`, unitId, walkerId, push: { kind: "solid" }, day }));
}

/* ── 1. what the API accepts ─────────────────────────────────────────── */

const goodBody = () => ({
  sessionId: "walk-0001",
  startTime: T0,
  endTime: T0 + 90_000,
  points: Array.from({ length: 10 }, (_, i) => ({ ...ll(i * 14, 0), accuracy: 5, timestamp: T0 + i * 10_000 })),
});

test("API: a movement upload is observations only; any field naming cells, distance, ownership, balance or the user is refused", () => {
  assert.equal(submitMovementSchema.safeParse(goodBody()).success, true);
  for (const extra of [
    { traversedHexIds: [res10(0, 0)] }, { hexIds: [res10(0, 0)] }, { units: [res10(0, 0)] }, { distanceMeters: 5000 },
    { holderId: "usr-x" }, { userId: "usr-x" }, { credits: 12 }, { strength: 100 }, { outcome: "flipped" }, { sessionPath: { units: [] } },
  ]) {
    assert.equal(submitMovementSchema.safeParse({ ...goodBody(), ...extra }).success, false, JSON.stringify(Object.keys(extra)));
  }
  // A point cannot carry a cell or a speed either.
  const b = goodBody();
  (b.points[3] as Record<string, unknown>).cell = res10(0, 0);
  assert.equal(submitMovementSchema.safeParse(b).success, false);
  // Array bounds: at most MAX_POINTS fixes, at least 2.
  const many = goodBody();
  many.points = Array.from({ length: MAX_POINTS + 1 }, (_, i) => ({ ...ll(i, 0), accuracy: 5, timestamp: T0 + i * 1000 }));
  assert.equal(submitMovementSchema.safeParse(many).success, false);
  assert.equal(MAX_POINTS, 10_000);
});

test("API: the gameplay apply route takes no body field at all and reads the user from the bearer only", async () => {
  const calls: [string, string][] = [];
  const service = {
    rules: { defaultLeaderboard: "player_credits" },
    applySession: async (userId: string, sessionId: string) => {
      calls.push([userId, sessionId]);
      return { sessionId, day: D, replayed: false, applied: 0, skipped: 0, rejected: 0, outcomes: {}, rejectedByReason: {} };
    },
  };
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use("/gameplay", createGameplayRouter({
    service: service as never,
    verifyBearer: async (token) => {
      if (token === "token-alice") return { userId: "usr-alice" };
      throw new IdentityError("session_invalid");
    },
  }));
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/gameplay`;
  const post = (path: string, body: unknown, token = "token-alice") => fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  try {
    for (const body of [{ units: [res10(0, 0)] }, { userId: "usr-bob" }, { delta: 100 }, { credits: 5 }, { day: D - 1 }, { rulesVersion: 1002 }]) {
      assert.equal((await post("/sessions/walk-0001/apply", body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await post("/sessions/walk-0001/apply", {}, "token-mallory")).status, 401);
    assert.equal((await post("/sessions/x/apply", {})).status, 400, "session id outside the bounded charset");
    assert.equal(calls.length, 0, "no refused request reached the service");
    assert.equal((await post("/sessions/walk-0001/apply", {})).status, 201);
    assert.deepEqual(calls, [["usr-alice", "walk-0001"]]);
  } finally {
    server.close();
  }
});

/* ── 2. the path comes only from verified fixes ───────────────────────── */

test("path: every stepped unit holds a fix, every fix's unit is stepped, units are unique and bounded (seeded fuzz)", () => {
  const m = loadManifest();
  for (const seed of m.seeds.pathFuzz) {
    const rnd = mulberry32(seed);
    for (let w = 0; w < m.magnitudes.fuzzWalksPerSeed; w++) {
      const [lo, hi] = m.magnitudes.fuzzFixesPerWalk;
      const n = lo + Math.floor(rnd() * (hi - lo));
      let x = 0, y = 0, t = T0;
      const fixes: PathFix[] = [];
      for (let i = 0; i < n; i++) {
        fixes.push(fix(x, y, t, rnd() < 0.03));
        const step = rnd() * 260;
        const a = rnd() * Math.PI * 2;
        x += Math.cos(a) * step; y += Math.sin(a) * step;
        t += 1000 + Math.floor(rnd() * 150_000);
      }
      const p = deriveSessionPath(fixes, [], VERIFIED_STEPS_V1);
      assert.equal(new Set(p.units).size, p.units.length);
      assert.equal(p.interpolated.length, p.units.length);
      assert.ok(p.units.length <= VERIFIED_STEPS_V1.maxUnits);
      const fixCells = new Set(fixes.map((f) => latLngToCell(f.lat, f.lng, 10)));
      for (const [i, u] of p.units.entries()) assert.equal(!p.interpolated[i], fixCells.has(u), `seed ${seed}: flag of ${u}`);
      if (!p.truncated) for (const c of fixCells) assert.ok(p.units.includes(c));
      // Storage round trip is exact, and a corrupted flag string fails closed.
      assert.deepEqual(bitsToFlags(flagsToBits(p.interpolated), p.units.length), p.interpolated);
      assert.throws(() => bitsToFlags(flagsToBits(p.interpolated) + "0", p.units.length));
    }
  }
});

test("path: a cell that is not a canonical H3 index can never be stored (cellToInt8)", () => {
  const good = res10(0, 0);
  assert.match(cellToInt8(good), /^\d+$/);
  for (const bad of [good.toUpperCase(), `${good}0`, "8a194ad32927ff", "0", "", "not-a-cell"]) assert.throws(() => cellToInt8(bad), bad);
});

/* ── 3. GPS gaps and interpolation ─────────────────────────────────────── */

// A gap of 180 m in 120 s (1.5 m/s): inside every continuity limit of VERIFIED_STEPS_V1.
const GAP_A: [number, number] = [40, 0];
const GAP_B: [number, number] = [190, 100];

test("gaps outside any continuity limit add nothing between their ends (break, pause, > 200 m, > 120 s, > 12 m/s)", () => {
  const cases: [string, PathFix[], { startedAt: number; endedAt: number }[]][] = [
    ["break", [fix(...GAP_A, T0), fix(...GAP_B, T0 + 120_000, true)], []],
    ["pause", [fix(...GAP_A, T0), fix(...GAP_B, T0 + 120_000)], [{ startedAt: T0 + 10_000, endedAt: T0 + 20_000 }]],
    ["201 m", [fix(0, 0, T0), fix(201, 0, T0 + 100_000)], []],
    ["121 s", [fix(...GAP_A, T0), fix(...GAP_B, T0 + 121_000)], []],
    ["12.9 m/s", [fix(...GAP_A, T0), fix(...GAP_B, T0 + 14_000)], []],
  ];
  for (const [name, fixes, pauses] of cases) {
    const p = deriveSessionPath(fixes, pauses, VERIFIED_STEPS_V1);
    assert.equal(p.interpolated.filter(Boolean).length, 0, name);
    assert.equal(p.skippedSegments, 1, name);
  }
});

test("requires ratification: under 1002 a bridged 120 s GPS gap pushes interpolated units as solid ground at full strength", () => {
  const fixes = [fix(...GAP_A, T0), fix(...GAP_B, T0 + 120_000)];
  const path = deriveSessionPath(fixes, [], VERIFIED_STEPS_V1);
  const interp = path.units.filter((_, i) => path.interpolated[i]);
  assert.equal(interp.length, 2, "two units hold no fix and were reached only by the straight line");
  const pushed = pushUnitsOf(path, VERIFIED_STEPS_V1);
  for (const u of interp) assert.ok(pushed.includes(u), "VERIFIED_STEPS_V1.pushInterpolated is true");

  // Through the server's own ledger step, with 1002's holding rules, budget and walk order.
  const day = D + 30;
  const [weak, empty] = interp as [string, string];
  const states = new Map<string, UnitState>();
  for (const u of pushed) states.set(u, newUnit(u, day));
  // The first interpolated unit is another walker's long-unvisited ground (13 < immediateBelowStrength 30).
  states.set(weak, { ...newUnit(weak, day - 29), holderId: "usr-carol", strength: 100 });
  const events = sessionEvents("mv-gap", "usr-walker", pushed, day);
  const r = applyServerLedger({
    states, events, holding: P2.holding, budget: P2.takeBudget, walkOrder: new Map(events.map((e, i) => [e.eventId, i])),
  });
  const byUnit = new Map(r.entries.map((e) => [e.unitId, e]));
  assert.equal(byUnit.get(weak)!.outcome, "flipped", "taken from its holder by a cell nobody stepped on");
  assert.equal(byUnit.get(empty)!.outcome, "claimed");
  assert.deepEqual([r.states.get(empty)!.ground, r.states.get(empty)!.strength, r.states.get(empty)!.holderId], ["solid", 100, "usr-walker"]);

  // The toll never reads them (PASS): crossed cells are the stepped units only.
  assert.deepEqual(steppedUnitsOf(path).filter((u) => interp.includes(u)), []);
  // The switch exists: pushInterpolated false pushes stepped units only.
  const strict: SessionPathRule = { ...VERIFIED_STEPS_V1, pushInterpolated: false };
  assert.deepEqual(sessionPathRuleProblems(strict), []);
  assert.deepEqual(pushUnitsOf(path, strict), steppedUnitsOf(path));
});

test("requires ratification: sparse fixes around a corner push a unit off the walked route", () => {
  // The walker goes north 80 m then east 80 m (160 m at 1.4 m/s, 115 s); the phone records only the two ends.
  const route: [number, number][] = [[40, 0], [40, 80], [120, 80]];
  const truth = new Set(densify(route, 1).map(([x, y]) => res10(x, y)));
  const sparse = deriveSessionPath([fix(40, 0, T0), fix(120, 80, T0 + 115_000)], [], VERIFIED_STEPS_V1);
  const offSparse = pushUnitsOf(sparse, VERIFIED_STEPS_V1).filter((u) => !truth.has(u));
  assert.equal(offSparse.length, 1, "one pushed unit lies on the chord, not on the route");
  // The same walk with a fix every 10 s pushes nothing off the route.
  const dense = densify(route, 14).map(([x, y], i) => fix(x, y, T0 + i * 10_000));
  const offDense = pushUnitsOf(deriveSessionPath(dense, [], VERIFIED_STEPS_V1), VERIFIED_STEPS_V1).filter((u) => !truth.has(u));
  assert.equal(offDense.length, 0);
});

/* ── 4. bounds: huge sparse coverage ───────────────────────────────────── */

test("bounds: a 2,000-fix walk over 100 km keeps at most maxUnits units, says it was truncated, and no rule set can exceed the session cap", () => {
  const fixes = Array.from({ length: 2000 }, (_, i) => fix(i * 50, (i % 2) * 30, T0 + i * 40_000));
  const p = deriveSessionPath(fixes, [], VERIFIED_STEPS_V1);
  assert.equal(p.units.length, VERIFIED_STEPS_V1.maxUnits);
  assert.equal(p.truncated, true);
  assert.ok(VERIFIED_STEPS_V1.maxUnits <= P2.maxUnitsPerSession);
  assert.deepEqual(rulesetProblems({ ...P2, units: { ...P2.units, source: { kind: "session-path", rule: { ...VERIFIED_STEPS_V1, maxUnits: 501 } } } }),
    ["session path may not hold more units than a session may push"]);
  assert.ok(sessionPathRuleProblems({ ...VERIFIED_STEPS_V1, maxSegmentMeters: 250 }).length > 0);
  assert.ok(sessionPathRuleProblems({ ...VERIFIED_STEPS_V1, maxSpeedMetersPerSecond: 20 }).length > 0);
});

/* ── 5. once per walker, unit and day ──────────────────────────────────── */

test("once per day survives a flip (A9, 1001): after taking a unit and losing it back, the walker cannot push it again that day", () => {
  const h = PILOT_PROPOSAL.holding;
  const day = D + 5;
  let s: UnitState = { ...newUnit("u1", day), holderId: "usr-holder", strength: 100 };
  const step = (w: string) => { const r = applyPush({ state: s, walkerId: w, push: { kind: "solid" }, day, rules: h }); s = r.state; return r.outcome; };
  assert.equal(step("usr-taker"), "flipped");
  assert.equal(step("usr-taker"), "reinforced", "own ground: reinforcing is never limited");
  assert.equal(step("usr-holder"), "flipped", "the old holder takes it straight back");
  assert.equal(step("usr-taker"), "refused_daily_limit");
  assert.equal(step("usr-holder"), "reinforced");
  assert.equal(step("usr-third"), "flipped", "a third walker is not limited by the others (99 against a 100 push)");
  assert.equal(step("usr-holder"), "refused_daily_limit", "the holder already spent their push of the day taking it back");
  assert.equal(step("usr-taker"), "refused_daily_limit");
});

test("once per day survives a challenge reset (1002): the holder's answer clears the challenge but not the challenger's push of the day", () => {
  const h = P2.holding;
  let day = D + 5;
  let s: UnitState = { ...newUnit("u2", day), holderId: "usr-holder", strength: 100 };
  const step = (w: string) => { const r = applyPush({ state: s, walkerId: w, push: { kind: "solid" }, day, rules: h }); s = r.state; return r.outcome; };
  assert.equal(step("usr-challenger"), "eroded");
  assert.deepEqual([s.strength, s.challenges], [50, [{ walkerId: "usr-challenger", day }]]);
  assert.equal(step("usr-holder"), "reinforced");
  assert.equal(s.challenges, undefined, "answered");
  assert.equal(step("usr-challenger"), "refused_daily_limit", "the answer does not give back the day's push");
  day += 1;
  assert.equal(step("usr-challenger"), "eroded", "a new challenge, not a flip: the old one was answered");
  day += 1;
  assert.equal(step("usr-challenger"), "flipped");
  assert.equal(step("usr-holder"), "eroded", "the old holder opens a challenge of their own");
  assert.equal(step("usr-challenger"), "reinforced");
  assert.equal(step("usr-holder"), "refused_daily_limit");
});

/* ── 6. rules version and digest fail closed ───────────────────────────── */

test("wrong rules version or digest fails closed: unknown versions throw, any config change moves the digest", () => {
  for (const v of [1003, 9002, 0, -1, "1002", null, undefined, 1002.5]) assert.throws(() => rulesetFor(v), String(v));
  assert.throws(() => gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: "true", MOVENRUN_GAMEPLAY_SEASON_START_DAY: String(D), MOVENRUN_GAMEPLAY_RULES_VERSION: "1003" }));
  assert.throws(() => gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: "true", MOVENRUN_GAMEPLAY_SEASON_START_DAY: String(D), MOVENRUN_GAMEPLAY_RULES_VERSION: "1002 " }));
  assert.throws(() => gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: "true" }), "no season start");
  assert.equal(gameplayRulesFromEnv({}), null, "off by default");
  assert.equal(gameplayRulesFromEnv({ MOVENRUN_GAMEPLAY_ENABLED: "true", MOVENRUN_GAMEPLAY_SEASON_START_DAY: String(D) })!.holding.rulesVersion, 1001, "1001 is the default");
  assert.deepEqual(rulesetProblems(P2), []);
  assert.deepEqual(rulesetProblems(PILOT_PROPOSAL), []);
  const base = rulesetDigest(P2);
  assert.notEqual(rulesetDigest(PILOT_PROPOSAL), base);
  const variants = [
    { ...P2, takeBudget: { ...P2.takeBudget!, perWalkerPerDay: 14 } },
    { ...P2, units: { ...P2.units, source: { kind: "session-path" as const, rule: { ...VERIFIED_STEPS_V1, pushInterpolated: false } } } },
    { ...P2, units: { ...P2.units, source: { kind: "session-path" as const, rule: { ...VERIFIED_STEPS_V1, maxSegmentMs: 60_000 } } } },
    { ...P2, trustWeight: 0.9 },
    { ...P2, holding: { ...P2.holding, solidDecayPerDay: 4 } },
  ];
  for (const v of variants) assert.notEqual(rulesetDigest(v), base);
  // The path rule's identity is checked at the store too: version 2 is not a rule this build knows.
  assert.ok(sessionPathRuleProblems({ ...VERIFIED_STEPS_V1, version: 2 as 1 }).includes("unknown session path rule"));
});

/* ── 7. close watermark and device clocks ──────────────────────────────── */

test("watermark: day d is closed to pushes and open to settlement exactly at midnight plus the 2 h grace", () => {
  const g = PILOT_PROPOSAL.dayCloseGraceMs;
  const d = D + 10;
  assert.equal(lastClosedDay(PILOT_PROPOSAL, (d + 1) * DAY_MS + g - 1), d - 1);
  assert.equal(lastClosedDay(PILOT_PROPOSAL, (d + 1) * DAY_MS + g), d);
});

test("documents gap: the movement pipeline accepts a session ended up to 30 days ago, far beyond the 2 h gameplay grace", () => {
  const now = (D + 40) * DAY_MS;
  const obs = (endMs: number) => ({ startTime: endMs - 90_000, endTime: endMs, points: [{ lat: 51.52, lng: -0.1, accuracy: 5, timestamp: endMs - 90_000 }, { lat: 51.5202, lng: -0.1, accuracy: 5, timestamp: endMs }] });
  assert.deepEqual(structuralRejections(obs(now - 29 * DAY_MS), now), [], "a device clock set back 29 days passes the structural check");
  assert.ok(structuralRejections(obs(now + 6 * 60_000), now).includes("Session ends in the future"));
  assert.equal(MAX_SESSION_AGE_MS, 30 * DAY_MS);
  assert.ok(MAX_SESSION_AGE_MS > PILOT_PROPOSAL.dayCloseGraceMs * 100);
});

/* ── 8. player-day proofs ──────────────────────────────────────────────── */

const proofRows: ProofLedgerRow[] = [
  { source_no: 7, unit: "622488866929082367", outcome: 1, previous_holder_no: null, new_holder_no: 3, strength_before: 0, strength_after: 100, shade_strength: 0 },
  { source_no: 7, unit: "622488866929115135", outcome: 3, previous_holder_no: 5, new_holder_no: 5, strength_before: 100, strength_after: 50, shade_strength: 0 },
  { source_no: 9, unit: "622488866929147903", outcome: 4, previous_holder_no: 6, new_holder_no: 3, strength_before: 13, strength_after: 87, shade_strength: 0 },
];
const refusal = { refused_deeded: 0, refused_masked: 0, refused_daily_limit: 1, refused_take_budget: 0, visit_units: [] };

test("proofs detect an edited, reordered, duplicated or dropped ledger row", () => {
  const base = proofDigest(proofRows, refusal);
  const edited = proofRows.map((r, i) => (i === 1 ? { ...r, strength_after: 1 } : r));
  assert.notEqual(proofDigest(edited, refusal), base);
  assert.notEqual(proofDigest([proofRows[1]!, proofRows[0]!, proofRows[2]!], refusal), base);
  assert.notEqual(proofDigest([...proofRows, proofRows[2]!], refusal), base);
  assert.notEqual(proofDigest(proofRows.slice(0, 2), refusal), base);
  assert.notEqual(proofDigest(proofRows, { ...refusal, refused_daily_limit: 0 }), base);
});

test("documents limitation: a proof binds neither its day nor its player, is unkeyed and unchained", () => {
  // The same rows replayed onto another day, or under another player, give the same digest: only the
  // table's primary key (player_no, day) ties a digest to them, and the table has no append-only trigger.
  const a = proofDigest(proofRows, refusal);
  assert.equal(proofDigest(proofRows.map((r) => ({ ...r })), { ...refusal }), a);
  // Anyone holding the rows can recompute it: it proves an archive matches the proof table, not who wrote either.
  assert.match(a, /^[0-9a-f]{64}$/);
  const migration = readFileSync(join(HERE, "../../../backend/drizzle-proposed/0011_gameplay_holdings.sql"), "utf8");
  assert.doesNotMatch(migration, /TRIGGER[^;]*ON "gameplay_player_day_proofs"/, "no final/append-only trigger on the proof table");
  assert.match(migration, /TRIGGER "gameplay_push_events_append_only"/);
  assert.match(migration, /TRIGGER "gameplay_credit_lines_final"/);
});

/* ── 9. capacity ───────────────────────────────────────────────────────── */

test("documents gap: nothing caps players at 200 (or any number); the storage guard is off unless a quota is configured", () => {
  const cfg = gameplayCapacityFromEnv({});
  assert.equal(cfg.quotaBytes, null, "no MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB: no guard at all");
  assert.equal(cfg.unitBudget, DEFAULT_UNIT_BUDGET);
  const dir = join(HERE, "../../../backend/src/gameplay");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test.")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  assert.doesNotMatch(sources, /MAX_PLAYERS|maxPlayers|PLAYER_CAP|playerCap|MOVENRUN_GAMEPLAY_[A-Z_]*PLAYERS/);
  // gameplay_players rows are created on first push for any authenticated user (service.ts:346-363).
  assert.match(sources, /INSERT INTO gameplay_players \(user_id\)/);
});

test("capacity guard fails closed: an unreadable size or bad thresholds stop pushes; a stop leaves zero budget", () => {
  for (const usedBytes of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const d = capacityTripwire({ usedBytes, dailyGrowthBytes: 0 });
    assert.deepEqual([d.level, d.acceptPushes, d.pushBudgetFactor], ["hard_stop", false, 0]);
  }
  const bad = capacityTripwire({ usedBytes: 1, dailyGrowthBytes: 0, thresholds: { quotaBytes: 100, warnFraction: 0.9, backpressureFraction: 0.5, hardStopFraction: 0.95, warnDaysAhead: 1, reserveBytes: 1 } });
  assert.equal(bad.acceptPushes, false);
  assert.equal(remainingPushBudget(300, 0, { acceptPushes: false, pushBudgetFactor: 1 }), 0);
  assert.equal(remainingPushBudget(300, 299, { acceptPushes: true, pushBudgetFactor: 0.5 }), 0);
});
