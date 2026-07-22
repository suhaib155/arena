/**
 * Signal-quality classification — offline node tests. Locks the 25 m threshold
 * the session has always used and the searching/locked/weak mapping shared by
 * the Start readiness chip and the Active Move chip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signalFromAccuracy,
  signalVisual,
  STRONG_ACCURACY_M,
} from "../signalQuality";

test("null / non-finite accuracy → searching (no usable fix yet)", () => {
  assert.equal(signalFromAccuracy(null), "searching");
  assert.equal(signalFromAccuracy(undefined), "searching");
  assert.equal(signalFromAccuracy(Number.NaN), "searching");
  assert.equal(signalFromAccuracy(Number.POSITIVE_INFINITY), "searching");
});

test("accuracy at/below the strong threshold → locked", () => {
  assert.equal(signalFromAccuracy(5), "locked");
  assert.equal(signalFromAccuracy(STRONG_ACCURACY_M), "locked");
});

test("accuracy worse than the strong threshold → weak", () => {
  assert.equal(signalFromAccuracy(STRONG_ACCURACY_M + 0.1), "weak");
  assert.equal(signalFromAccuracy(60), "weak");
});

test("visuals never rely on colour alone — each state has a text label", () => {
  for (const q of ["searching", "locked", "weak"] as const) {
    const v = signalVisual(q);
    assert.ok(v.label.length > 0, `${q} needs a label`);
    assert.ok(v.icon.length > 0, `${q} needs an icon`);
  }
  assert.equal(signalVisual("weak").tone, "warning");
  assert.equal(signalVisual("locked").tone, "ok");
});
