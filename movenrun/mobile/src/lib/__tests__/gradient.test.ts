/**
 * Gradient maths — offline node tests. Verifies hex parsing, endpoint fidelity,
 * monotonic ramps, band-count clamping, and alpha suffixing, so a bad colour
 * token fails here rather than rendering an invisible or banded surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alpha, gradientStops, hexToRgb, mixHex, rgbToHex } from "../gradient";

test("parses #RGB and #RRGGBB, with or without the hash", () => {
  assert.deepEqual(hexToRgb("#FFFFFF"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("000000"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb("#F00"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hexToRgb("#3355FF"), { r: 0x33, g: 0x55, b: 0xff });
});

test("rejects malformed colour tokens loudly", () => {
  for (const bad of ["", "#12345", "#GGGGGG", "blue", "#12345678"]) {
    assert.throws(() => hexToRgb(bad), /invalid hex colour/, `should reject ${bad || "empty"}`);
  }
});

test("rgbToHex round-trips and always returns 6 uppercase digits", () => {
  for (const hex of ["#3355FF", "#00C989", "#0A0F1F", "#FFB43D"]) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex.toUpperCase());
  }
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), "#000000");
});

test("mixHex returns the endpoints exactly at t=0 and t=1, and clamps beyond", () => {
  const from = "#3355FF";
  const to = "#8A5CFF";
  assert.equal(mixHex(from, to, 0), from);
  assert.equal(mixHex(from, to, 1), to);
  assert.equal(mixHex(from, to, -5), from, "t below 0 clamps to the start");
  assert.equal(mixHex(from, to, 5), to, "t above 1 clamps to the end");
});

test("mixHex midpoint lands between the endpoints on every channel", () => {
  const mid = hexToRgb(mixHex("#000000", "#FFFFFF", 0.5));
  assert.ok(mid.r > 0 && mid.r < 255, "midpoint is strictly between black and white");
  assert.equal(mid.r, mid.g);
  assert.equal(mid.g, mid.b, "a neutral ramp stays neutral");
});

test("gradientStops includes both endpoints and honours the step count", () => {
  const stops = gradientStops("#3355FF", "#8A5CFF", 14);
  assert.equal(stops.length, 14);
  assert.equal(stops[0], "#3355FF");
  assert.equal(stops[stops.length - 1], "#8A5CFF");
});

test("gradientStops clamps degenerate step counts instead of throwing", () => {
  assert.equal(gradientStops("#000000", "#FFFFFF", 1).length, 2, "one band cannot be a gradient");
  assert.equal(gradientStops("#000000", "#FFFFFF", 0).length, 2);
  assert.equal(gradientStops("#000000", "#FFFFFF", 999).length, 64, "capped for render cost");
});

test("gradientStops ramps monotonically across a channel", () => {
  const reds = gradientStops("#000000", "#FF0000", 10).map((s) => hexToRgb(s).r);
  for (let i = 1; i < reds.length; i += 1) {
    assert.ok(reds[i] >= reds[i - 1], `red channel must not reverse at stop ${i}`);
  }
});

test("alpha appends a two-digit suffix and clamps out-of-range opacity", () => {
  assert.equal(alpha("#3355FF", 1), "#3355FFFF");
  assert.equal(alpha("#3355FF", 0), "#3355FF00");
  assert.equal(alpha("#3355FF", 2), "#3355FFFF");
  assert.equal(alpha("#3355FF", -1), "#3355FF00");
  assert.match(alpha("#3355FF", 0.12), /^#3355FF[0-9A-F]{2}$/);
});
