/**
 * Track C: discipline tests for research/play-assurance/tools/android-artifact-acceptance.sh
 * Offline. Runs the script with no artifact, a missing path, and --self-test (synthetic zip, not a real APK).
 * Run from movenrun/:  node --import tsx --test research/play-assurance/tests/androidAcceptanceScript.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../tools/android-artifact-acceptance.sh", import.meta.url));
const run = (args: string[]) => spawnSync("bash", [script, ...args], { encoding: "utf8", timeout: 60_000 });

test("no argument: exit 2 and NOT RUN / ARTIFACT MISSING", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /NOT RUN \/ ARTIFACT MISSING/);
  assert.doesNotMatch(r.stdout, /OVERALL: PASS/);
});

test("nonexistent path: exit 2 and NOT RUN / ARTIFACT MISSING", () => {
  const r = run(["/nonexistent/path/movenrun-does-not-exist.apk"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /NOT RUN \/ ARTIFACT MISSING/);
});

test("--self-test: synthetic zip never passes (non-zero exit, no OVERALL: PASS) and discipline is verified", () => {
  const r = run(["--self-test"]);
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 4, `discipline broken:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /OVERALL: PASS/);
  assert.match(r.stdout, /NOT RUN \/ TOOL MISSING: zipalign/);
  assert.match(r.stdout, /\[FAIL\] Hermes bytecode/);
  assert.match(r.stdout, /SELF-TEST DISCIPLINE: verified/);
});
