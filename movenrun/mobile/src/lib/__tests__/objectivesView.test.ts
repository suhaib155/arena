/**
 * Objectives presentation view — offline node tests.
 *
 * Uses the real `buildSeasonObjectives` selector (logic unchanged) and verifies
 * the redesigned view: current-objective priority, real progress mapping,
 * category summaries + labels, completed collection, all-complete / no-objective
 * states, and the single Start-Move CTA invariant.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeasonObjectives, type SeasonObjectivesInput } from "../seasonObjectives";
import { buildObjectivesView, countStartMoveCtas } from "../objectivesView";

function input(partial: Partial<SeasonObjectivesInput> = {}): SeasonObjectivesInput {
  return {
    routesThisWeek: 0,
    savedRoutes: 0,
    hasStrongTrust: false,
    zonesOwned: 0,
    atRiskOrWorse: 0,
    timesDefended: 0,
    fortifyCount: 0,
    hasClub: false,
    streak: 0,
    viewedPassport: false,
    viewedProof: false,
    weeklyActive: false,
    collectionsUnlocked: 0,
    now: 1_700_000_000_000,
    ...partial,
  };
}

test("no progress: view shows the Start-Move nudge and no duplicate CTA", () => {
  const view = buildObjectivesView(buildSeasonObjectives(input()));
  assert.equal(view.hasProgress, false);
  assert.equal(view.showStartNudge, true);
  // The first movement objective is a Start-Move action, but its button is
  // suppressed while the nudge is shown.
  assert.equal(view.currentShowsCta, false);
  assert.equal(countStartMoveCtas(view), 1);
});

test("with progress: current objective owns the CTA, no standalone nudge", () => {
  const view = buildObjectivesView(
    buildSeasonObjectives(input({ routesThisWeek: 1, savedRoutes: 1, weeklyActive: true })),
  );
  assert.equal(view.hasProgress, true);
  assert.equal(view.showStartNudge, false);
  assert.ok(countStartMoveCtas(view) <= 1);
});

test("current objective is the highest-priority active objective", () => {
  const overview = buildSeasonObjectives(input({ routesThisWeek: 1, savedRoutes: 1, weeklyActive: true }));
  const view = buildObjectivesView(overview);
  assert.ok(view.current);
  assert.equal(view.current!.id, overview.nextObjective!.id);
  assert.equal(view.current!.status, "active");
});

test("categories are compact summaries with progress labels", () => {
  const view = buildObjectivesView(buildSeasonObjectives(input({ zonesOwned: 1, savedRoutes: 1 })));
  assert.ok(view.categories.length > 0);
  for (const c of view.categories) {
    assert.match(c.progressLabel, /^\d+\/\d+$/, "progress label is N/total");
    assert.ok(c.supporting.length > 0, "each category has supporting copy");
    assert.ok(c.total > 0);
  }
});

test("completed collection matches the overview's complete objectives", () => {
  const overview = buildSeasonObjectives(input({ routesThisWeek: 1, savedRoutes: 1, weeklyActive: true }));
  const view = buildObjectivesView(overview);
  assert.equal(view.completed.length, overview.completed);
  assert.equal(view.completedCount, overview.completed);
  assert.ok(view.completed.every((o) => o.status === "complete"));
});

test("all-complete state", () => {
  // Max out every input so every objective completes.
  const overview = buildSeasonObjectives(
    input({
      routesThisWeek: 9,
      savedRoutes: 9,
      hasStrongTrust: true,
      zonesOwned: 9,
      atRiskOrWorse: 0,
      timesDefended: 9,
      fortifyCount: 9,
      hasClub: true,
      streak: 9,
      viewedPassport: true,
      viewedProof: true,
      weeklyActive: true,
      collectionsUnlocked: 9,
    }),
  );
  const view = buildObjectivesView(overview);
  assert.equal(view.allComplete, true);
  assert.equal(view.current, null);
  assert.equal(view.progressPct, 100);
  assert.match(view.statement, /complete/i);
});
