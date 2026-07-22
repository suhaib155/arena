/**
 * Weekly Recap presentation view — offline node tests. Uses the real
 * `buildWeeklyRecap`; verifies dominant-metric selection, the empty state, that
 * supporting metrics don't duplicate the dominant one, and that NO fabricated
 * previous-week comparison/trend is introduced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyRecap, type WeeklyRecapInput } from "../weeklyRecap";
import { buildRecapView, pickDominantMetric } from "../recapView";
import type { CompletionRecord } from "../../store/useGameStore";
import type { RouteTrustRecord } from "../routeTrust";

const NOW = 1_700_000_000_000;

function recapInput(partial: Partial<WeeklyRecapInput> = {}): WeeklyRecapInput {
  return { history: [], routeTrustHistory: [], zones: [], streak: 0, now: NOW, ...partial };
}

function route(distanceMeters: number, durationSeconds: number): RouteTrustRecord {
  return {
    id: `r-${Math.random()}`,
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    trustScore: 80,
    trustLabel: "Strong",
    explanation: "",
    positiveSignals: [],
    riskFlags: [],
    distanceMeters,
    durationSeconds,
    routeOutcome: "saved",
    zoneCountTouched: 0,
    defendedCount: 0,
  };
}

test("no activity → empty view, no dominant metric", () => {
  const view = buildRecapView(buildWeeklyRecap(recapInput()));
  assert.equal(view.hasActivity, false);
  assert.equal(view.dominant, null);
  assert.deepEqual(view.supporting, []);
});

test("distance is the dominant metric when real distance exists", () => {
  const view = buildRecapView(buildWeeklyRecap(recapInput({ routeTrustHistory: [route(3200, 1500)] })));
  assert.equal(view.hasActivity, true);
  assert.equal(view.dominant?.kind, "distance");
  assert.match(view.dominant!.value, /km/);
});

test("falls back to the strongest real metric when there's no distance", () => {
  // A completed quest gives XP but no route distance.
  const quest: CompletionRecord = {
    questId: "q1",
    questTitle: "Q",
    xp: 40,
    completedAt: new Date(NOW - 3_600_000).toISOString(),
  };
  const view = buildRecapView(buildWeeklyRecap(recapInput({ history: [quest] })));
  assert.equal(view.hasActivity, true);
  assert.notEqual(view.dominant, null);
  assert.notEqual(view.dominant!.kind, "distance");
});

test("supporting metrics never repeat the dominant metric", () => {
  const view = buildRecapView(buildWeeklyRecap(recapInput({ routeTrustHistory: [route(3200, 1500)] })));
  assert.ok(view.supporting.length <= 3);
  // dominant is distance; supporting labels must not be a distance in km again
  assert.ok(!view.supporting.some((s) => /km/.test(s.value)));
});

test("view exposes no fabricated comparison/trend fields", () => {
  const view = buildRecapView(buildWeeklyRecap(recapInput({ routeTrustHistory: [route(3200, 1500)] })));
  const keys = Object.keys(view);
  for (const forbidden of ["comparison", "trend", "previous", "changePct", "delta"]) {
    assert.ok(!keys.includes(forbidden), `must not expose ${forbidden}`);
  }
  assert.equal(view.localPreview, true);
  assert.ok(view.nextFocus.length > 0);
});

test("pickDominantMetric prefers distance strictly over routes", () => {
  const recap = buildWeeklyRecap(recapInput({ routeTrustHistory: [route(500, 300), route(700, 300)] }));
  assert.equal(pickDominantMetric(recap)?.kind, "distance");
});
