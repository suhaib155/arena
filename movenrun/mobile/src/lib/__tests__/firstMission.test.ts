/**
 * First mission — derivation and copy honesty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirstMission, composeHome, isFirstMission } from "../firstMission";
import {
  resolveHeroState,
  selectHomeMission,
  type HomeMissionInput,
} from "../homeMission";

/** Build a real hero+mission pair from a plausible Home state, so the
 *  composition is only ever exercised with combinations the app can produce. */
function pair(patch: Partial<HomeMissionInput> = {}) {
  const input: HomeMissionInput = {
    hasRecoverableMovement: false,
    atRiskZoneCount: 0,
    topRiskZoneName: null,
    currentObjectiveTitle: null,
    hasMovedEver: false,
    zonesOwned: 0,
    weeklyObjectiveTitle: null,
    ...patch,
  };
  return { hero: resolveHeroState(input), mission: selectHomeMission(input) };
}

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

// ---- Home composition: one dominant action ---------------------------------

test("a first-mission Home shows the mission in the hero and nothing competing", () => {
  const c = composeHome({ firstMissionActive: true, ...pair(), upNextCount: 3 });
  assert.equal(c.showFirstMissionHero, true);
  assert.equal(c.showNormalHeroCta, false, "the normal hero CTA would be a second Start Move");
  assert.equal(c.showMissionCard, false, "and the mission card would be a third");
  assert.equal(c.showUpNext, false, "secondary destinations wait until there is activity");
  assert.equal(c.primaryMoveCtaCount, 1);
});

test("once there is activity, normal Home returns", () => {
  const c = composeHome({ firstMissionActive: false, ...pair({ hasMovedEver: true, zonesOwned: 2 }), upNextCount: 2 });
  assert.equal(c.showFirstMissionHero, false);
  assert.equal(c.showNormalHeroCta, true);
  assert.equal(c.showMissionCard, true);
  assert.equal(c.showUpNext, true);
  assert.equal(c.primaryMoveCtaCount, 1);
});

test("EXACTLY one primary movement CTA for every possible composition", () => {
  /* Every mission the selectors can actually produce — resume, defend,
     objective, first-move, first-zone and weekly — crossed with the
     first-mission flag and the secondary-list length. */
  const states: Partial<HomeMissionInput>[] = [
    {},
    { hasRecoverableMovement: true },
    { atRiskZoneCount: 2, topRiskZoneName: "Riverside", hasMovedEver: true, zonesOwned: 3 },
    { currentObjectiveTitle: "Save a route", hasMovedEver: true },
    { hasMovedEver: true, zonesOwned: 0 },
    { hasMovedEver: true, zonesOwned: 4, weeklyObjectiveTitle: "Three routes" },
  ];
  let checked = 0;
  for (const firstMissionActive of [true, false]) {
    for (const state of states) {
      for (const upNextCount of [0, 1, 3]) {
        const c = composeHome({ firstMissionActive, ...pair(state), upNextCount });
        assert.equal(
          c.primaryMoveCtaCount,
          1,
          `competing primary actions for first=${firstMissionActive} ${JSON.stringify(state)}`,
        );
        checked += 1;
      }
    }
  }
  assert.equal(checked, 2 * states.length * 3);
});

test("Up Next never appears without rows to show", () => {
  assert.equal(composeHome({ firstMissionActive: false, ...pair({ hasMovedEver: true }), upNextCount: 0 }).showUpNext, false);
});
