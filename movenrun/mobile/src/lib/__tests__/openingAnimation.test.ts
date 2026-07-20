/**
 * Opening-animation crash regression — offline node tests.
 *
 * Covers the production math behind the scan band (exact translateX travel
 * that replaced the unsupported native-driven `left` animation), the tap
 * guard that deduplicates replay/exit taps, and a lightweight source guard
 * SCOPED to the opening animation files: it fails if an `Animated.View`
 * there ever binds a layout style (left/right/top/bottom/width/height/
 * margin/padding) inline again, or if `useNativeDriver: true` disappears /
 * `useNativeDriver: false` sneaks in. Deliberately not a repo-wide regex.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTapGuard,
  SCAN_BAND_WIDTH,
  SCAN_END_FRACTION,
  SCAN_START_FRACTION,
  scanTranslateRange,
} from "../openingAnimation";

// ---- scan travel math -------------------------------------------------------

test("scanTranslateRange reproduces the original -40% → 140% travel in pixels", () => {
  const r = scanTranslateRange(320);
  assert.ok(r);
  assert.deepEqual(r!.inputRange, [0, 1]);
  assert.deepEqual(r!.outputRange, [-128, 448], "-0.4 * 320 → 1.4 * 320");
  // The band starts fully off-canvas left and ends fully off-canvas right.
  assert.ok(r!.outputRange[0] + SCAN_BAND_WIDTH <= 0, "start: band entirely off the left edge");
  assert.ok(r!.outputRange[1] >= 320, "end: band entirely past the right edge");
  assert.equal(SCAN_START_FRACTION, -0.4);
  assert.equal(SCAN_END_FRACTION, 1.4);
});

test("scan animation is gated until the board has a real measured width", () => {
  assert.equal(scanTranslateRange(0), null, "zero width: do not start a 0 → 0 animation");
  assert.equal(scanTranslateRange(-10), null);
  assert.equal(scanTranslateRange(Number.NaN), null);
  assert.equal(scanTranslateRange(Number.POSITIVE_INFINITY), null);
});

// ---- replay/exit tap deduplication -----------------------------------------

test("tap guard: one tap wins per cooldown window; replay works again after it elapses", () => {
  let t = 1000;
  const guard = createTapGuard(1200, () => t);
  assert.equal(guard.tryAcquire(), true, "first tap starts the action");
  assert.equal(guard.tryAcquire(), false, "immediate double-tap is ignored");
  t += 500;
  assert.equal(guard.tryAcquire(), false, "rapid re-tap within the window is ignored");
  t += 1200;
  assert.equal(guard.tryAcquire(), true, "after the window, replay is available again");
  assert.equal(guard.tryAcquire(), false, "and the new window deduplicates again");
});

// ---- scoped native-driver regression guard ---------------------------------

// The package test script runs from movenrun/mobile, so cwd anchors the tree.
const OPENING_ANIMATION_FILES = [
  join(process.cwd(), "app", "opening.tsx"),
  join(process.cwd(), "src", "components", "FadeSlideIn.tsx"),
];

/** Extract every `<Animated.View ...>` opening tag (attribute text spans
 *  lines; capture up to the tag-closing `>`). */
function animatedViewTags(source: string): string[] {
  const tags: string[] = [];
  const re = /<Animated\.View\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    for (let i = m.index; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        tags.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

const LAYOUT_STYLE_KEY_RE =
  /\b(left|right|top|bottom|width|height|margin\w*|padding\w*)\s*:/;

test("opening animation: no Animated.View binds a layout style the native driver cannot animate", () => {
  for (const file of OPENING_ANIMATION_FILES) {
    const src = readFileSync(file, "utf8");
    const tags = animatedViewTags(src);
    assert.ok(tags.length > 0, `${file} should contain Animated.View usage`);
    for (const tag of tags) {
      const hit = tag.match(LAYOUT_STYLE_KEY_RE);
      assert.equal(
        hit,
        null,
        `${file}: Animated.View inline style binds layout property "${hit?.[1]}" — ` +
          `unsupported by the native animated module (the crash this hotfix fixed). ` +
          `Use transform: [{ translateX/translateY }] instead.\nTag: ${tag}`
      );
    }
  }
});

test("opening animation stays fully on the native driver", () => {
  const opening = readFileSync(OPENING_ANIMATION_FILES[0], "utf8");
  const enabled = opening.match(/useNativeDriver:\s*true/g) ?? [];
  assert.ok(enabled.length >= 3, "pulse (x2) and scan animations all declare useNativeDriver: true");
  assert.ok(!/useNativeDriver:\s*false/.test(opening), "the fix must not fall back to the JS driver");
  assert.ok(
    !/outputRange:\s*\[\s*["']/.test(opening),
    "no interpolation outputs percentage/color strings — the scan travel is numeric pixels"
  );
  assert.ok(/translateX:\s*scanX/.test(opening), "the scan band moves via transform translateX");
});
