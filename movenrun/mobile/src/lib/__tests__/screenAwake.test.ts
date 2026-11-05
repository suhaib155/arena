/**
 * expo-location stops a foreground watch when the activity pauses, so a screen
 * timeout used to end GPS mid-run. The session screen keeps the screen on while
 * a capture is live or paused, and the readiness screen says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCREEN_ON_FACT, SESSION_KEEP_AWAKE_TAG, shouldKeepScreenOn } from "../screenAwake";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("the screen is kept on only while a capture is live or paused", () => {
  assert.equal(shouldKeepScreenOn("active"), true);
  assert.equal(shouldKeepScreenOn("paused"), true);
  for (const s of ["idle", "starting", "finished"] as const) assert.equal(shouldKeepScreenOn(s), false);
});

test("the player is told the screen stays on and that a lock pauses GPS", () => {
  assert.match(SCREEN_ON_FACT, /Screen stays on/);
  assert.match(SCREEN_ON_FACT, /lock/i);
  assert.match(src("app/move/index.tsx"), /<Fact icon="sunny-outline" text=\{SCREEN_ON_FACT\} \/>/);
});

test("the session screen holds a tagged keep-awake and releases it", () => {
  const s = src("app/move/session.tsx");
  assert.match(s, /const keepScreenOn = shouldKeepScreenOn\(captureState\);/);
  assert.match(s, /activateKeepAwakeAsync\(SESSION_KEEP_AWAKE_TAG\)/);
  assert.match(s, /return \(\) => \{ void deactivateKeepAwake\(SESSION_KEEP_AWAKE_TAG\)/);
  assert.match(s, /\}, \[keepScreenOn\]\);/);
  assert.ok(SESSION_KEEP_AWAKE_TAG.length > 0);
});

test("keeping the screen on adds no Android permission", () => {
  const app = JSON.parse(src("app.json"));
  const perms: string[] = app.expo?.android?.permissions ?? [];
  assert.ok(!perms.some((p) => /WAKE_LOCK/.test(p)), "FLAG_KEEP_SCREEN_ON needs no permission");
});
