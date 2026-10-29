/**
 * stationary-risk/v1 classifier and flag parsing (pure, SYNTHETIC inputs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessStationaryRisk,
  DEFAULT_STATIONARY_RISK_RULE,
  parseStationaryRiskRule,
  STATIONARY_RISK_RULE_OFF,
  STATIONARY_RISK_RULE_V1,
  STATIONARY_RISK_V1_POLICY,
  type RiskPoint,
} from "./domain/stationaryRisk.js";
import { captureRoute, CORPUS, corpusSeed } from "./testing/stationaryRiskCorpus.js";
import { measureFamily, rates } from "./testing/stationaryRiskRates.js";

const toRisk = (points: readonly { lat: number; lng: number; accuracy: number; timestamp: number }[]): RiskPoint[] =>
  points.map((p) => ({ latitude: p.lat, longitude: p.lng, accuracy: p.accuracy, timestamp: p.timestamp }));

test("the rule is off unless selected; unknown values refuse to start", () => {
  assert.equal(DEFAULT_STATIONARY_RISK_RULE, STATIONARY_RISK_RULE_OFF);
  assert.equal(parseStationaryRiskRule(undefined), STATIONARY_RISK_RULE_OFF);
  assert.equal(parseStationaryRiskRule(""), STATIONARY_RISK_RULE_OFF);
  assert.equal(parseStationaryRiskRule("off"), STATIONARY_RISK_RULE_OFF);
  assert.equal(parseStationaryRiskRule(" stationary-risk/v1 "), STATIONARY_RISK_RULE_V1);
  for (const bad of ["on", "true", "v1", "stationary-risk/v2", "STATIONARY-RISK/V1"]) {
    assert.throws(() => parseStationaryRiskRule(bad), /MOVEMENT_STATIONARY_RISK_RULE/);
  }
});

test("too little evidence to judge is eligible, not review", () => {
  const p = (i: number, x: number): RiskPoint => ({ latitude: 0, longitude: x / 111_320, accuracy: 6, timestamp: 1_000_000 + i * 8000 });
  // Five zig-zag segments: fewer than the window minimum.
  const zig = [0, 15, 0, 15, 0, 15].map((x, i) => p(i, x));
  const verdict = assessStationaryRisk(zig);
  assert.equal(verdict.verdict, "eligible");
  assert.equal(verdict.windowsAssessed, 0);
  assert.equal(assessStationaryRisk([]).verdict, "eligible");
});

test("a pause splits windows: drift is never joined across an explicit break", () => {
  const family = CORPUS.find((f) => f.truth === "stationary")!;
  const { observation } = captureRoute(family.scenario(corpusSeed(family, 0)));
  const points = toRisk(observation.points);
  assert.equal(assessStationaryRisk(points).verdict, "review");
  // A break before every fourth point leaves no window long enough to judge.
  const broken = points.map((p, i) => (i % 4 === 0 && i > 0 ? { ...p, breakBefore: true } : p));
  const verdict = assessStationaryRisk(broken);
  assert.equal(verdict.windowsAssessed, 0);
  assert.equal(verdict.verdict, "eligible");
});

test("assessment carries aggregates only, no coordinates", () => {
  const family = CORPUS.find((f) => f.truth === "stationary")!;
  const { observation } = captureRoute(family.scenario(corpusSeed(family, 1)));
  const verdict = assessStationaryRisk(toRisk(observation.points));
  assert.deepEqual(Object.keys(verdict).sort(), ["medianIncoherence", "pathMeters", "ruleId", "stationaryLikeMeters",
    "stationaryLikeShare", "verdict", "windowsAssessed", "windowsStationaryLike"]);
});

test("corpus rates under the stated synthetic assumptions: no honest route withheld, stationary drift withheld", () => {
  const outcomes = CORPUS.map((f) => measureFamily(f, 6));
  const r = rates(outcomes, STATIONARY_RISK_V1_POLICY);
  assert.ok(r.honestVerified >= 150, `honest sample ${r.honestVerified}`);
  assert.equal(r.honestFlagged, 0, "false positives on honest families");
  assert.ok(r.stationaryVerified >= 70, `stationary sample ${r.stationaryVerified}`);
  assert.ok(r.stationaryAccepted / r.stationaryVerified <= 0.03, `false negatives ${r.stationaryAccepted}/${r.stationaryVerified}`);
});
