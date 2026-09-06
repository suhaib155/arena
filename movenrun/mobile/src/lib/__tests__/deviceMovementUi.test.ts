import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(path, "utf8");

test("live numeral line boxes exceed glyph sizes and preserve Android font padding", () => {
  const metric = source("src/components/MovementMetric.tsx");
  for (const name of ["heroValue", "tileValue"]) {
    const block = metric.match(new RegExp(`${name}: \\{([\\s\\S]*?)\\n  \\}`))![1];
    const size = Number(block.match(/fontSize: (\d+)/)![1]);
    const line = Number(block.match(/lineHeight: (\d+)/)![1]);
    assert.ok(line >= size * 1.2, `${name} must reserve font ascent/descent breathing room`);
    assert.match(block, /includeFontPadding: true/);
    assert.doesNotMatch(block, /\bheight:|overflow: "hidden"/);
  }
});

test("Finish sheet defaults to Keep moving, handles Back safely and blocks duplicate submission", () => {
  const sheet = source("src/components/FinishSessionSheet.tsx");
  assert.match(sheet, /onRequestClose=\{onKeepMoving\}/);
  assert.match(sheet, /ref=\{safeAction\} onPress=\{onKeepMoving\}/);
  assert.match(sheet, /setAccessibilityFocus\(target\)/);
  assert.match(sheet, /accessibilityViewIsModal/);
  assert.match(sheet, /animationType=\{reducedMotion \? "none" : "fade"\}/);
  assert.match(sheet, /if \(submitted\.current\) return;\s+submitted\.current = true;\s+onFinish\(\)/);
  assert.match(sheet, /Math\.max\(insets\.bottom, spacing\.md\)/);
  assert.ok(sheet.indexOf('accessibilityLabel="Keep moving"') < sheet.indexOf('label="Finish"'));
  const session = source("app/move/session.tsx");
  assert.doesNotMatch(session, /Alert\.alert\("Finish session/);
  assert.match(session, /<FinishSessionSheet/);
  assert.match(session, /finishLifecycle\(lifecycleRef\.current, at\)/);
});

test("live screen uses acquisition status immediately and retains cell-based memoization", () => {
  const session = source("app/move/session.tsx");
  assert.match(session, /if \(!cancelled\) setAcquisitionState\(state\)/);
  assert.match(session, /acquisitionLabel\(acquisitionState\)/);
  assert.match(session, /contextCells\(head\), \[cellKey\]/);
  assert.match(session, /if \(controlsAvailable\) gpsTimings\.live\(\)/);
});
