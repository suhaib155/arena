/**
 * Phase 3 source guards — offline, scoped to the retention/social files.
 *
 * Fail if an accessibility label is dropped from a new control, if the
 * collapsed/expanded state stops being exposed, or if a redesigned screen
 * introduces a JS-driven animation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = join(process.cwd(), "src", "components");
const APP = join(process.cwd(), "app");

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

// ---- accessibility on new primitives ---------------------------------------

test("ProgressHero exposes a summary label (progress not colour-only)", () => {
  const src = read(COMPONENTS, "ProgressHero.tsx");
  assert.match(src, /accessibilityRole="summary"/);
  assert.match(src, /accessibilityLabel=/);
});

test("CompletedSummary exposes expanded/collapsed state to assistive tech", () => {
  const src = read(COMPONENTS, "CompletedSummary.tsx");
  assert.match(src, /accessibilityRole="button"/);
  assert.match(src, /Collapse completed|Expand completed/);
  // completion is shown with an icon + text, not colour alone
  assert.match(src, /checkmark/);
});

test("RankRow is labelled and its trend carries a text label", () => {
  const src = read(COMPONENTS, "RankRow.tsx");
  assert.match(src, /accessibilityLabel=/);
  assert.match(src, /label: "rising"/);
  assert.match(src, /label: "slipping"/);
  assert.match(src, /label: "steady"/);
});

// ---- native-driver safety across the redesigned screens --------------------

const SCREENS = [
  join(APP, "season-objectives.tsx"),
  join(APP, "weekly-recap.tsx"),
  join(APP, "(tabs)", "clubs.tsx"),
];

test("no redesigned retention/social screen enables the JS animation driver", () => {
  for (const f of SCREENS) {
    const src = read(f);
    assert.ok(
      !/useNativeDriver:\s*false/.test(src),
      `${f} must not use the JS animation driver`,
    );
  }
});

test("Clubs City War animation stays on the native driver (opacity/transform only)", () => {
  const src = read(APP, "(tabs)", "clubs.tsx");
  assert.match(src, /useNativeDriver:\s*true/);
  // Only opacity + transform are animated (native-driver-safe).
  assert.ok(!/left:\s*pulse|top:\s*pulse|width:\s*pulse|height:\s*pulse/.test(src));
});
