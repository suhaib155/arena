/**
 * MR-A-02: no distance across an unobserved bridge (LOCAL, SYNTHETIC evidence).
 *
 * After a rejected jump the capture loop keeps its last accepted fix as the
 * anchor. When the vehicle slows down far away, the next fix is accepted
 * against that stale anchor and the straight line between them used to count
 * as walking. These tests replay synthetic tracks through the real
 * `inspectFix` and measure with the real evidence functions the app preview
 * uses (`createCanonicalEvidence`) and the server distance uses
 * (`evidenceDistance` / `hasEvidenceBreak`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCanonicalEvidence, evidenceDistance, hasEvidenceBreak } from "../evidence";
import { haversineMeters } from "../geo";
import { isUnobservedBridge, ON_FOOT_POLICY } from "../measurement";
import { sealingRulesFor } from "../sealing";
import { buildRoute, I02, type RouteSpec, type SyntheticRoute } from "./support/syntheticRoute";

function previewDistance(route: SyntheticRoute): number {
  const evidence = createCanonicalEvidence(sealingRulesFor(1)!, route.pauses);
  for (const fix of route.accepted) evidence.push(fix);
  return evidence.distanceMeters;
}

function measure(spec: RouteSpec) {
  const route = buildRoute(spec);
  const preview = previewDistance(route);
  const canonical = evidenceDistance(route.accepted, route.pauses);
  // Client preview and canonical measurement must agree.
  assert.ok(Math.abs(preview - canonical) < 0.01, `preview ${preview} vs canonical ${canonical}`);
  return { route, distance: canonical };
}

test("I02: the vehicle leg contributes no distance, the walking stretches still count", () => {
  const { route, distance } = measure(I02);
  const longest = Math.max(...route.accepted.slice(1).map((p, i) => haversineMeters(route.accepted[i]!, p)));
  // The bridge is still uploaded as two accepted fixes...
  assert.ok(longest > 1_500, `expected a stale-anchor bridge in the accepted track, got ${longest}`);
  // ...but it is not credited.
  assert.ok(distance < route.walkedTruthMeters + 30, `credited ${distance} m for ${route.walkedTruthMeters} m walked`);
  assert.ok(distance > 0.6 * route.walkedTruthMeters, `walking under-credited: ${distance} m`);
});

test("I02: the stale-anchor pair is a break wherever the route is measured or drawn", () => {
  const route = buildRoute(I02);
  const breaks = route.accepted.slice(1).filter((p, i) => hasEvidenceBreak(route.accepted[i]!, p, route.pauses));
  assert.equal(breaks.length, 1);
});

test("subway outage: no fixes while riding, nothing credited across the outage", () => {
  const { route, distance } = measure({
    seed: 11, accuracy: 6,
    legs: [
      { kind: "move", speed: 1.3, seconds: 160 },
      { kind: "outage", speed: 8, seconds: 300, heading: 90 },
      { kind: "move", speed: 1.3, seconds: 160 },
    ],
  });
  assert.ok(distance < route.walkedTruthMeters + 30, `credited ${distance} m`);
  assert.ok(distance > 0.7 * route.walkedTruthMeters);
});

test("explicit pause and resume: the paused span is still never bridged", () => {
  const { route, distance } = measure({
    seed: 12, accuracy: 5,
    legs: [
      { kind: "move", speed: 1.4, seconds: 150 },
      { kind: "pause", speed: 6, seconds: 120, heading: 45 },
      { kind: "move", speed: 1.4, seconds: 150 },
    ],
  });
  assert.equal(route.pauses.length, 1);
  assert.ok(distance < route.walkedTruthMeters + 30 && distance > 0.8 * route.walkedTruthMeters, `${distance}`);
});

test("short phone sleep at walking pace keeps the walking-pace bridge", () => {
  const { route, distance } = measure({
    seed: 13, accuracy: 6,
    legs: [
      { kind: "move", speed: 1.3, seconds: 150 },
      { kind: "outage", speed: 1.3, seconds: 90 },
      { kind: "move", speed: 1.3, seconds: 150 },
    ],
  });
  const total = route.walkedTruthMeters + 1.3 * 90;
  assert.ok(distance > 0.85 * total && distance < total + 30, `${distance} of ${total}`);
});

test("stop and start: a three-minute stand loses no walking", () => {
  const { route, distance } = measure({
    seed: 14, accuracy: 8, jitter: 3,
    legs: [
      { kind: "move", speed: 1.4, seconds: 150 },
      { kind: "still", seconds: 180 },
      { kind: "move", speed: 1.4, seconds: 150 },
    ],
  });
  assert.ok(distance > 0.85 * route.walkedTruthMeters && distance < route.walkedTruthMeters + 30, `${distance}`);
});

test("irregular sampling (1 to 8 s between fixes) is not penalised", () => {
  const { route, distance } = measure({
    seed: 15, accuracy: 7, interval: [1, 8],
    legs: [{ kind: "move", speed: 1.3, seconds: 480, heading: 30 }],
  });
  assert.ok(distance > 0.85 * route.walkedTruthMeters && distance < route.walkedTruthMeters + 30, `${distance}`);
});

test("slow walker or wheelchair at 0.4 m/s with weak accuracy still counts", () => {
  const { route, distance } = measure({
    seed: 16, accuracy: 25,
    legs: [{ kind: "move", speed: 0.4, seconds: 1_200, heading: 300 }],
  });
  assert.ok(route.accepted.length >= 3);
  assert.ok(distance > 0.8 * route.walkedTruthMeters && distance < route.walkedTruthMeters + 50, `${distance}`);
});

test("runner at 3.5 m/s with 20 m accuracy is not broken up", () => {
  const { route, distance } = measure({
    seed: 17, accuracy: 20,
    legs: [{ kind: "move", speed: 3.5, seconds: 600, heading: 120 }],
  });
  // speed > 3 is excluded from walkedTruthMeters, so compare to the run length.
  const ran = 3.5 * 600;
  assert.equal(route.walkedTruthMeters, 0);
  assert.ok(distance > 0.9 * ran && distance < ran + 50, `${distance} of ${ran}`);
});

test("one benign GPS spike does not wipe or inflate an honest walk", () => {
  const { route, distance } = measure({
    seed: 18, accuracy: 6,
    legs: [{ kind: "move", speed: 1.4, seconds: 400 }],
    spikes: [{ atSecond: 200, offsetMeters: 90, accuracy: 6 }],
  });
  assert.ok(distance > 0.9 * route.walkedTruthMeters && distance < route.walkedTruthMeters + 30, `${distance}`);
});

test("bridge rule: uncertainty is capped, so a claimed 10 km accuracy cannot explain a vehicle leg", () => {
  const a = { latitude: 51.5, longitude: -0.12, timestamp: 1_000_000, accuracy: 10_000 };
  const b = { latitude: 51.5162, longitude: -0.12, timestamp: 1_150_000, accuracy: 10_000 }; // ~1.8 km in 150 s
  assert.equal(isUnobservedBridge(a, b), true);
  // Missing accuracy is read at the policy cap, never as unbounded.
  assert.equal(isUnobservedBridge({ ...a, accuracy: undefined }, { ...b, accuracy: undefined }), true);
});

test("bridge rule: only gaps longer than the fix-age window are examined", () => {
  const a = { latitude: 51.5, longitude: -0.12, timestamp: 1_000_000, accuracy: 5 };
  const fast = { latitude: 51.50099, longitude: -0.12, timestamp: 1_000_000 + ON_FOOT_POLICY.maxFixAgeMs, accuracy: 5 };
  assert.equal(isUnobservedBridge(a, fast), false); // 110 m in 10 s: a sprint, judged by inspectFix
  const long = { latitude: 51.50001, longitude: -0.12, timestamp: 1_000_000 + ON_FOOT_POLICY.maxBridgeGapMs + 1, accuracy: 5 };
  assert.equal(isUnobservedBridge(a, long), true); // a long silence is never bridged
});
