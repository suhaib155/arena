/**
 * The legacy earning estimate must not convert its multiplier to 18-decimal
 * units through a float (settlement invariants, item 2). Pure; no provider
 * or network is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_RATE } from "@movenrun/shared";
import { earningFor } from "./token.service.js";

test("a 1.1 gear multiplier earns exactly 1.1 × the rate per km, not the float's 1.1000000000000001", () => {
  // 1 km at 10 per km (18 decimals) × 1.1 = 11, exactly.
  assert.equal(earningFor(1000, BASE_RATE, 1.1), 11n * 10n ** 18n);
  assert.equal(earningFor(1000, BASE_RATE, 1), BASE_RATE);
  assert.equal(earningFor(2500, BASE_RATE, 0.3), (25n * BASE_RATE * 3n) / 100n);
});

test("distance must be a non-negative safe integer and the multiplier a finite non-negative decimal", () => {
  for (const d of [-1, 1.5, 2 ** 53, Number.NaN]) assert.throws(() => earningFor(d, BASE_RATE, 1), RangeError, String(d));
  for (const g of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e-19]) assert.throws(() => earningFor(1000, BASE_RATE, g), RangeError, String(g));
  assert.throws(() => earningFor(1000, -1n, 1), RangeError);
});
