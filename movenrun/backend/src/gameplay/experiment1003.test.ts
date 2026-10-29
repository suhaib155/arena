/**
 * SIMULATION ONLY: experiment 1003 (take-budget reform). The ledger step's
 * event classes and budgets, the harness's determinism and identical inputs,
 * and that no server rule set changes. Not evidence about real players.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUnit, unitProblems, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { applySession1003 } from "./experiments/ledger1003.js";
import { RUNS_1003, experiment1003Seed, prepare1003, DEFAULT_1003 } from "./experiments/harness1003.js";
import { ADVERSARY_1003, COHORTS_1003, LINKED_1003 } from "./experiments/population1003.js";
import { EXPERIMENTS_1003, RULES_1003A, RULES_1003B, RULES_1003C, RULES_1003C0, budget1003Problems, type Experiment1003 } from "./experiments/rules1003.js";
import { DEFAULT_RULES_VERSION, PILOT_PROPOSAL, RULESETS, SIM_PILOT_2_PROPOSAL, rulesetDigest, rulesetFor } from "./rules.js";

// 1001 with sealing v2 named (was d4199ec6… before docs/g34/SEALING_V2_28OCT.md).
const DIGEST_1001 = "ff372572d7b754ad6c6dde3dbcc7535f7f62e13e94e718f8424eb0b1e0923bb2";
const DAY = 20_000;
const H = 3_600_000;
const SMALL = {
  days: 6,
  counts: { commuter: 3, runner: 1, loop: 2, long: 1, household: 2, sibling: 3, shared: 2, transit: 1, drift: 1, duplicate: 2, malicious: 1, spoofer: 1, ring: 2 },
};

const held = (unitId: string, holderId: string, strength: number, asOfDay: number, extra: Partial<UnitState> = {}): UnitState =>
  ({ ...newUnit(unitId, asOfDay), holderId, strength, asOfDay, ...extra });
const ev = (n: number, unitId: string, walkerId: string, day: number): PushEvent => ({ eventId: `e${n}:${unitId}`, unitId, walkerId, day, push: { kind: "solid" } });

function step(exp: Experiment1003, states: Map<string, UnitState>, events: PushEvent[], used: number, receivedMs: number, opened = new Map<string, number>()) {
  const r = applySession1003({ states, events, exp, used, unitsRemaining: null, receivedMs, opened, gap: true });
  for (const s of states.values()) assert.deepEqual(unitProblems(s), [], `consistent ${s.unitId}`);
  return r;
}

test("1003 variants: 1002 by spread with its own budget off, never registered, 1001 default and digest unchanged", () => {
  for (const x of EXPERIMENTS_1003) {
    assert.deepEqual(budget1003Problems(x.budget), []);
    assert.equal(x.rules.takeBudget, null);
    assert.deepEqual(x.rules.takeover, SIM_PILOT_2_PROPOSAL.takeover);
    assert.deepEqual(x.rules.units, SIM_PILOT_2_PROPOSAL.units);
    assert.deepEqual({ ...x.rules.holding, rulesVersion: 1002 }, SIM_PILOT_2_PROPOSAL.holding);
  }
  assert.equal(RULESETS.has(1003), false);
  assert.throws(() => rulesetFor(1003));
  assert.equal(DEFAULT_RULES_VERSION, 1001);
  assert.equal(rulesetDigest(PILOT_PROPOSAL), DIGEST_1001);
});

test("event classes: claim, defense, pass-through erosion, contested, confirmed flip", () => {
  const states = new Map([["u1", held("u1", "x", 100, DAY)], ["u2", newUnit("u2", DAY)], ["u3", held("u3", "y", 100, DAY)]]);
  const r = step(RULES_1003A, states, [ev(1, "u1", "y", DAY), ev(1, "u2", "y", DAY), ev(1, "u3", "y", DAY)], 0, DAY * 86_400_000 + 10 * H);
  assert.deepEqual(r.entries.map((e) => e.cls), ["pass_through", "claim", "defense"]);
  assert.equal(states.get("u1")!.strength, 50, "1002 arithmetic: a blocked flip leaves the challenge floor");
  const opened = new Map([["u1\u0000y", DAY * 86_400_000 + 10 * H]]);
  // Back the next day, 12 hours later: held by the 20-hour gap, a contested push.
  const r2 = step(RULES_1003A, states, [ev(2, "u1", "y", DAY + 1)], 0, DAY * 86_400_000 + 22 * H, opened);
  assert.deepEqual(r2.entries.map((e) => [e.cls, e.deliberate]), [["contested", true]]);
  // Two days later, past the gap: a confirmed, deliberate flip.
  const r3 = step(RULES_1003A, states, [ev(3, "u1", "y", DAY + 2)], 0, DAY * 86_400_000 + 58 * H, opened);
  assert.deepEqual(r3.entries.map((e) => [e.cls, e.deliberate, e.counted]), [["flip", true, true]]);
  assert.equal(states.get("u1")!.holderId, "y");
});

test("A counts only confirmed flips: a flip past the budget is refused and changes nothing; erosion stays free", () => {
  const states = new Map([["w", held("w", "x", 20, DAY)], ["s", held("s", "x", 100, DAY)]]);
  const before = structuredClone(states.get("w")!);
  const r = step(RULES_1003A, states, [ev(1, "w", "y", DAY), ev(1, "s", "y", DAY)], 13, DAY * 86_400_000);
  assert.deepEqual(r.entries.map((e) => [e.cls, e.outcome, e.blocked]), [["flip", "refused_take_budget", "hard"], ["pass_through", "eroded", null]]);
  assert.deepEqual(states.get("w"), before);
  assert.equal(r.used, 13);
});

test("B counts only deliberate return pushes: a first-contact flip of long-unvisited ground is free", () => {
  const states = new Map([["w", held("w", "x", 20, DAY)], ["c", held("c", "x", 50, DAY + 1, { challenges: [{ walkerId: "y", day: DAY }] })]]);
  const opened = new Map([["c\u0000y", 0]]);
  const r = step(RULES_1003B, states, [ev(1, "w", "y", DAY + 1), ev(1, "c", "y", DAY + 1)], 13, (DAY + 1) * 86_400_000, opened);
  assert.deepEqual(r.entries.map((e) => [e.cls, e.deliberate, e.blocked]), [["flip", false, null], ["flip", true, "hard"]]);
  assert.equal(states.get("w")!.holderId, "y");
  assert.equal(states.get("c")!.holderId, "x");
});

test("C: incidental erosion at reduced strength still opens the challenge; past the soft budget a push weakens and never flips", () => {
  const states = new Map([["u", held("u", "x", 100, DAY)]]);
  step(RULES_1003C, states, [ev(1, "u", "y", DAY)], 0, DAY * 86_400_000);
  assert.equal(states.get("u")!.strength, 75);
  assert.deepEqual(states.get("u")!.challenges, [{ walkerId: "y", day: DAY }]);
  const opened = new Map([["u\u0000y", 0]]);
  const r = step(RULES_1003C, states, [ev(2, "u", "y", DAY + 1)], 13, (DAY + 1) * 86_400_000, opened);
  assert.deepEqual(r.entries.map((e) => [e.cls, e.outcome, e.blocked]), [["contested", "eroded", "soft"]]);
  const u = states.get("u")!;
  assert.equal(u.holderId, "x");
  assert.equal(u.strength, 75 - 3 - 25, "a day's decay, then the soft push");
  assert.deepEqual(u.challenges, [{ walkerId: "y", day: DAY }], "the original challenge day is kept");
  // Without the soft budget (C0) the same return flips.
  const s0 = new Map([["u", held("u", "x", 75, DAY, { challenges: [{ walkerId: "y", day: DAY }], pushedBy: { day: DAY, walkerIds: ["y"] } })]]);
  step(RULES_1003C0, s0, [ev(2, "u", "y", DAY + 1)], 99, (DAY + 1) * 86_400_000, new Map([["u\u0000y", 0]]));
  assert.equal(s0.get("u")!.holderId, "y");
});

test("a restarted challenge takes the new session's receipt time in the simulation ledger, around midnight; a same-day challenge keeps its first time", () => {
  const MS_DAY = 86_400_000;
  const key = "u\u0000y";
  const oldAt = DAY * MS_DAY + 10 * H;
  const restartDay = DAY + 4; // past the 3-day window, so the old challenge lapsed
  // The soft path (C past its budget) only handles deliberate returns inside the window, which never restart a challenge, so only the normal path is reachable.
  for (const [name, exp, used] of [["A, budget open", RULES_1003A, 0], ["A, budget used up (first contact is free)", RULES_1003A, 13], ["C0", RULES_1003C0, 0]] as const) {
    for (const at of [restartDay * MS_DAY - 1_000, restartDay * MS_DAY, restartDay * MS_DAY + 1_000]) {
      const states = new Map([["u", held("u", "x", 100, DAY, { challenges: [{ walkerId: "y", day: DAY }], pushedBy: { day: DAY, walkerIds: ["y"] } })]]);
      const opened = new Map([[key, oldAt]]);
      step(exp, states, [ev(1, "u", "y", restartDay)], used, at, opened);
      assert.deepEqual(states.get("u")!.challenges, [{ walkerId: "y", day: restartDay }], `${name}: challenge restarted`);
      assert.equal(opened.get(key), at, `${name}: opening time is the restarting session's receipt time (${at - restartDay * MS_DAY} ms from midnight)`);
    }
    // Control: a return inside the window keeps the challenge's first day and its first receipt time.
    const states = new Map([["u", held("u", "x", 100, DAY, { challenges: [{ walkerId: "y", day: DAY }], pushedBy: { day: DAY, walkerIds: ["y"] } })]]);
    const opened = new Map([[key, oldAt]]);
    step(exp, states, [ev(2, "u", "y", DAY + 1)], used, (DAY + 1) * MS_DAY + 5 * H, opened);
    assert.equal(opened.get(key), oldAt, `${name}: same first day keeps the first receipt time`);
  }
});

test("the one-push-per-walker-per-unit-per-day rule holds under every variant, with or without budget left, and never counts", () => {
  for (const exp of EXPERIMENTS_1003) for (const used of [0, 13]) {
    const states = new Map([["u", held("u", "x", 100, DAY)]]);
    step(exp, states, [ev(1, "u", "y", DAY)], used, DAY * 86_400_000);
    const after = structuredClone(states.get("u")!);
    const r = step(exp, states, [ev(2, "u", "y", DAY)], used, DAY * 86_400_000 + H);
    assert.deepEqual(r.entries.map((e) => [e.outcome, e.counted, e.blocked]), [["refused_daily_limit", false, null]], exp.label);
    assert.equal(r.used, used);
    assert.deepEqual(states.get("u"), after);
  }
});

test("harness: same seed same rows, another seed differs, every rule set sees identical sessions; 1001 and 1002 digests unchanged", () => {
  const before = rulesetDigest(SIM_PILOT_2_PROPOSAL);
  const a = experiment1003Seed(7, SMALL);
  assert.deepEqual(experiment1003Seed(7, SMALL), a);
  assert.notDeepEqual(experiment1003Seed(8, SMALL), a);
  assert.deepEqual(a.map((r) => r.label), RUNS_1003.map((r) => r.label));
  const prep = prepare1003({ ...DEFAULT_1003, ...SMALL, seed: 7 });
  assert.ok(prep.sessions.every((s, i) => i === 0 || prep.sessions[i - 1]!.receivedMs <= s.receivedMs));
  for (const c of COHORTS_1003) {
    for (const r of a) {
      assert.equal(r.cohorts[c].sessions, a[0]!.cohorts[c].sessions, `${r.label} ${c}: same accepted sessions`);
      assert.equal(r.cohorts[c].activeWalkerDays, a[0]!.cohorts[c].activeWalkerDays);
    }
    assert.equal(a[0]!.cohorts[c].budgetHard + a[0]!.cohorts[c].budgetSoft, 0, "1001 has no budget");
    // A: at most 13 confirmed flips per walker-day.
    const A = a.find((r) => r.label === "1003A")!;
    assert.ok(A.cohorts[c].flips <= 13 * SMALL.days * SMALL.counts[c]);
    assert.equal(A.cohorts[c].budgetSoft, 0);
    assert.equal(a.find((r) => r.label === "1003C0")!.cohorts[c].budgetHard + a.find((r) => r.label === "1003C0")!.cohorts[c].budgetSoft, 0, "C0 has no budget");
  }
  for (const r of a) for (const rv of [r.review2, r.review3]) {
    for (const c of Object.keys(rv.flaggedGroups)) assert.ok(LINKED_1003.includes(c as never), "only linked groups can be flagged");
    for (const c of ADVERSARY_1003) assert.equal(rv.flaggedGroups[c] ?? 0, 0, "unlinked rings are invisible to linkage");
  }
  assert.equal(rulesetDigest(PILOT_PROPOSAL), DIGEST_1001);
  assert.equal(rulesetDigest(SIM_PILOT_2_PROPOSAL), before);
});
