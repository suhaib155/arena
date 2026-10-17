/**
 * The takeover simulation option (alternatives to ASSUMPTION A9). Absent, the
 * holding model behaves exactly as before; present, a flip may need a
 * challenge on an earlier day or be capped per unit per day. The owner rule
 * (one push per walker per unit per day) holds under every setting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyPush, newUnit, unitProblems, withoutTakeoverMarks, type HoldingRules, type Push, type TakeoverRule, type UnitState } from "../holding";
import { applyLedger, type PushEvent } from "../holdingLedger";

const base: HoldingRules = { rulesVersion: 1, solidDecayPerDay: 3, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
const challenge: TakeoverRule = { challenge: { windowDays: 3, floor: 50, immediateBelowStrength: 30 }, maxFlipsPerUnitPerDay: null };
const withChallenge: HoldingRules = { ...base, takeover: challenge };
const withCap: HoldingRules = { ...base, takeover: { challenge: null, maxFlipsPerUnitPerDay: 1 } };
const SOLID: Push = { kind: "solid" };
const held = (over: Partial<UnitState> = {}): UnitState => ({ ...newUnit("u1", 0), holderId: "ana", strength: 100, ...over });
const push = (state: UnitState, walkerId: string, day: number, rules: HoldingRules, p: Push = SOLID) => applyPush({ state, walkerId, push: p, day, rules });

test("without a takeover rule nothing changes: one visit flips fresh ground, and no marks are ever written", () => {
  const r = push(held(), "ben", 0, base);
  assert.equal(r.outcome, "flipped");
  assert.equal(r.state.strength, 1);
  assert.equal("challenges" in r.state, false);
  assert.equal("flips" in r.state, false);
  const same = held();
  assert.equal(withoutTakeoverMarks(same), same, "a state with no marks is returned as is");
});

test("seeded random days give identical results with the default rules and with an explicitly absent takeover rule", () => {
  let x = 12345;
  const rand = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const events: PushEvent[] = [];
  for (let day = 0; day < 40; day++) {
    for (let k = 0; k < 30; k++) {
      const shade = rand() < 0.2;
      events.push({ eventId: `e${String(day).padStart(3, "0")}:${String(k).padStart(3, "0")}`, unitId: `u${Math.floor(rand() * 6)}`, walkerId: `w${Math.floor(rand() * 5)}`, day, push: shade ? { kind: "shade", strength: 1 + Math.floor(rand() * 24) } : SOLID });
    }
  }
  const states = new Map([...Array(6).keys()].map((i) => [`u${i}`, newUnit(`u${i}`, 0)]));
  const a = applyLedger({ states, events, rules: base });
  const b = applyLedger({ states, events, rules: { ...base, takeover: undefined } });
  assert.deepStrictEqual(b, a);
  for (const s of a.states.values()) assert.equal("challenges" in s || "flips" in s, false);
});

test("two-day challenge: the first push leaves the floor and a challenge, the same walker flips on a later day", () => {
  const d0 = push(held(), "ben", 0, withChallenge);
  assert.equal(d0.outcome, "eroded");
  assert.equal(d0.state.strength, 50);
  assert.deepEqual(d0.state.challenges, [{ walkerId: "ben", day: 0 }]);
  assert.deepEqual(unitProblems(d0.state), []);
  // Same day, second push: the owner rule refuses it whatever the mode.
  assert.equal(push(d0.state, "ben", 0, withChallenge).outcome, "refused_daily_limit");
  // Another walker the same or next day only challenges too.
  const other = push(d0.state, "cal", 1, withChallenge);
  assert.equal(other.outcome, "eroded");
  assert.equal(other.state.holderId, "ana");
  assert.deepEqual(other.state.challenges?.map((c) => c.walkerId), ["ben", "cal"]);
  // The challenger, a later day: flips at the A9 overflow.
  const d1 = push(other.state, "ben", 1, withChallenge);
  assert.equal(d1.outcome, "flipped");
  assert.equal(d1.state.holderId, "ben");
  assert.equal("challenges" in d1.state, false, "a flip clears every challenge");
});

test("the holder's visit answers a challenge; an expired challenge starts again", () => {
  const d0 = push(held(), "ben", 0, withChallenge);
  const visit = push(d0.state, "ana", 1, withChallenge);
  assert.equal(visit.outcome, "reinforced");
  assert.equal(visit.state.strength, 100);
  assert.equal("challenges" in visit.state, false);
  assert.equal(push(visit.state, "ben", 2, withChallenge).outcome, "eroded", "the old challenge is gone");
  // Window of 3 days: a push on day 4 after a day-0 challenge is a new challenge, not a flip.
  const late = push(d0.state, "ben", 4, withChallenge);
  assert.equal(late.outcome, "eroded");
  assert.deepEqual(late.state.challenges, [{ walkerId: "ben", day: 4 }]);
});

test("long-unvisited ground below the immediate line and stepped-on shade still fall at once", () => {
  const stale = push(held({ strength: 29 }), "ben", 0, withChallenge);
  assert.equal(stale.outcome, "flipped");
  const shadeUnit = push(held({ strength: 20, ground: "shade" }), "ben", 0, withChallenge);
  assert.equal(shadeUnit.outcome, "flipped");
  assert.equal(shadeUnit.state.strength, 100);
});

test("a challenged unit that decays to nothing loses its marks with its holder", () => {
  const d0 = push(held({ strength: 60 }), "ben", 0, withChallenge);
  const gone = push(d0.state, "cal", 40, withChallenge);
  assert.equal(gone.outcome, "claimed");
  assert.equal(gone.state.holderId, "cal");
  assert.equal("challenges" in gone.state, false);
  assert.deepEqual(unitProblems(gone.state), []);
});

test("unit flip cap: a unit changes hands at most once a day; the next day it can again", () => {
  const f1 = push(held(), "ben", 0, withCap);
  assert.equal(f1.outcome, "flipped");
  assert.deepEqual(f1.state.flips, { day: 0, count: 1 });
  const f2 = push(f1.state, "cal", 0, withCap);
  assert.equal(f2.outcome, "eroded");
  assert.equal(f2.state.holderId, "ben");
  assert.equal(f2.state.strength, 1);
  const f3 = push(withoutTakeoverMarks({ ...f2.state, strength: 100 }), "cal", 1, withCap);
  assert.equal(f3.outcome, "flipped");
});

test("states with malformed marks are refused", () => {
  assert.ok(unitProblems({ ...newUnit("u1", 0), challenges: [{ walkerId: "ben", day: 0 }] }).includes("unheld ground has challenges"));
  assert.ok(unitProblems(held({ challenges: [{ walkerId: "ana", day: 0 }] })).includes("holder challenges own ground"));
  assert.ok(unitProblems(held({ challenges: [{ walkerId: "ben", day: 5 }] })).includes("challenge is from a later day"));
  assert.ok(unitProblems(held({ flips: { day: 0, count: 0 } })).includes("flip count is malformed"));
});
