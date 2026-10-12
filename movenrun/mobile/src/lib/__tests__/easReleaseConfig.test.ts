/**
 * EAS release configuration guards.
 *
 * Google Play rejects an upload whose versionCode it has already seen, and a
 * preview APK is not a Play artifact. These checks keep the production profile
 * an auto-incremented, remotely versioned app bundle built against its own
 * environment, and keep the preview profile an installable APK.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const eas = JSON.parse(readFileSync(join(ROOT, "eas.json"), "utf8"));
const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")).expo;

test("version codes come from EAS and increase on every production build", () => {
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.build.production.autoIncrement, true);
  // With a remote version source a versionCode in app.json would be ignored
  // and only mislead a reader.
  assert.equal(app.android.versionCode, undefined);
});

test("production builds a Play app bundle from the production environment", () => {
  assert.equal(eas.build.production.android.buildType, "app-bundle");
  assert.equal(eas.build.production.environment, "production");
  assert.equal(eas.build.production.distribution, undefined, "store distribution is the default");
});

test("preview stays an internally distributed APK on its own environment", () => {
  assert.equal(eas.build.preview.android.buildType, "apk");
  assert.equal(eas.build.preview.environment, "preview");
  assert.equal(eas.build.preview.distribution, "internal");
});

test("the Android package identity is fixed for Google Play", () => {
  assert.equal(app.android.package, "io.movenrun.app");
  assert.match(app.version, /^\d+\.\d+\.\d+$/);
});

test("no signing material or store credentials are committed in eas.json", () => {
  const raw = JSON.stringify(eas);
  assert.ok(!/keystore|serviceAccountKey|password|private_key/i.test(raw));
});

test("the release manifest declares only foreground location and strips template extras", () => {
  assert.deepEqual(app.android.permissions, [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
  ]);
  // Added to the merged manifest by the Expo template or by libraries, and not
  // used by Play v1. `blockedPermissions` writes tools:node="remove", so they
  // stay out of the final bundle even when a dependency declares them.
  for (const permission of [
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
  ]) {
    assert.ok(app.android.blockedPermissions.includes(permission), `${permission} is blocked`);
  }
});
