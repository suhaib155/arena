/**
 * Collections presentation view — offline node tests. Uses the real
 * `buildCollections`; verifies no-progress / active / completed / all-complete
 * states, locked-entry truthfulness, and that NO rarity/value/ownership is
 * fabricated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollections, type BadgeInput } from "../zoneCollections";
import { buildCollectionsView, lockedRequirement } from "../collectionsView";

function input(p: Partial<BadgeInput> = {}): BadgeInput {
  return {
    savedRoutes: 0,
    cleanRoutes: 0,
    hasStrongTrust: false,
    zonesCaptured: 0,
    atRiskOrWorse: 0,
    timesDefended: 0,
    fortifyCount: 0,
    hasClub: false,
    viewedPassport: false,
    viewedProof: false,
    ...p,
  };
}

test("no progress: nothing unlocked, no in-progress, not all-complete", () => {
  const v = buildCollectionsView(buildCollections(input()));
  assert.equal(v.unlocked, 0);
  assert.equal(v.hasProgress, false);
  assert.equal(v.allComplete, false);
  assert.ok(v.lockedBadges.length > 0);
  assert.equal(v.unlockedBadges.length, 0);
});

test("active: real partial progress surfaces in-progress + nextBadge", () => {
  // 2 zones captured → "3 Zones Captured" is in progress (2/3).
  const v = buildCollectionsView(buildCollections(input({ zonesCaptured: 2 })));
  assert.equal(v.hasProgress, true);
  assert.ok(v.inProgress.some((b) => b.current > 0 && b.current < b.target));
  assert.notEqual(v.nextBadge, null);
});

test("completed: unlocking a badge moves it to the unlocked archive", () => {
  const v = buildCollectionsView(buildCollections(input({ savedRoutes: 1 })));
  assert.ok(v.unlocked >= 1);
  assert.ok(v.unlockedBadges.every((b) => b.status === "unlocked"));
});

test("all-complete state", () => {
  const v = buildCollectionsView(
    buildCollections(
      input({
        savedRoutes: 20,
        cleanRoutes: 20,
        hasStrongTrust: true,
        zonesCaptured: 20,
        atRiskOrWorse: 0,
        timesDefended: 20,
        fortifyCount: 20,
        hasClub: true,
        viewedPassport: true,
        viewedProof: true,
      }),
    ),
  );
  assert.equal(v.allComplete, true);
  assert.equal(v.completionPct, 100);
  assert.equal(v.nextBadge, null);
});

test("locked entries surface a real requirement, not a fabricated rarity", () => {
  const v = buildCollectionsView(buildCollections(input()));
  const locked = v.lockedBadges[0];
  assert.ok(locked);
  const req = lockedRequirement(locked);
  assert.ok(req.length > 0);
  assert.equal(req.includes("rarity"), false);
});

test("badges carry no rarity/value/ownership/mint fields (no fabrication)", () => {
  const v = buildCollectionsView(buildCollections(input({ zonesCaptured: 1 })));
  const sample = [...v.unlockedBadges, ...v.inProgress, ...v.lockedBadges][0];
  assert.ok(sample);
  for (const forbidden of ["rarity", "value", "price", "owner", "mint", "scarcity", "probability"]) {
    assert.ok(!(forbidden in sample), `badge must not expose ${forbidden}`);
  }
});
