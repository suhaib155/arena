import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptPoint, distanceMeters, type TrackPoint } from "../geo";

const epoch = 1_700_000_000_000;
const metresPerDegree = 6_371_000 * Math.PI / 180;
function fix(x: number, y: number, seconds: number, accuracy = 5): TrackPoint {
  return { latitude: y / metresPerDegree, longitude: x / metresPerDegree,
    timestamp: epoch + seconds * 1000, accuracy };
}
function measure(points: TrackPoint[]) {
  let previous: TrackPoint | null = null, distance = 0;
  const accepted: TrackPoint[] = [];
  for (const point of points) if (acceptPoint(previous, point)) {
    if (previous) distance += distanceMeters(previous, point);
    previous = point; accepted.push(point);
  }
  return { distance, accepted };
}

test("stationary 5–30 m uncertainty clouds do not accumulate movement", () => {
  for (const radius of [5, 10, 20, 30]) {
    const points = Array.from({ length: 451 }, (_, i) => {
      const angle = i * 2.399963229728653;
      const r = radius * (0.35 + 0.65 * ((i * 37 % 101) / 100));
      return fix(r * Math.cos(angle), r * Math.sin(angle), i * 4, radius);
    });
    assert.ok(measure(points).distance < 1, `stationary cloud radius ${radius}: ${measure(points).distance} m`);
  }
});

for (const [label, speed] of [["slow walk", 0.7], ["brisk walk", 1.7], ["run", 4]] as const) {
  test(`${label} with metre-scale noise stays within 5% plus 12 m endpoint tolerance`, () => {
    const route = Array.from({ length: 151 }, (_, i) =>
      fix(i * 4 * speed + Math.sin(i * 1.7), Math.cos(i * 2.1), i * 4));
    const expected = 600 * speed;
    const actual = measure(route).distance;
    assert.ok(Math.abs(actual - expected) <= expected * 0.05 + 12, `${actual} vs ${expected}`);
  });
}

test("stale and duplicate timestamp fixes never add distance", () => {
  const previous = fix(0, 0, 20);
  assert.equal(acceptPoint(previous, fix(3, 0, 19)), false);
  assert.equal(acceptPoint(previous, fix(3, 0, 20)), false);
});

test("50 m outlier, weak accuracy and vehicle speed do not extend accepted route", () => {
  const previous = fix(0, 0, 0);
  assert.equal(acceptPoint(previous, fix(50, 0, 4)), false);
  assert.equal(acceptPoint(previous, fix(20, 0, 4, 80)), false);
  assert.equal(acceptPoint(previous, fix(60, 0, 4)), false);
});
