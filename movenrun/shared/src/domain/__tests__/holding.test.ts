/**
 * Holding (section 5): pushes, flips, decay, deeds and masks, plus invariants
 * over seeded random days. Decay numbers are placeholders for D4.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyPush,
  decayResist,
  decayTo,
  erosionResist,
  MAX_DECAY_RESIST,
  MAX_EROSION_RESIST,
  newUnit,
  stageOf,
  unitProblems,
  type HoldingRules,
  type Push,
  type UnitState,
} from "../holding";

// D4 is open: these are test values only.
const rules: HoldingRules = { rulesVersion: 1, solidDecayPerDay: 4, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
const SOLID: Push = { kind: "solid" };
const shade = (strength: number): Push => ({ kind: "shade", strength });
const held = (over: Partial<UnitState> = {}): UnitState => ({ ...newUnit("u1", 0), holderId: "ana", strength: 100, ...over });

test("unheld ground is claimed: 100 when stepped on, the shade value when only enclosed", () => {
  const stepped = applyPush({ state: newUnit("u1", 0), walkerId: "ana", push: SOLID, day: 0, rules });
  assert.equal(stepped.outcome, "claimed");
  assert.deepEqual([stepped.state.holderId, stepped.state.strength, stepped.state.ground], ["ana", 100, "solid"]);
  const enclosed = applyPush({ state: newUnit("u2", 0), walkerId: "ana", push: shade(18.7), day: 0, rules });
  assert.deepEqual([enclosed.state.strength, enclosed.state.ground], [18, "shade"]);
  assert.throws(() => applyPush({ state: newUnit("u3", 0), walkerId: "ana", push: shade(26), day: 0, rules }), RangeError);
});

test("a visit to your own ground restores 100 free, and stepping on your shade makes it solid", () => {
  const worn = held({ strength: 40 });
  assert.equal(applyPush({ state: worn, walkerId: "ana", push: SOLID, day: 0, rules }).state.strength, 100);
  const ownShade = held({ strength: 12, ground: "shade" });
  const r = applyPush({ state: ownShade, walkerId: "ana", push: SOLID, day: 0, rules });
  assert.deepEqual([r.outcome, r.state.strength, r.state.ground], ["reinforced", 100, "solid"]);
  // Enclosing your own ground again never lowers it.
  assert.equal(applyPush({ state: held({ strength: 90 }), walkerId: "ana", push: shade(20), day: 0, rules }).state.strength, 90);
});

test("someone else's push erodes by the push less resistance, and flips at 0 with the overflow", () => {
  // Level 3 resists 12%: 100 push → 88 taken.
  const strong = held({ level: 3, strength: 100 });
  const once = applyPush({ state: strong, walkerId: "ben", push: SOLID, day: 0, rules });
  assert.deepEqual([once.outcome, once.state.holderId, once.state.strength, once.removed], ["eroded", "ana", 12, 88]);
  const twice = applyPush({ state: once.state, walkerId: "ben", push: SOLID, day: 0, rules });
  assert.deepEqual([twice.outcome, twice.state.holderId, twice.state.strength, twice.state.level], ["flipped", "ben", 76, 1]);
  // Shade from someone else's loop erodes too, by at most 25.
  const nibbled = applyPush({ state: held(), walkerId: "ben", push: shade(25), day: 0, rules });
  assert.deepEqual([nibbled.outcome, nibbled.state.strength], ["eroded", 75]);
});

test("the source's numbers flip undefended fresh ground in one visit (A9 keeps the new holder at 1)", () => {
  const r = applyPush({ state: held(), walkerId: "ben", push: SOLID, day: 0, rules });
  assert.deepEqual([r.outcome, r.state.holderId, r.state.strength], ["flipped", "ben", 1]);
  assert.deepEqual(unitProblems(r.state), []);
});

test("shade is taken whole by anyone who steps on it", () => {
  const r = applyPush({ state: held({ ground: "shade", strength: 20 }), walkerId: "ben", push: SOLID, day: 0, rules });
  assert.deepEqual([r.outcome, r.state.holderId, r.state.strength, r.state.ground], ["flipped", "ben", 100, "solid"]);
});

test("deeded ground refuses every push and never decays; masked ground is never held", () => {
  const deed = held({ deeded: true, strength: 100 });
  const r = applyPush({ state: deed, walkerId: "ben", push: SOLID, day: 400, rules });
  assert.deepEqual([r.outcome, r.state.holderId, r.state.strength], ["refused_deeded", "ana", 100]);
  const masked = newUnit("school", 0, true);
  const m = applyPush({ state: masked, walkerId: "ana", push: SOLID, day: 0, rules });
  assert.deepEqual([m.outcome, m.state.holderId], ["refused_masked", null]);
});

test("decay drains from the last visit, shade 3× faster, resisted by level and fortification within the caps", () => {
  assert.equal(decayTo(held(), 10, rules).strength, 60);
  assert.equal(decayTo(held({ ground: "shade", strength: 25 }), 2, rules).strength, 1);
  // Level 5 (30%) plus fortify (30%) is capped at 50%.
  assert.equal(decayResist(5, true), MAX_DECAY_RESIST);
  assert.equal(erosionResist(5, true), MAX_EROSION_RESIST);
  assert.equal(decayTo(held({ level: 5, fortified: true }), 10, rules).strength, 80);
  // At 0 it goes back on the map, level and fortification lost.
  const gone = decayTo(held({ level: 4 }), 40, rules);
  assert.deepEqual([gone.holderId, gone.strength, gone.level, stageOf(gone, rules)], [null, 0, 1, "unheld"]);
  assert.throws(() => decayTo(held({ asOfDay: 5 }), 4, rules), RangeError);
});

test("stages follow the strength floors (D4 placeholders)", () => {
  assert.deepEqual([100, 59, 29, 9].map((strength) => stageOf(held({ strength }), rules)), ["held", "at_risk", "contested", "dormant"]);
});

test("random days never break a unit: one holder, strength 0–100, deeds and masks untouched", () => {
  let seed = 20261017;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const walkers = ["ana", "ben", "cy", "dee"];
  for (let run = 0; run < 300; run++) {
    let state: UnitState = { ...newUnit(`u${run}`, 0, next() < 0.05), level: (1 + Math.floor(next() * 5)) as 1 | 2 | 3 | 4 | 5 };
    let day = 0;
    for (let step = 0; step < 60; step++) {
      day += Math.floor(next() * 4);
      const before = state;
      const push: Push = next() < 0.6 ? SOLID : shade(Math.floor(next() * 26));
      if (state.holderId && !state.deeded && next() < 0.02) state = { ...state, deeded: true, ground: "solid" };
      state = { ...state, fortified: next() < 0.2 };
      const r = applyPush({ state, walkerId: walkers[Math.floor(next() * walkers.length)], push, day, rules });
      assert.deepEqual(unitProblems(r.state), [], `run ${run} step ${step}`);
      if (state.deeded) assert.equal(r.state.holderId, state.holderId);
      if (state.masked) assert.equal(r.state.holderId, null);
      assert.ok(r.removed >= 0 && r.removed <= 100);
      assert.ok(r.state.asOfDay === day && before.asOfDay <= day);
      state = r.state;
    }
  }
});
