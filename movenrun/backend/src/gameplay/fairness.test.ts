/**
 * SIMULATION ONLY: the cohort fairness harness is deterministic, feeds every
 * rule set the same walks, keeps the server's budgets, and leaves both rule
 * sets' identities untouched. Not evidence about real players.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { COHORTS, DEFAULT_FAIRNESS, fairnessSeed, fairnessSessions } from "./fairness.js";
import { PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, rulesetDigest } from "./rules.js";

const SMALL = { days: 7, counts: { commuter: 4, loop: 3, long: 2, cowalker: 4, gaps: 3, hostile: 1, spoofer: 1 } };
// 1001 with sealing v2 named (was d4199ec6… before docs/g34/SEALING_V2_28OCT.md).
const DIGEST_1001 = "ff372572d7b754ad6c6dde3dbcc7535f7f62e13e94e718f8424eb0b1e0923bb2";

test("same seed, same walks, same rows; another seed differs", () => {
  const a = fairnessSeed(11, SMALL);
  assert.deepEqual(fairnessSeed(11, SMALL), a);
  assert.notDeepEqual(fairnessSeed(12, SMALL), a);
  const { sessions } = fairnessSessions({ ...DEFAULT_FAIRNESS, ...SMALL, seed: 11 }, 20_000);
  assert.ok(sessions.length > 0 && sessions.every((s, i) => i === 0 || sessions[i - 1]!.receivedMs <= s.receivedMs), "applied in receipt order");
  assert.deepEqual(fairnessSessions({ ...DEFAULT_FAIRNESS, ...SMALL, seed: 11 }, 20_000), fairnessSessions({ ...DEFAULT_FAIRNESS, ...SMALL, seed: 11 }, 20_000));
});

test("every rule set sees the same activity; budgets and the gap hold", () => {
  for (const seed of [1, 2]) {
    const [a9, noGap, p2] = fairnessSeed(seed, SMALL);
    for (const c of COHORTS) {
      assert.equal(a9!.cohorts[c].sessions, p2!.cohorts[c].sessions, `${c}: same accepted sessions`);
      assert.equal(a9!.cohorts[c].sessionsDayClosed, p2!.cohorts[c].sessionsDayClosed);
      assert.equal(a9!.cohorts[c].takeBudgetRefused, 0, "1001 has no take budget");
      assert.equal(p2!.cohorts[c].straddleFlips, 0, "no flip completes within 20 hours of the challenge under 1002");
      assert.equal(noGap!.cohorts[c].gapHeld, 0, "without the gap nothing is held back");
      for (const r of [a9!, p2!]) assert.ok(r.cohorts[c].maxUnitsWalkerDay <= 300, "the 300-unit budget is never exceeded");
      // 13 takes a day at most: a walker's takes over the run cannot pass 13 × days.
      assert.ok(p2!.cohorts[c].takes <= 13 * SMALL.days * SMALL.counts[c]);
    }
    // Only linked co-walkers can be flagged, and the 3+ variant never flags a pair.
    for (const r of [a9!, p2!]) {
      assert.equal(COHORTS.filter((c) => c !== "cowalker").reduce((n, c) => n + r.review.flaggedByCohort[c], 0), 0);
      assert.equal(r.review3plus.groupsFlagged, 0);
    }
  }
});

test("a smaller unit budget refuses long walks; null turns it off", () => {
  const [, , tight] = fairnessSeed(3, { ...SMALL, unitBudget: 40 });
  assert.ok(tight!.cohorts.long.unitBudgetRefused > 0);
  assert.ok(tight!.cohorts.long.maxUnitsWalkerDay <= 40);
  const [, , off] = fairnessSeed(3, { ...SMALL, unitBudget: null });
  for (const c of COHORTS) assert.equal(off!.cohorts[c].unitBudgetRefused, 0);
});

test("running the study changes no rule set identity", () => {
  const before = rulesetDigest(SIM_PILOT_2_PROPOSAL);
  fairnessSeed(4, SMALL);
  assert.equal(rulesetDigest(PILOT_PROPOSAL), DIGEST_1001);
  assert.equal(rulesetDigest(SIM_PILOT_2_PROPOSAL), before);
});
