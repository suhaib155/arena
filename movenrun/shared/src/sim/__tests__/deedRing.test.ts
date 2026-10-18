/**
 * G5 Sybil ring study (SIMULATION ONLY): deeds a ring of k linked accounts can
 * obtain under the prototype's on-chain controls and under the draft patch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEED_RULES_SOURCE } from "../economyG5";
import {
  applyControls,
  CURRENT_CONTROLS,
  DEED_RULES_LOOSE,
  minimumRing,
  PROPOSED_CONTROLS,
  ringDeedYield,
  type RingScenario,
} from "../deedRing";

const base = (k: number, detectionRate = 0, lateDetectionRate = 0): RingScenario => ({
  k, cellsPerMember: 3, days: 90, crossersPerCellPerDay: 10, detectionRate, lateDetectionRate,
});
const both = [CURRENT_CONTROLS, PROPOSED_CONTROLS];

test("a ring needs distinctCrossers + 1 accounts: 31 under the source rule, 6 under the 7/5/3 comparator", () => {
  assert.equal(minimumRing(DEED_RULES_SOURCE), 31);
  assert.equal(minimumRing(DEED_RULES_LOOSE), 6);
  const [cur30] = ringDeedYield(base(30), DEED_RULES_SOURCE, both, { trials: 1 });
  assert.equal(cur30!.meanOffChainEligible, 0);
  const [cur31, pro31] = ringDeedYield(base(31), DEED_RULES_SOURCE, both, { trials: 1 });
  // Every cell of every member is eligible off chain; the per-holder cap of 1 leaves one deed per wallet.
  assert.equal(cur31!.meanOffChainEligible, 93);
  assert.equal(cur31!.meanDeeds, 31);
  // With no detection at all, the patch's cluster cap sees 31 singletons and does not bind.
  assert.equal(pro31!.meanDeeds, 31);
});

test("loosening the rule hands deeds to small rings: six accounts take six deeds", () => {
  const [cur] = ringDeedYield(base(6), DEED_RULES_LOOSE, both, { trials: 1 });
  assert.equal(cur!.meanDeeds, 6);
});

test("a fully detected ring gets nothing: linked traffic never counts", () => {
  const [cur] = ringDeedYield(base(40, 1), DEED_RULES_SOURCE, both, { trials: 2 });
  assert.equal(cur!.meanOffChainEligible, 0);
});

test("with partial detection the per-cluster cap removes most ring deeds; it never adds any", () => {
  const [cur, pro] = ringDeedYield(base(60, 0.3, 0.2), DEED_RULES_SOURCE, both, { trials: 6 });
  assert.ok(pro!.meanDeeds <= cur!.meanDeeds);
  assert.ok(pro!.meanDeeds * 3 <= cur!.meanDeeds, `${pro!.meanDeeds} vs ${cur!.meanDeeds}`);
});

test("the city-wide cap bounds a large undetected ring", () => {
  const [cur, pro] = ringDeedYield(base(100), DEED_RULES_LOOSE, both, { trials: 1 });
  assert.equal(cur!.meanDeeds, 100);
  assert.equal(pro!.meanDeeds, 50);
});

test("applyControls: daily limit defers rather than refuses; a voided claim still uses its cluster slot", () => {
  const eligible = Array.from({ length: 12 }, (_, i) => ({ unitId: `u${i}`, holderId: `h${i}`, day: 1 }));
  const solo = (id: string) => `cluster:${id}`;
  const deferred = applyControls(eligible, solo, new Set(), { ...PROPOSED_CONTROLS, cityWideCap: null });
  assert.equal(deferred.deeds, 12);
  const ring = () => "cluster:op";
  const voided = applyControls(eligible, ring, new Set(["h0"]), PROPOSED_CONTROLS);
  assert.equal(voided.deeds, 0);
});
