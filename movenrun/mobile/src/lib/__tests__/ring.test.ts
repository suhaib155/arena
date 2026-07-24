/**
 * Circular-progress geometry — offline node tests.
 *
 * The ring is two clipped semicircles rotated into place, which is impossible
 * to eyeball in a diff, so the sweep is verified numerically: empty parks both
 * halves out of sight, half fills exactly the right side, full closes the loop,
 * and the sweep never runs backwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ringStroke, ringSweep } from "../ring";

test("zero progress parks both semicircles fully out of view", () => {
  const s = ringSweep(0);
  assert.equal(s.rightDeg, -180);
  assert.equal(s.leftDeg, -180);
  assert.equal(s.progress, 0);
});

test("half progress fills the right semicircle exactly and leaves the left empty", () => {
  const s = ringSweep(0.5);
  assert.equal(s.rightDeg, 0, "right half fully rotated into place");
  assert.equal(s.leftDeg, -180, "left half still hidden");
});

test("full progress closes the ring", () => {
  const s = ringSweep(1);
  assert.equal(s.rightDeg, 0);
  assert.equal(s.leftDeg, 0);
  assert.equal(s.progress, 1);
});

test("quarter progress rotates the right half exactly halfway", () => {
  const s = ringSweep(0.25);
  assert.equal(s.rightDeg, -90);
  assert.equal(s.leftDeg, -180, "left half untouched below 50%");
});

test("three-quarter progress holds the right half full and half-rotates the left", () => {
  const s = ringSweep(0.75);
  assert.equal(s.rightDeg, 0);
  assert.equal(s.leftDeg, -90);
});

test("the sweep advances monotonically and never leaves its rotation range", () => {
  let prevR = -Infinity;
  let prevL = -Infinity;
  for (let i = 0; i <= 100; i += 1) {
    const s = ringSweep(i / 100);
    assert.ok(s.rightDeg >= prevR, `right sweep reversed at ${i}%`);
    assert.ok(s.leftDeg >= prevL, `left sweep reversed at ${i}%`);
    assert.ok(s.rightDeg >= -180 && s.rightDeg <= 0, `right out of range at ${i}%`);
    assert.ok(s.leftDeg >= -180 && s.leftDeg <= 0, `left out of range at ${i}%`);
    prevR = s.rightDeg;
    prevL = s.leftDeg;
  }
});

test("out-of-range and non-finite progress clamps instead of throwing", () => {
  // Live counters overshoot; a tracking screen must render "full", not crash.
  assert.deepEqual(ringSweep(2), ringSweep(1));
  assert.deepEqual(ringSweep(-1), ringSweep(0));
  assert.deepEqual(ringSweep(Number.NaN), ringSweep(0));
  assert.deepEqual(ringSweep(Number.POSITIVE_INFINITY), ringSweep(0));
});

test("stroke weight scales with diameter and stays inside legible bounds", () => {
  assert.ok(ringStroke(40) >= 6, "small rings keep a visible stroke");
  assert.ok(ringStroke(400) <= 16, "large rings do not swallow their centre");
  assert.ok(ringStroke(200) > ringStroke(80), "weight tracks diameter");
  assert.ok(Number.isInteger(ringStroke(132)), "whole pixels");
});
