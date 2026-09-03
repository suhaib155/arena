/**
 * Phase 2 source guards — offline, scoped to the movement/territory files.
 *
 * These are lightweight source checks (no renderer), mirroring the existing
 * opening-animation guard. They fail if an accessibility label is dropped from
 * a new icon-only control, if the Active Move lifecycle/back protection
 * regresses, or if any movement screen sneaks in a JS-driven animation.
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

// ---- accessibility labels for the new icon-only controls -------------------

test("ReadinessChip states its status as a label (not colour-only)", () => {
  const src = read(COMPONENTS, "ReadinessChip.tsx");
  assert.match(src, /accessibilityLabel/);
});

test("FloatingMapControl requires + sets an accessibilityLabel", () => {
  const src = read(COMPONENTS, "FloatingMapControl.tsx");
  assert.match(src, /accessibilityLabel:\s*string/, "prop is required");
  assert.match(src, /accessibilityRole="button"/);
});

test("MovementControlBar labels Pause/Resume and a separated Finish", () => {
  const src = read(COMPONENTS, "MovementControlBar.tsx");
  assert.match(src, /accessibilityLabel=\{paused \? "Resume session" : "Pause session"\}/);
  assert.match(src, /accessibilityLabel="Finish session"/);
});

test("ZoneSheet grabber and close are labelled for assistive tech", () => {
  const src = read(COMPONENTS, "ZoneSheet.tsx");
  assert.match(src, /Expand zone details|Collapse zone details/);
  assert.match(src, /accessibilityLabel="Close zone details"/);
});

// ---- Active Move lifecycle + back protection -------------------------------

test("Active Move preserves the session lifecycle wiring", () => {
  const src = read(APP, "move", "session.tsx");
  // Persistence + finish gate must remain.
  assert.match(src, /setLastSession\(/, "finish still persists the session");
  /* The finish gate used to be a `finishedRef` boolean in this file, and this
     guard named that ref. The gate now lives in the pure lifecycle machine,
     where "Finish happens once" is a tested property rather than a component
     detail — so the guard follows the invariant instead of the idiom it used
     to wear: finish must go through a transition and must bail when the
     machine refuses it. */
  assert.match(src, /finishLifecycle\(lifecycleRef\.current, at\)/, "finish goes through the lifecycle machine");
  assert.match(src, /if \(next\.outcome !== "ok"\) return;/, "a refused finish transition stops the handler");
  /* The tracker is still subscribed here, but its evidence source is now
     pinned in a ref rather than read from the render scope. That is what
     keeps the start effect a mount effect: a dependency on the changing
     value would stop the tracker in cleanup and then be turned away by the
     single-flight guard, leaving a live-looking session capturing nothing.
     The guard follows the subscription rather than the old spelling. */
  assert.match(
    src,
    /createTracker\(evidenceSourceRef\.current\)/,
    "the tracker subscription is intact",
  );
  assert.match(src, /acceptPoint\(prev, p\)/, "point acceptance/validation is unchanged");
});

test("Active Move intercepts Android hardware back (no silent discard)", () => {
  const src = read(APP, "move", "session.tsx");
  assert.match(src, /BackHandler\.addEventListener\(\s*"hardwareBackPress"/);
  // The handler routes through quit() and prevents the default pop.
  assert.match(src, /quit\(\);\s*\n\s*return true;/);
});

test("Finish is confirmed before ending (not accidental)", () => {
  const src = read(APP, "move", "session.tsx");
  assert.match(src, /Finish session\?/);
  assert.match(src, /onFinish=\{confirmFinish\}/);
});

// ---- native-driver safety across movement/territory screens ----------------

const MOVEMENT_FILES = [
  join(APP, "move", "session.tsx"),
  join(APP, "move", "summary.tsx"),
  join(APP, "move", "index.tsx"),
  join(APP, "territory", "map.tsx"),
];

test("no movement/territory screen enables the JS animation driver", () => {
  for (const f of MOVEMENT_FILES) {
    const src = read(f);
    assert.ok(
      !/useNativeDriver:\s*false/.test(src),
      `${f} must not use the JS animation driver (native-driver regression fix)`,
    );
  }
});
