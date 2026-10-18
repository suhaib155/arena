/**
 * Ledger finding H1 sized with the reference model of the prototype settlement
 * arithmetic, and the remediation options compared on the same footing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boundedMaxMint,
  maxLiquidPerSettlement,
  PLAYER_MOVEMENT_ALLOCATION,
  prototypeDailyPool,
  prototypeFastestExhaustion,
  SEASON_ONE_BUDGET,
  seasonBudgets,
} from "../contractLedger";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("schedule: 15 decaying seasons, then 2M floor seasons, sum is exactly the 400M allocation", () => {
  const b = seasonBudgets();
  close(b[0], 9_000_000);
  close(b[1], 8_100_000);
  close(b[14], 9_000_000 * 0.9 ** 14);
  close(b[15], 2_000_000);
  close(b.reduce((s, x) => s + x, 0), PLAYER_MOVEMENT_ALLOCATION);
  assert.equal(b.length, 180);
});

test("H1: day 90 after day 1 has the whole unissued season budget as its pool", () => {
  close(prototypeDailyPool(SEASON_ONE_BUDGET, 0, 1), 100_000);
  close(prototypeDailyPool(SEASON_ONE_BUDGET, 100_000, 90), SEASON_ONE_BUDGET - 100_000);
});

test("H1: the prototype lets the whole 400M be minted in 180 publications with no time passing", () => {
  const path = prototypeFastestExhaustion();
  assert.equal(path.publications, 180);
  assert.equal(path.wallClockDays, 0);
  close(path.minted, PLAYER_MOVEMENT_ALLOCATION);
});

test("H1 remediation: a per-publication cap alone does not bound the rate; the time bound does", () => {
  const capOnly = boundedMaxMint({ timeBoundDays: false, perPublicationMultiple: 1 }, 0);
  close(capOnly, PLAYER_MOVEMENT_ALLOCATION);
  const both = boundedMaxMint({ timeBoundDays: true, perPublicationMultiple: 1 }, 1);
  close(both, 100_000);
  const tenDays = boundedMaxMint({ timeBoundDays: true, perPublicationMultiple: 2 }, 10);
  close(tenDays, 9 * 200_000 + 200_000);
  assert.ok(tenDays <= 10 * (2 * SEASON_ONE_BUDGET) / 90 + 1e-6);
});

test("M4: one settlement's liquid ceiling is allowance + 2% of the toll base, even at zero allowance", () => {
  close(maxLiquidPerSettlement(0, 9_000_000), 180_000);
  close(maxLiquidPerSettlement(1_000, 0), 1_000);
});
