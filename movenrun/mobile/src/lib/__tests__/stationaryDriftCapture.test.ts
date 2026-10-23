/**
 * MR-C stationary drift in the capture loop (SYNTHETIC).
 *
 * The guard lives in the shared domain (`createStationaryDriftGuard`); this
 * pins that the session screen actually applies it between `inspectFix` and
 * the point becoming evidence, and that a withheld fix takes the rejected
 * path (no distance, no route point, no marker move).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createStationaryDriftGuard } from "@movenrun/shared/evidence";

const screen = readFileSync(join(__dirname, "..", "..", "..", "app", "move", "session.tsx"), "utf8");

test("the session screen withholds drift between inspectFix and evidence", () => {
  const inspect = screen.indexOf("inspectFix(prev, p, now)");
  const observe = screen.indexOf("driftRef.current?.observe(p);");
  const withhold = screen.indexOf("driftRef.current?.withholds(prev, p)");
  const rejected = screen.indexOf("if (!decision.accepted) {");
  const pushed = screen.indexOf("pushPoint(pointsRef.current, p);");
  assert.ok(inspect > 0 && observe > inspect && withhold > observe, "observe then withhold, after inspectFix");
  assert.ok(withhold < rejected && rejected < pushed, "a withheld fix reaches the rejected branch before any push");
  assert.match(screen, /\{ accepted: false, reason: "within_uncertainty", segmentMeters: inspected\.segmentMeters \}/);
  assert.match(screen, /driftRef\.current = createStationaryDriftGuard\(\);/);
});

test("the guard only withholds: with no history it never rejects a fix inspectFix accepted", () => {
  const guard = createStationaryDriftGuard();
  const a = { latitude: -30, longitude: -140, timestamp: 1_000, accuracy: 8 };
  const b = { latitude: -30 + 30 / 111_320, longitude: -140, timestamp: 5_000, accuracy: 8 };
  guard.observe(a); guard.observe(b);
  assert.equal(guard.withholds(a, b), false);
  assert.equal(guard.withholds(null, b), false, "a fresh stretch is never withheld");
});
