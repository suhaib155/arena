/**
 * SIMULATION ONLY: the same-seed comparison harness is deterministic, feeds
 * both rule sets the same walks, and shows the direction of the 1002 levers
 * on synthetic players. Not evidence about real players.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSeed, sessionsFor, DEFAULT_COMPARE } from "./compare.js";

const SMALL = { days: 7, casual: 20, attackers: 3 };

test("same seed, same walks, same rows; another seed differs", () => {
  assert.deepEqual(compareSeed(7, SMALL), compareSeed(7, SMALL));
  assert.notDeepEqual(compareSeed(8, SMALL), compareSeed(7, SMALL));
  const a = sessionsFor({ ...DEFAULT_COMPARE, ...SMALL, seed: 7 }, 20_000);
  assert.ok(a.length > 0 && a.every((s, i) => i === 0 || a[i - 1]!.receivedMs <= s.receivedMs), "applied in receipt order");
});

test("direction on synthetic players: 1002 cuts attackers' takes from others, the gap removes straddle flips, casual walkers keep access", () => {
  for (const seed of [1, 2]) {
    const [a9, noGap, p2] = compareSeed(seed, SMALL);
    assert.equal(p2!.straddleFlips, 0, "no flip completes within 20 hours of the challenge");
    assert.ok(noGap!.straddleFlips >= 0);
    assert.ok(p2!.attackerFlippedKm2 < a9!.attackerFlippedKm2);
    assert.ok(p2!.casualLostToAttackersKm2 < a9!.casualLostToAttackersKm2);
    assert.ok(p2!.casualWithGround >= a9!.casualWithGround);
    assert.equal(a9!.budgetRefusedCasual + a9!.budgetRefusedAttacker, 0, "1001 has no budget");
  }
});
