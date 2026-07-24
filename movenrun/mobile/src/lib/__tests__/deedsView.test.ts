/**
 * Deeds presentation view — offline node tests. Uses the real
 * `buildDeedShowroom`; verifies no-deeds / ready / locked states, featured
 * selection, honest status labels (never "owned"), and that no fabricated
 * rarity/value/ownership/finality field is introduced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeedShowroom, type DeedPreviewInput } from "../deedPreview";
import { buildDeedsView, deedStatusLabel } from "../deedsView";
import type { Zone } from "../../types";
import type { DistrictMasteryOverview } from "../districtMastery";
import type { RouteSignalPassport } from "../routePassport";

const NOW = 1_700_000_000_000;

function zone(id: string): Zone {
  return {
    id,
    name: `Zone ${id}`,
    state: "yours",
    controlPercent: 90,
    defensePercent: 80,
    lastTouchedAt: new Date(NOW).toISOString(),
    capturedAt: new Date(NOW - 86_400_000).toISOString(),
    lastDefendedAt: new Date(NOW).toISOString(),
    lastFortifiedAt: null,
    fortifyCount: 2,
    isDeedPreview: false,
    isDemo: false,
  };
}

const emptyMastery: DistrictMasteryOverview = {
  districts: [],
  topDistrict: null,
} as unknown as DistrictMasteryOverview;

function passport(score: number): RouteSignalPassport {
  return {
    readinessScore: score,
    readinessLabel: "Building signal",
    explanation: "",
    reviewedRouteCount: 2,
    cleanRouteCount: 1,
    averageTrustScore: score,
    cleanRouteStreak: 1,
    recentRiskCount: 0,
    topStrengths: [],
    improvementTips: [],
    checklist: [],
    previewOnly: true,
  };
}

function input(p: Partial<DeedPreviewInput> = {}): DeedPreviewInput {
  return {
    hasZones: true,
    zones: [zone("a")],
    districtMastery: emptyMastery,
    passport: passport(40),
    now: NOW,
    ...p,
  };
}

test("no zones → no ready previews, actionable statement", () => {
  const v = buildDeedsView(buildDeedShowroom(input({ hasZones: false, zones: [] })));
  assert.equal(v.hasZones, false);
  assert.equal(v.ready, 0);
  assert.ok(v.lockedCards.length > 0);
  assert.match(v.statement, /Capture zones/);
});

test("with a captured zone → at least one ready preview + featured", () => {
  const v = buildDeedsView(buildDeedShowroom(input()));
  assert.equal(v.hasZones, true);
  assert.ok(v.ready >= 1);
  assert.notEqual(v.featured, null);
  assert.equal(v.featured!.ready, true);
  assert.equal(v.total, v.ready + v.locked);
});

test("readyPct is ready/total and statement says 'earned on this device'", () => {
  const v = buildDeedsView(buildDeedShowroom(input()));
  assert.equal(v.readyPct, Math.round((v.ready / v.total) * 100));
  assert.match(v.statement, /earned on this device/);
});

test("status labels are honest — never 'owned' / financial / mint", () => {
  const v = buildDeedsView(buildDeedShowroom(input()));
  for (const c of [...v.readyCards, ...v.lockedCards]) {
    const label = deedStatusLabel(c);
    for (const forbidden of ["owned", "mint", "sell", "trade", "value", "price", "rarity"]) {
      assert.ok(!label.toLowerCase().includes(forbidden), `label must not contain ${forbidden}`);
    }
  }
  assert.match(deedStatusLabel(v.featured!), /earned on this device/);
});

test("deed cards carry no rarity/value/price/floor/yield/owner field", () => {
  const v = buildDeedsView(buildDeedShowroom(input()));
  const sample = v.readyCards[0] ?? v.lockedCards[0];
  for (const forbidden of ["rarity", "value", "price", "floor", "yield", "owner", "supply", "marketCap"]) {
    assert.ok(!(forbidden in sample), `deed card must not expose ${forbidden}`);
  }
});
