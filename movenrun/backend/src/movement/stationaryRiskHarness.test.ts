/**
 * Pins the stationary-risk/v1 false-positive / false-negative numbers from the
 * seeded synthetic harness (testing/stationaryRiskHarness.ts).
 *
 * These numbers are conditional on the generator named below and say nothing
 * about real phones. If a threshold in domain/stationaryRisk.ts changes, the
 * numbers here WILL move: update them on purpose, in the same commit, and
 * restate them in docs/play-launch/STATIONARY_RISK_RULE_28OCT.md. If the
 * generator or the families change, bump HARNESS_VERSION as well.
 *
 * Runtime is about 15 s for the whole file (50 seeds per family).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CORPUS, corpusSeed } from "./testing/stationaryRiskCorpus.js";
import {
  accuracyMismatch, CORPUS_SEED_BASE, countGroup, headline, HARNESS_VERSION, HEADLINE_SEEDS, pauseMarkerBypass,
  slowDrift, slowWalks, smallLoop, stableFixtureVerdicts, vehicleFamilies,
} from "./testing/stationaryRiskHarness.js";

const SEEDS = HEADLINE_SEEDS;

test("generator identity: version, seed base and seeds per family are what the pinned numbers were taken at", () => {
  assert.equal(HARNESS_VERSION, "sr-harness/1 (corpus generator: stationaryRiskCorpus.ts, AR(1) error, 4 s / 5 m watch)");
  assert.equal(CORPUS_SEED_BASE, 0x5eed);
  assert.equal(SEEDS, 50);
  assert.equal(CORPUS.length, 44);
  const f = CORPUS[0]!;
  assert.equal(corpusSeed(f, 0), CORPUS_SEED_BASE + f.name.length * 131);
  assert.equal(corpusSeed(f, 3), CORPUS_SEED_BASE + 3 * 7919 + f.name.length * 131);
});

test("HEADLINE (seed base 0x5eed, 50 seeds, sr-harness/1): FP 0/1400, FN 5/650, stress 82/150", () => {
  const h = headline(SEEDS);
  assert.deepEqual(h, {
    honestVerified: 1400, honestFlagged: 0,
    stationaryVerified: 650, stationaryAccepted: 5,
    stressVerified: 150, stressFlagged: 82,
  });
});

test("ADVERSARIAL reported-accuracy mismatch: real error 0.8x and 1.5x the reported accuracy raise FP (known sensitivity)", () => {
  const a = accuracyMismatch(0.8, SEEDS), b = accuracyMismatch(1.5, SEEDS);
  assert.deepEqual([a.verifiedOff, a.withheld], [1400, 78]);
  assert.deepEqual([b.verifiedOff, b.withheld], [1400, 323]);
});

test("ADVERSARIAL honest loops under about 75 m (tracks, playgrounds): withheld below the floor, fine at 75 m (known limit)", () => {
  const got = ([[30, 1.4], [50, 1.4], [50, 3], [75, 1.4]] as const).map(([c, v]) => {
    const g = countGroup([smallLoop(c, v)], SEEDS);
    return [c, v, g.verifiedOff, g.withheld];
  });
  assert.deepEqual(got, [[30, 1.4, 33, 28], [50, 1.4, 49, 14], [50, 3, 49, 23], [75, 1.4, 50, 0]]);
});

test("ADVERSARIAL slow genuine drift: a phone left still with slowly correlated error (FN grows at rho 0.99)", () => {
  const got = ([0.5, 0.7, 0.99] as const).map((rho) => {
    const g = countGroup([slowDrift(rho)], SEEDS);
    return [rho, g.verifiedOff, g.verifiedOff - g.withheld];
  });
  assert.deepEqual(got, [[0.5, 50, 0], [0.7, 50, 0], [0.99, 50, 8]]);
  // Slow genuine walking is not drift: none withheld.
  const walks = countGroup(slowWalks, SEEDS);
  assert.deepEqual([walks.verifiedOff, walks.withheld], [100, 0]);
});

test("ADVERSARIAL vehicle-like segments: the rule withholds none; speed rules decide these, as with the rule off", () => {
  const got = vehicleFamilies.map((f) => { const g = countGroup([f], SEEDS); return [g.verifiedOff, g.withheld]; });
  assert.deepEqual(got, [[7, 0], [50, 0], [50, 0]]);
});

test("KNOWN BYPASS: client-sent pause markers splitting every window leave nothing to assess (current behaviour, not a design goal)", () => {
  const b = pauseMarkerBypass(4, SEEDS);
  assert.equal(b.verifiedOff, 50);
  assert.equal(b.withheldPlain, 50, "without markers the S03 drift is withheld");
  // KNOWN BYPASS: with a break before every 4th point every one of them is verified again.
  assert.equal(b.bypassed, 50);
  assert.equal(b.withheldMarked, 0);
});

test("stable fixtures W04, I02, C01 are identical rule off and on; S03 is verified off and withheld on (its purpose)", () => {
  const v = Object.fromEntries(stableFixtureVerdicts(SEEDS).map((x) => [x.id, x]));
  for (const id of ["W04", "I02", "C01"]) {
    assert.deepEqual([v[id]!.unchanged, v[id]!.verifiedOff, v[id]!.verifiedOn], [50, 50, 50], id);
  }
  assert.deepEqual([v.S03!.unchanged, v.S03!.verifiedOff, v.S03!.verifiedOn], [0, 50, 0]);
});
