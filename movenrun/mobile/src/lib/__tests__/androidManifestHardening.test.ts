/**
 * Android manifest hardening: offline, structural, no device.
 *
 * Checks `plugins/withAndroidHardening.js` (cleartext off, expo-location's
 * background task service removed) and scans the Android manifest of every
 * package the app depends on, directly or not, for components other apps can
 * reach and for cleartext switches. A dependency that brings one in fails
 * here, before it reaches a build. The merged manifest of a real build is
 * checked separately (`aapt2 dump xmltree`, see the device gate plan).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MOBILE = process.cwd();
const require = createRequire(join(MOBILE, "package.json"));
const plugin = require("./plugins/withAndroidHardening.js") as {
  setCleartextOff: (manifest: any) => any;
  removeLocationTaskService: (manifest: any) => any;
  LOCATION_TASK_SERVICE: string;
};

function appConfig(): Record<string, any> {
  return JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")).expo;
}

function bareManifest(): any {
  return { manifest: { $: { "xmlns:android": "http://schemas.android.com/apk/res/android" }, application: [{ $: { "android:name": ".MainApplication" } }] } };
}

test("app.json applies the hardening plugin", () => {
  assert.ok((appConfig().plugins as unknown[]).includes("./plugins/withAndroidHardening"));
});

test("the application refuses cleartext traffic explicitly", () => {
  const out = plugin.setCleartextOff(bareManifest());
  assert.equal(out.manifest.application[0].$["android:usesCleartextTraffic"], "false");
});

test("expo-location's background task service is removed from the merged manifest", () => {
  const out = plugin.removeLocationTaskService(bareManifest());
  assert.equal(out.manifest.$["xmlns:tools"], "http://schemas.android.com/tools");
  const services = out.manifest.application[0].service as any[];
  const entries = services.filter((s) => s.$["android:name"] === plugin.LOCATION_TASK_SERVICE);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].$["tools:node"], "remove");
  // Applying it twice leaves one entry, not two.
  const again = plugin.removeLocationTaskService(out);
  assert.equal((again.manifest.application[0].service as any[]).length, 1);
});

test("expo-location is still used only through the foreground watch", () => {
  // The removed service backs startLocationUpdatesAsync with a foreground
  // service. If the app ever starts using it, this plugin must be revisited.
  const pkg = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8"));
  assert.equal(pkg.dependencies?.["expo-task-manager"], undefined, "expo-task-manager would enable background location tasks");
  const tracker = readFileSync(join(MOBILE, "src/services/moveTracker.ts"), "utf8");
  assert.doesNotMatch(tracker, /startLocationUpdatesAsync/);
});

/** package.json of every package reachable from the mobile app's dependencies. */
function dependencyClosure(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue: Array<[string, string]> = [];
  const root = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8"));
  for (const name of Object.keys(root.dependencies ?? {})) queue.push([name, MOBILE]);
  while (queue.length) {
    const [name, from] = queue.shift()!;
    if (seen.has(name)) continue;
    let pkgPath: string;
    try {
      pkgPath = createRequire(join(from, "package.json")).resolve(`${name}/package.json`);
    } catch {
      continue; // optional or platform-specific dependency not installed
    }
    seen.set(name, pkgPath);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push([dep, dirname(pkgPath)]);
  }
  return seen;
}

test("no dependency adds an exported component or allows cleartext", () => {
  const closure = dependencyClosure();
  assert.ok(closure.has("expo-location") && closure.has("react-native"), "dependency scan resolved the app's packages");
  const problems: string[] = [];
  let scanned = 0;
  for (const [name, pkgPath] of closure) {
    const manifest = join(dirname(pkgPath), "android", "src", "main", "AndroidManifest.xml");
    if (!existsSync(manifest)) continue;
    scanned += 1;
    const xml = readFileSync(manifest, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    if (/android:exported\s*=\s*"true"/.test(xml)) problems.push(`${name}: exported component`);
    if (/android:usesCleartextTraffic\s*=\s*"true"/.test(xml)) problems.push(`${name}: usesCleartextTraffic=true`);
    if (/android:networkSecurityConfig/.test(xml)) problems.push(`${name}: networkSecurityConfig`);
  }
  assert.ok(scanned >= 5, `scanned ${scanned} Android manifests`);
  assert.deepEqual(problems, []);
});

test("expo-clipboard stays out: it exports a content provider and the app has no clipboard feature", () => {
  const pkg = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8"));
  assert.equal(pkg.dependencies?.["expo-clipboard"], undefined);
});
