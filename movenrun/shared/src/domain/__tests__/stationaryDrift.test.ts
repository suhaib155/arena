/**
 * MR-C stationary drift (LOCAL, SYNTHETIC evidence; Track A S03).
 *
 * A still phone that reports 6 m while its real error wanders 15 m must not
 * bank its error cloud as walked distance; honest walks must keep theirs.
 * The guard reduces the phantom distance, it does not remove it: the residual
 * bound asserted here is the documented one, not zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { observedScatterMeters, stationaryDriftProblems, STATIONARY_DRIFT_POLICY } from "../evidence";
import { capture, circle, fixStream, line } from "./support/driftRoute";

const S03 = { seconds: 300, accuracy: 6, sigma: 15 };
const SEEDS = Array.from({ length: 12 }, (_, i) => 1031 + i);

test("S03: the guard cuts phantom distance for a still, overconfident phone", () => {
  const before: number[] = [], after: number[] = [];
  for (const seed of SEEDS) {
    const fixes = fixStream({ seed, ...S03 });
    before.push(capture(fixes, false).meters);
    after.push(capture(fixes, true).meters);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  assert.ok(median(before) > 400, `unguarded median ${median(before).toFixed(0)} m (the S03 defect)`);
  assert.ok(median(after) < 0.4 * median(before), `guarded median ${median(after).toFixed(0)} m`);
  /* Residual, stated rather than hidden: not zero. */
  assert.ok(Math.max(...after) < 300, `guarded worst case ${Math.max(...after).toFixed(0)} m`);
});

test("a still phone whose accuracy is honest banks nothing", () => {
  for (const seed of SEEDS) {
    const { meters } = capture(fixStream({ seed, seconds: 300, accuracy: 10, sigma: 4 }), true);
    assert.equal(Math.round(meters), 0, `seed ${seed}`);
  }
});

test("honest walks keep their distance (straight, slow, and small loops)", () => {
  const cases = [
    { name: "300 m at 1.4 m/s", path: line(1.4), seconds: 214, truth: 300 },
    { name: "150 m at 0.42 m/s", path: line(0.42), seconds: 357, truth: 150 },
    { name: "laps of a 40 m-radius loop", path: circle(40, 1.4), seconds: 400, truth: 560 },
  ];
  for (const c of cases) {
    for (const seed of SEEDS.slice(0, 6)) {
      const fixes = fixStream({ seed, seconds: c.seconds, accuracy: 8, sigma: 3, correlation: 0.8, path: c.path });
      const unguarded = capture(fixes, false).meters;
      const guarded = capture(fixes, true).meters;
      assert.ok(guarded >= 0.9 * Math.min(unguarded, c.truth),
        `${c.name} seed ${seed}: ${guarded.toFixed(0)} m guarded, ${unguarded.toFixed(0)} m unguarded, ${c.truth} m walked`);
      assert.ok(guarded <= c.truth * 1.15 + 20, `${c.name}: never more than was walked (${guarded.toFixed(0)} m)`);
    }
  }
});

test("observed scatter: small for a straight walk, large for a jumping error cloud", () => {
  const walk = fixStream({ seed: 5, seconds: 40, accuracy: 8, sigma: 3, correlation: 0.8, path: line(1.4) });
  const still = fixStream({ seed: 5, ...S03, seconds: 40 }).slice(0, STATIONARY_DRIFT_POLICY.scatterFixes);
  assert.ok(observedScatterMeters(walk.slice(0, 8)) < 6, `walk ${observedScatterMeters(walk.slice(0, 8)).toFixed(1)}`);
  assert.ok(observedScatterMeters(still) > 6, `still ${observedScatterMeters(still).toFixed(1)}`);
  assert.equal(observedScatterMeters(walk.slice(0, 3)), 0, "too few fixes: no estimate");
});

test("server check: an unguarded S03 upload wanders in place; honest uploads do not", () => {
  const points = (fixes: ReturnType<typeof fixStream>) => fixes;
  let flagged = 0;
  for (const seed of SEEDS) {
    const { accepted } = capture(fixStream({ seed, ...S03 }), false);
    if (stationaryDriftProblems(points(accepted)).length > 0) flagged += 1;
  }
  assert.ok(flagged >= SEEDS.length - 1, `${flagged}/${SEEDS.length} stationary uploads flagged`);
  for (const path of [line(1.4), circle(25, 1.4), circle(40, 1.4)]) {
    for (const seed of SEEDS.slice(0, 6)) {
      const { accepted } = capture(fixStream({ seed, seconds: 400, accuracy: 8, sigma: 3, correlation: 0.8, path }), false);
      assert.deepEqual(stationaryDriftProblems(accepted), [], `honest upload seed ${seed}`);
    }
  }
});

test("server check never joins two stretches across a pause", () => {
  const { accepted } = capture(fixStream({ seed: 1031, ...S03 }), false);
  const everyGapPaused = accepted.slice(1).map((p, i) => ({ startedAt: accepted[i]!.timestamp + 1, endedAt: p.timestamp - 1 }));
  assert.deepEqual(stationaryDriftProblems(accepted, everyGapPaused), []);
});

/* Documented nonpassable cases (MR-C doc, section 3). The wander rule is
   speed-blind: an honest loop fails when two minutes of path exceed four
   times its diameter, so the narrowest passable loop grows with pace. Clean
   synthetic loops, no noise: this pins the rule's geometry, not GPS. */
test("server check: honest loops lose below about 30 x speed metres across (documented)", () => {
  const loop = (diameter: number, speed: number) => {
    const path = circle(diameter / 2, speed);
    const fixes = [];
    for (let t = 0; t <= 600; t += 4) {
      const { x, y } = path(t);
      fixes.push({ latitude: -30 + y / 111_320, longitude: -140 + x / (111_320 * Math.cos((30 * Math.PI) / 180)),
        timestamp: 1_000_000 + t * 1000, accuracy: 5 });
    }
    return stationaryDriftProblems(fixes).length > 0 ? "rejected" : "passes";
  };
  assert.equal(loop(40, 1.4), "rejected", "walking laps of a 40 m loop");
  assert.equal(loop(50, 1.4), "passes");
  assert.equal(loop(60, 2.5), "rejected", "jogging laps of a 60 m loop");
  assert.equal(loop(80, 2.5), "passes");
  assert.equal(loop(100, 3.5), "rejected", "running laps of a 100 m loop");
  assert.equal(loop(130, 3.5), "passes");
});
