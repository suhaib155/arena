/**
 * Two release-manifest settings for Android, both native config only.
 *
 * 1. `android:usesCleartextTraffic="false"` on the application. Android 9+
 *    already refuses plain HTTP when the attribute is absent, but an absent
 *    attribute can be filled in by a library manifest during the merge. Set
 *    explicitly, a library that asks for cleartext makes the merge fail
 *    instead of quietly allowing HTTP. The debug manifest from the React
 *    Native template overrides it with `tools:replace` so Metro still works in
 *    development; release builds never see that file.
 *
 * 2. Remove expo-location's `LocationTaskService`. It only runs background
 *    location tasks (expo-task-manager, which the app does not install), it
 *    declares `foregroundServiceType="location"`, and the permissions it would
 *    need are already blocked in `app.json`. Removing the declaration keeps
 *    the merged manifest honest about "foreground only, no foreground
 *    service". The app tracks with `watchPositionAsync`, which does not use it.
 *
 * `src/lib/__tests__/androidManifestHardening.test.ts` checks both.
 */
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const LOCATION_TASK_SERVICE = "expo.modules.location.services.LocationTaskService";

function setCleartextOff(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.$["android:usesCleartextTraffic"] = "false";
  return manifest;
}

function removeLocationTaskService(manifest) {
  manifest = AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const services = (app.service ?? []).filter((s) => s.$?.["android:name"] !== LOCATION_TASK_SERVICE);
  services.push({ $: { "android:name": LOCATION_TASK_SERVICE, "tools:node": "remove" } });
  app.service = services;
  return manifest;
}

function withAndroidHardening(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = removeLocationTaskService(setCleartextOff(mod.modResults));
    return mod;
  });
}

module.exports = withAndroidHardening;
module.exports.setCleartextOff = setCleartextOff;
module.exports.removeLocationTaskService = removeLocationTaskService;
module.exports.LOCATION_TASK_SERVICE = LOCATION_TASK_SERVICE;
