/**
 * The app's own AndroidManifest.xml as `expo prebuild` writes it: offline,
 * no Android SDK, no device.
 *
 * The other Android tests check each config plugin on a fixture. This one runs
 * the whole plugin chain from `app.json` and `app.config.js` the way
 * `npx expo config --type introspect` does, and pins what comes out: backup,
 * transfer and cleartext settings, the permission set, every component other
 * apps can reach, and every intent filter.
 *
 * It does not see library manifests or Google Play services AARs; those join
 * in Gradle's manifest merge. `androidManifestHardening.test.ts` scans the
 * library manifests that ship in node_modules, and the merged manifest of the
 * built APK is read with `aapt2` (`X04_PREVIEW_BUILD_RUNBOOK.md`) and on the
 * phone (Q0-7 in `ANDROID_DEVICE_GATE_PLAN.md`).
 *
 * The `movenrun://` scheme is pinned as it is. It is the sign-in return path
 * and the F-06 interception surface (`AUTH_SECURITY_REVIEW.md`): any app on
 * the phone may declare the same scheme. Moving the return to a verified
 * HTTPS App Link is X-23, an owner decision; that change has to update this
 * test on purpose.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const MOBILE = process.cwd();
const require = createRequire(join(MOBILE, "package.json"));
const MAPS_ENV = "GOOGLE_MAPS_ANDROID_API_KEY";

type Node = { $?: Record<string, string>; [child: string]: any };

async function prebuildManifest(): Promise<Node> {
  const { getPrebuildConfigAsync } = require("@expo/prebuild-config");
  const { compileModsAsync } = require("@expo/config-plugins/build/plugins/mod-compiler.js");
  // A key in the environment only adds the Maps meta-data; keep it out so the
  // result does not depend on the shell and no key value is ever read here.
  const prior = process.env[MAPS_ENV];
  delete process.env[MAPS_ENV];
  try {
    const { exp } = await getPrebuildConfigAsync(MOBILE, { platforms: ["android"] });
    const out = await compileModsAsync(exp, {
      projectRoot: MOBILE,
      introspect: true,
      platforms: ["android"],
      assertMissingModProviders: false,
    });
    return out._internal.modResults.android.manifest.manifest as Node;
  } finally {
    if (prior !== undefined) process.env[MAPS_ENV] = prior;
  }
}

const manifestPromise = prebuildManifest();

function application(manifest: Node): Node {
  const apps = manifest.application as Node[];
  assert.equal(apps.length, 1);
  return apps[0];
}

const names = (nodes: Node[] | undefined) => (nodes ?? []).map((n) => n.$?.["android:name"] ?? "");

test("backup, device transfer and cleartext are off on the application", async () => {
  const app = application(await manifestPromise).$!;
  assert.equal(app["android:allowBackup"], "false");
  assert.equal(app["android:dataExtractionRules"], "@xml/data_extraction_rules");
  assert.equal(app["android:usesCleartextTraffic"], "false");
  assert.equal(app["android:fullBackupContent"], undefined, "allowBackup=false makes Android 11 and lower rules moot");
  assert.equal(app["android:networkSecurityConfig"], undefined);
  assert.equal(app["android:debuggable"], undefined);
});

test("the only permissions kept are location (fine and coarse), internet and vibration", async () => {
  const perms = (await manifestPromise)["uses-permission"] as Node[];
  const kept = perms.filter((p) => p.$?.["tools:node"] !== "remove").map((p) => p.$!["android:name"]).sort();
  assert.deepEqual(kept, [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.INTERNET",
    "android.permission.VIBRATE",
  ]);
  const removed = perms.filter((p) => p.$?.["tools:node"] === "remove").map((p) => p.$!["android:name"]);
  for (const name of [
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
  ]) {
    assert.ok(removed.includes(name), `${name} is removed from the merged manifest`);
  }
  assert.equal((await manifestPromise)["uses-permission-sdk-23"], undefined);
});

test("MainActivity is the only component the app itself exports", async () => {
  const app = application(await manifestPromise);
  const exported: string[] = [];
  for (const kind of ["activity", "activity-alias", "service", "receiver", "provider"]) {
    for (const node of (app[kind] ?? []) as Node[]) {
      if (node.$?.["tools:node"] === "remove") continue;
      if (node.$?.["android:exported"] === "true" || (node["intent-filter"] ?? []).length > 0) {
        exported.push(`${kind}:${node.$?.["android:name"]}`);
      }
    }
  }
  assert.deepEqual(exported, ["activity:.MainActivity"]);
  assert.deepEqual(names(app.service), ["expo.modules.location.services.LocationTaskService"]);
  assert.equal(app.service[0].$["tools:node"], "remove");
  assert.deepEqual(names(app.receiver), []);
  assert.deepEqual(names(app.provider), []);
});

test("intent filters: the launcher and the movenrun:// sign-in return, nothing else", async () => {
  const activity = (application(await manifestPromise).activity as Node[])[0];
  const filters = (activity["intent-filter"] as Node[]).map((f) => ({
    actions: names(f.action),
    categories: names(f.category).sort(),
    data: (f.data ?? []).map((d: Node) => d.$),
    autoVerify: f.$?.["android:autoVerify"],
  }));
  assert.deepEqual(filters, [
    { actions: ["android.intent.action.MAIN"], categories: ["android.intent.category.LAUNCHER"], data: [], autoVerify: undefined },
    {
      actions: ["android.intent.action.VIEW"],
      categories: ["android.intent.category.BROWSABLE", "android.intent.category.DEFAULT"],
      // Scheme only: no host, no http(s), no App Link. See F-06 above.
      data: [{ "android:scheme": "movenrun" }],
      autoVerify: undefined,
    },
  ]);
  assert.equal(activity.$?.["android:launchMode"], "singleTask");
});

test("package visibility asks only for browsers (https VIEW)", async () => {
  const queries = (await manifestPromise).queries as Node[];
  assert.equal(queries.length, 1);
  const intents = queries[0].intent as Node[];
  assert.deepEqual(
    intents.map((i) => ({ action: names(i.action), category: names(i.category), data: (i.data ?? []).map((d: Node) => d.$) })),
    [{ action: ["android.intent.action.VIEW"], category: ["android.intent.category.BROWSABLE"], data: [{ "android:scheme": "https" }] }],
  );
  assert.equal(queries[0].package, undefined);
});
