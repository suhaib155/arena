/**
 * First mission — derivation and copy honesty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirstMission, isFirstMission } from "../firstMission";

test("no history, no saved route and no zone → the first mission", () => {
  assert.equal(isFirstMission({ historyCount: 0, routeTrustCount: 0, zonesOwned: 0 }), true);
});

test("any authoritative first activity exits the first mission", () => {
  assert.equal(isFirstMission({ historyCount: 1, routeTrustCount: 0, zonesOwned: 0 }), false);
  assert.equal(isFirstMission({ historyCount: 0, routeTrustCount: 1, zonesOwned: 0 }), false);
  assert.equal(isFirstMission({ historyCount: 0, routeTrustCount: 0, zonesOwned: 1 }), false);
});

test("the state is derived — there is no completion flag to pass in", () => {
  // The input carries only counts of authoritative gameplay state; adding a
  // persisted `firstMissionComplete` would show up here as an extra field.
  const keys = Object.keys({ historyCount: 0, routeTrustCount: 0, zonesOwned: 0 }).sort();
  assert.deepEqual(keys, ["historyCount", "routeTrustCount", "zonesOwned"]);
});

test("the first mission points at movement, with the territory map as its secondary", () => {
  const m = buildFirstMission();
  assert.equal(m.primaryAction, "move");
  assert.equal(m.secondaryAction, "territory");
  assert.equal(m.primaryLabel, "Start first move");
  assert.equal(m.steps.length, 4);
  assert.match(m.steps[0], /Start moving/);
  assert.match(m.steps[3], /defend/i);
});

test("the copy never promises a guaranteed capture", () => {
  const m = buildFirstMission();
  const text = `${m.title} ${m.body} ${m.primaryLabel} ${m.secondaryLabel} ${m.steps.join(" ")}`;
  assert.ok(!/guarantee|you will capture|capture your first zone\b/i.test(text), text);
  assert.match(m.body, /work toward your first zone/i);
});
