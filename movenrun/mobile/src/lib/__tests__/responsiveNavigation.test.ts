import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(process.cwd(), "src/components", name), "utf8");

test("header title can wrap without competing with its status slot", () => {
  const src = read("ScreenHeader.tsx");
  assert.doesNotMatch(src, /numberOfLines=/);
  assert.match(src, /const CONTROL = 44/);
  assert.match(src, /<View style=\{styles\.trailing\} \/>/);
  assert.match(src, /<View style=\{styles\.statusRow\}>\{trailing\}/);
});

test("navigation exposes actual tab selection while preserving Move and Territory actions", () => {
  const src = read("MovenTabBar.tsx");
  assert.match(src, /accessibilityRole=\{isTab \? "tab" : "button"\}/);
  assert.match(src, /selected=\{isTab \? active : undefined\}/);
  assert.match(src, /label="Territory"\s+isTab=\{false\}/);
  assert.match(src, /if \(!isFocused && !event\.defaultPrevented\) \{\s+tapFeedback\(\)/);
  assert.doesNotMatch(src, /\bheight: 64/);
});

test("entrance reduced motion sets its final state and cancels outstanding motion", () => {
  const src = read("FadeSlideIn.tsx");
  assert.match(src, /if \(reducedMotion\) \{\s+progress\.stopAnimation\(\);\s+progress\.setValue\(1\);\s+return/);
  assert.match(src, /return \(\) => animation\.stop\(\)/);
});

test("movement actions retain intrinsic height and allow large labels to wrap", () => {
  const src = read("MovementControlBar.tsx");
  assert.match(src, /minHeight: 58/);
  assert.match(src, /controlLabel: \{[^}]*flexShrink: 1/);
  assert.match(src, /paused \? ink\.green/);
});
