/**
 * Responsive sizing — offline node tests across real device classes, plus the
 * source guard that keeps the movement-tracking screen from ever cropping its
 * controls again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPACT_HEIGHT, fs, isCompact, isTiny, TINY_HEIGHT, vh } from "../responsive";

/** Viewport heights (dp) for phones the app actually ships to. */
const DEVICES = {
  tinyAndroid: 640,
  compactIphoneSE: 667,
  midAndroid: 780,
  iphone14: 844,
  tallAndroid: 915,
};

test("classifies compact and tiny viewports at the documented thresholds", () => {
  assert.equal(isCompact(COMPACT_HEIGHT - 1), true);
  assert.equal(isCompact(COMPACT_HEIGHT), false, "threshold itself is not compact");
  assert.equal(isTiny(TINY_HEIGHT - 1), true);
  assert.equal(isTiny(TINY_HEIGHT), false);
  assert.equal(isCompact(DEVICES.iphone14), false);
  assert.equal(isTiny(DEVICES.compactIphoneSE), false, "SE is compact but not tiny");
});

test("vh clamps to the given range and rounds to whole pixels", () => {
  assert.equal(vh(844, 0.28, 150, 248), Math.round(844 * 0.28));
  assert.equal(vh(400, 0.28, 150, 248), 150, "short viewport clamps up to min");
  assert.equal(vh(2000, 0.28, 150, 248), 248, "tall viewport clamps down to max");
  assert.ok(Number.isInteger(vh(781, 0.33, 10, 900)), "returns whole pixels");
});

test("vh rejects an inverted range instead of silently returning nonsense", () => {
  assert.throws(() => vh(844, 0.3, 200, 100), /max must be >= min/);
});

test("fs only ever shrinks type, never inflates it", () => {
  for (const h of Object.values(DEVICES)) {
    assert.ok(fs(68, h) <= 68, `must not exceed the base size at height ${h}`);
  }
  assert.equal(fs(68, DEVICES.tallAndroid), 68, "full size on a tall screen");
  assert.ok(fs(68, DEVICES.compactIphoneSE) < 68, "shrinks on a compact screen");
  assert.ok(
    fs(68, DEVICES.tinyAndroid) < fs(68, DEVICES.compactIphoneSE),
    "tiny shrinks more than compact",
  );
});

test("fs never drops below the legibility floor", () => {
  assert.ok(fs(20, DEVICES.tinyAndroid, 18) >= 18);
  assert.equal(fs(10, DEVICES.tinyAndroid, 18), 10, "a size already under the floor is left alone");
});

test("the hero metric always fits a tiny viewport with room for the controls", () => {
  // The tracking screen must fit: top bar + canvas + hero + row + card + bar.
  const h = DEVICES.tinyAndroid;
  const canvas = vh(h, 0.28, 150, 248);
  const hero = fs(68, h, 40);
  assert.ok(canvas + hero < h * 0.6, "canvas + hero must leave over 40% for the rest");
});

/** Strip block and line comments so guards assert on code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the movement session keeps its controls outside the scrolling body", () => {
  const src = readFileSync(join(process.cwd(), "app", "move", "session.tsx"), "utf8");
  // The readouts scroll…
  assert.match(src, /<ScrollView/, "session body must scroll");
  // …and the control bar is a sibling *after* the ScrollView closes, not inside
  // it, so it can never scroll away or be pushed off a short screen.
  const closeIdx = src.indexOf("</ScrollView>");
  const barIdx = src.indexOf("<MovementControlBar");
  assert.ok(closeIdx > 0 && barIdx > closeIdx, "control bar must follow </ScrollView>");
  // A margin-pinned bar is exactly what overflowed before — keep it gone.
  // Checked against code only, so a comment mentioning it does not trip this.
  assert.ok(
    !/marginTop:\s*"auto"/.test(code(src)),
    'must not re-introduce marginTop:"auto" pinning',
  );
});

test("screens with fixed art boards derive their height from the viewport", () => {
  const app = join(process.cwd(), "app");
  const cases: [string, string][] = [
    [join(app, "move", "session.tsx"), "RouteCanvas"],
    [join(app, "move", "captured.tsx"), "stage"],
    [join(app, "route", "proof.tsx"), "TerritoryHero"],
    [join(app, "active.tsx"), "ring"],
  ];
  for (const [file, what] of cases) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /useResponsive\(\)/, `${what} in ${file} must size from the viewport`);
    assert.match(src, /r\.vh\(/, `${what} in ${file} must use a clamped viewport height`);
  }
});
