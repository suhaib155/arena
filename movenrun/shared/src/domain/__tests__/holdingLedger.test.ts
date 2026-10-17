/**
 * Holding ledger: a batch of pushes over many units, applied in a fixed order,
 * once. Decay numbers are placeholders for D4.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { newUnit, unitProblems, type HoldingRules, type Push, type UnitState } from "../holding";
import { applyLedger, type PushEvent } from "../holdingLedger";

// D4 is open: these are test values only.
const rules: HoldingRules = { rulesVersion: 7, solidDecayPerDay: 4, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
const SOLID: Push = { kind: "solid" };
const held = (unitId: string, over: Partial<UnitState> = {}): UnitState => ({ ...newUnit(unitId, 0), holderId: "ana", strength: 100, ...over });
const ev = (eventId: string, unitId: string, walkerId: string, day: number, push: Push = SOLID): PushEvent => ({ eventId, unitId, walkerId, push, day });
const mapOf = (...states: UnitState[]) => new Map(states.map((s) => [s.unitId, s]));

test("a shade push under 1 is rejected on the event alone and spends nothing", () => {
  const r = applyLedger({ states: mapOf(newUnit("u1", 0)), events: [ev("e1", "u1", "ana", 0, { kind: "shade", strength: 0.6 })], rules });
  assert.deepEqual(r.results, [{ eventId: "e1", unitId: "u1", status: "rejected", reason: "invalid_event", detail: "shade strength under 1 pushes nothing" }]);
  assert.deepEqual([r.states.get("u1")?.holderId, r.entries, r.appliedEventIds], [null, [], []]);
  // On someone else's ground it would spend the walker's one push of the day for nothing.
  const other = applyLedger({ states: mapOf(held("u1")), events: [ev("e2", "u1", "ben", 0, { kind: "shade", strength: 0 }), ev("e3", "u1", "ben", 0)], rules });
  assert.deepEqual(other.results.map((x) => (x.status === "applied" ? x.outcome : x.status)), ["rejected", "flipped"]);
});

test("a flip is recorded with the previous and the new holder", () => {
  const r = applyLedger({ states: mapOf(held("u1")), events: [ev("e1", "u1", "ben", 0)], rules });
  assert.deepEqual(r.results, [{ eventId: "e1", unitId: "u1", status: "applied", outcome: "flipped", removed: 100 }]);
  assert.deepEqual(r.entries, [
    { eventId: "e1", unitId: "u1", walkerId: "ben", day: 0, pushKind: "solid", outcome: "flipped", previousHolderId: "ana", newHolderId: "ben", strengthBefore: 100, strengthAfter: 1, rulesVersion: 7 },
  ]);
  assert.equal(r.states.get("u1")?.holderId, "ben");
  assert.deepEqual(r.appliedEventIds, ["e1"]);
});

test("replaying a batch with its applied ids changes nothing", () => {
  const states = mapOf(held("u1", { level: 3 }), newUnit("u2", 0));
  const events = [ev("e1", "u1", "ben", 0), ev("e2", "u2", "ben", 0), ev("e3", "u1", "cy", 1)];
  const first = applyLedger({ states, events, rules });
  const again = applyLedger({ states: first.states, events, rules, appliedEventIds: first.appliedEventIds });
  assert.deepEqual(again.states, first.states);
  assert.deepEqual(again.entries, []);
  assert.ok(again.results.every((x) => x.status === "skipped"));
  assert.deepEqual(again.appliedEventIds, first.appliedEventIds);
  // The same id twice in one batch also counts once.
  const dup = applyLedger({ states, events: [ev("e1", "u2", "ben", 0), ev("e1", "u2", "ben", 0)], rules });
  assert.deepEqual(dup.results.map((x) => x.status), ["applied", "skipped"]);
  // The input map is not changed.
  assert.equal(states.get("u1")?.holderId, "ana");
});

test("shuffled input gives the same result", () => {
  const states = { u1: held("u1", { level: 3 }), u2: held("u2", { fortified: true }), u3: newUnit("u3", 0) };
  const events = [
    ev("a", "u1", "ben", 0), ev("b", "u1", "cy", 0), ev("c", "u2", "ben", 1), ev("d", "u3", "dee", 0),
    ev("e", "u3", "ben", 2), ev("f", "u1", "ben", 2), ev("g", "u2", "ana", 1, { kind: "shade", strength: 10 }),
  ];
  const sorted = applyLedger({ states, events, rules });
  const reversed = applyLedger({ states, events: [...events].reverse(), rules });
  const mixed = applyLedger({ states, events: [events[4], events[0], events[6], events[2], events[5], events[1], events[3]], rules });
  for (const other of [reversed, mixed]) {
    assert.deepEqual(other.states, sorted.states);
    assert.deepEqual(other.results, sorted.results);
    assert.deepEqual(other.entries, sorted.entries);
  }
  assert.deepEqual(sorted.results.map((x) => x.eventId), ["a", "b", "d", "c", "g", "e", "f"]);
});

test("one push per walker per foreign unit per day holds across a batch", () => {
  const r = applyLedger({ states: mapOf(held("u1", { level: 3 })), events: [ev("e2", "u1", "ben", 0), ev("e1", "u1", "ben", 0)], rules });
  assert.deepEqual(r.results.map((x) => (x.status === "applied" ? x.outcome : x.status)), ["eroded", "refused_daily_limit"]);
  assert.deepEqual(r.results.map((x) => (x.status === "applied" ? x.removed : -1)), [88, 0]);
  assert.equal(r.entries[1].outcome, "refused_daily_limit");
  assert.deepEqual([r.entries[1].previousHolderId, r.entries[1].newHolderId, r.entries[1].strengthAfter], ["ana", "ana", 12]);
  assert.equal(r.states.get("u1")?.strength, 12);
  // The next day the same walker may push again.
  const next = applyLedger({ states: r.states, events: [ev("e3", "u1", "ben", 1)], rules, appliedEventIds: r.appliedEventIds });
  assert.deepEqual([next.entries[0].outcome, next.states.get("u1")?.holderId], ["flipped", "ben"]);
});

test("an event dated before the unit's last change is rejected, not thrown", () => {
  const r = applyLedger({ states: mapOf(held("u1", { asOfDay: 5 })), events: [ev("old", "u1", "ben", 4), ev("ok", "u1", "ana", 5)], rules });
  assert.deepEqual(r.results[0], { eventId: "old", unitId: "u1", status: "rejected", reason: "stale_day", detail: "unit is as of day 5" });
  assert.equal(r.results[1].status, "applied");
  assert.deepEqual(r.appliedEventIds, ["ok"]);
  assert.equal(r.entries.length, 1);
});

test("an unknown unit is rejected unless createMissing makes it", () => {
  const events = [ev("e1", "nowhere", "ben", 3)];
  const off = applyLedger({ states: new Map(), events, rules });
  assert.deepEqual(off.results, [{ eventId: "e1", unitId: "nowhere", status: "rejected", reason: "unknown_unit" }]);
  assert.equal(off.states.size, 0);
  const on = applyLedger({ states: new Map(), events, rules, createMissing: true });
  assert.deepEqual([on.entries[0].outcome, on.entries[0].previousHolderId, on.states.get("nowhere")?.holderId], ["claimed", null, "ben"]);
});

test("malformed events are rejected one by one; inconsistent input states throw", () => {
  const r = applyLedger({
    states: mapOf(newUnit("u1", 0)),
    events: [ev("bad-shade", "u1", "ben", 0, { kind: "shade", strength: 26 }), ev("bad-day", "u1", "ben", 1.5), ev("good", "u1", "ben", 0)],
    rules,
  });
  assert.deepEqual(r.results.map((x) => [x.eventId, x.status]), [["bad-shade", "rejected"], ["good", "applied"], ["bad-day", "rejected"]]);
  assert.throws(() => applyLedger({ states: mapOf({ ...newUnit("u1", 0), strength: 5 }), events: [], rules }), RangeError);
  assert.throws(() => applyLedger({ states: { u1: newUnit("u2", 0) }, events: [], rules }), RangeError);
});

test("random batches keep every unit consistent, and replaying them changes nothing", () => {
  let seed = 20261017;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const walkers = ["ana", "ben", "cy", "dee"];
  for (let run = 0; run < 300; run++) {
    const unitIds = Array.from({ length: 1 + Math.floor(next() * 6) }, (_, i) => `u${i}`);
    let states = new Map<string, UnitState>();
    for (const id of unitIds) {
      const masked = next() < 0.05;
      let s: UnitState = { ...newUnit(id, 0, masked), level: (1 + Math.floor(next() * 5)) as 1 | 2 | 3 | 4 | 5, fortified: next() < 0.2 };
      if (!masked && next() < 0.7) s = { ...s, holderId: pick(walkers), strength: 1 + Math.floor(next() * 100) };
      if (s.holderId && next() < 0.05) s = { ...s, deeded: true };
      states.set(id, s);
    }
    let applied: string[] = [];
    let day = 0;
    for (let session = 0; session < 6; session++) {
      day += Math.floor(next() * 3);
      const events: PushEvent[] = Array.from({ length: Math.floor(next() * 12) }, (_, i) => ({
        eventId: `r${run}-s${session}-${i}`,
        unitId: next() < 0.1 ? "stray" : pick(unitIds),
        walkerId: pick(walkers),
        push: next() < 0.6 ? SOLID : { kind: "shade", strength: Math.floor(next() * 26) },
        day: Math.max(0, day - Math.floor(next() * 3)),
      }));
      // A retry repeats some events already sent.
      if (events.length > 0 && next() < 0.3) events.push({ ...pick(events) });
      const r = applyLedger({ states, events, rules, appliedEventIds: applied });
      assert.equal(r.results.length, events.length);
      for (const [id, s] of r.states) {
        assert.deepEqual(unitProblems(s), [], `run ${run} session ${session} unit ${id}`);
        const was = states.get(id);
        if (was?.deeded) assert.equal(s.holderId, was.holderId);
        if (was?.masked) assert.equal(s.holderId, null);
      }
      assert.ok(!r.states.has("stray"));
      assert.equal(r.entries.length, r.results.filter((x) => x.status === "applied").length);
      for (const e of r.entries) assert.equal(e.rulesVersion, rules.rulesVersion);
      const replay = applyLedger({ states: r.states, events, rules, appliedEventIds: r.appliedEventIds });
      assert.deepEqual(replay.states, r.states, `run ${run} session ${session} replay`);
      assert.deepEqual(replay.entries, []);
      states = r.states;
      applied = r.appliedEventIds;
    }
  }
});
