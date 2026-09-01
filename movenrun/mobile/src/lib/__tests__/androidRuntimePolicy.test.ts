/**
 * Android runtime-policy guards — offline, structural, no device required.
 *
 * These are the product invariants that the API 36 upgrade must not quietly
 * widen. They are deliberately separate from `androidTargetSdk.test.ts`: that
 * file answers "does the build satisfy Google Play's API level floor?", which
 * is a compliance question resolved from the React Native version catalog.
 * This file answers "does the build still behave the way the product promises?",
 * which is resolved from the app config. Mixing the two made a single failure
 * message ambiguous and let one concern's assertions hide behind the other's.
 *
 * Everything here is *statically proven* from `app.json` plus the documented
 * behaviour of the config plugins it enables. None of it is device-proven; see
 * mobile/README.md for the items that still need an Android 16 handset.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The established light canvas (Morning White) — see the design system. */
const MORNING_WHITE = "#F8FAF7";

const MOBILE = process.cwd();

function appConfig(): Record<string, any> {
  const raw = readFileSync(join(MOBILE, "app.json"), "utf8");
  return JSON.parse(raw).expo as Record<string, any>;
}

/** Options a config plugin was given in `app.json`, or `{}` when it is listed bare. */
function pluginOptions(name: string): Record<string, any> {
  const plugins = (appConfig().plugins ?? []) as unknown[];
  for (const entry of plugins) {
    if (Array.isArray(entry) && entry[0] === name) {
      return (entry[1] ?? {}) as Record<string, any>;
    }
    if (entry === name) return {};
  }
  return {};
}

/**
 * The Android permissions this config actually resolves to — the set that ends
 * up in the *generated* manifest, not merely the ones spelled out under
 * `android.permissions`.
 *
 * Reading `android.permissions` alone is not enough, and that gap is the
 * reason this helper exists. `expo-location`'s config plugin contributes
 * sensitive permissions from its own options, never from `android.permissions`
 * (node_modules/expo-location/plugin/build/withLocation.js):
 *
 *   isAndroidBackgroundLocationEnabled → ACCESS_BACKGROUND_LOCATION
 *   isAndroidForegroundServiceEnabled  → FOREGROUND_SERVICE,
 *                                        FOREGROUND_SERVICE_LOCATION
 *
 * and `isAndroidForegroundServiceEnabled` *defaults to*
 * `isAndroidBackgroundLocationEnabled` when it is left undefined, so a single
 * flag pulls in all three. A guard that only inspected `android.permissions`
 * stayed green while `expo prebuild` emitted every one of them.
 */
function resolvedAndroidPermissions(): string[] {
  const android = (appConfig().android ?? {}) as Record<string, any>;
  const declared: string[] = android.permissions ?? [];

  const location = pluginOptions("expo-location");
  const backgroundLocation = location.isAndroidBackgroundLocationEnabled === true;
  const foregroundService =
    location.isAndroidForegroundServiceEnabled === undefined
      ? backgroundLocation
      : location.isAndroidForegroundServiceEnabled === true;

  return [
    ...declared,
    ...(backgroundLocation ? ["android.permission.ACCESS_BACKGROUND_LOCATION"] : []),
    ...(foregroundService
      ? ["android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_LOCATION"]
      : []),
  ];
}

test("tracking stays foreground-only in the permissions the build actually resolves", () => {
  // Android 16 readiness must not become an excuse to widen the app's
  // foreground-only tracking policy (docs/ROADMAP.md, mobile/README.md).
  const resolved = resolvedAndroidPermissions();
  const forbidden = [
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
  ];
  for (const permission of forbidden) {
    assert.ok(
      !resolved.includes(permission),
      `${permission} resolves into the generated manifest — tracking is foreground-only ` +
        "and session-scoped. Check both android.permissions and the expo-location plugin " +
        "options (isAndroidBackgroundLocationEnabled / isAndroidForegroundServiceEnabled).",
    );
  }
});

test("the React Native architecture is an explicit, declared decision", () => {
  // The architecture is a runtime behaviour switch, and its *default* moved
  // under this app: SDK 51 resolved to the legacy architecture, SDK 53 changed
  // the default to the New Architecture (expo CHANGELOG, v53.0.5). Upgrading to
  // SDK 54 therefore flipped it without a line of the diff saying so.
  //
  // API 36 does not depend on it. Prebuilding SDK 54 with the New Architecture
  // enabled and disabled produces byte-identical `AndroidManifest.xml`,
  // `styles.xml`, `colors.xml` and `app/build.gradle`, and an identical
  // compileSdk/targetSdk/minSdk of 36/36/24; the only difference is the single
  // `newArchEnabled` line in `gradle.properties`.
  //
  // So it must be written down and reviewed on its own merits rather than
  // inherited from whichever SDK happens to be installed. Either value is
  // allowed by this guard — silence is not.
  const config = appConfig();
  assert.ok(
    typeof config.newArchEnabled === "boolean",
    "app.json must declare `newArchEnabled` explicitly. Leaving it unset means the " +
      "runtime architecture is whatever the installed Expo SDK defaults to, which is " +
      "how it changed during the SDK 51 → 54 upgrade with nothing in the diff to review.",
  );
});

test("the light canvas survives the Android 16 theme change", () => {
  // Targeting API 36 switches the generated Android theme from
  // Theme.AppCompat.Light to Theme.AppCompat.DayNight, so the light lock has
  // to be declared *and* backed by expo-system-ui, which applies it at launch
  // (AppCompatDelegate.setDefaultNightMode). Without the module the app would
  // follow the system into dark mode on native surfaces.
  const config = appConfig();
  assert.equal(config.userInterfaceStyle, "light");
  assert.equal(config.backgroundColor, MORNING_WHITE);
  assert.equal(config.splash?.backgroundColor, MORNING_WHITE);
  assert.equal(config.android?.adaptiveIcon?.backgroundColor, MORNING_WHITE);

  const pkg = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8"));
  assert.ok(
    pkg.dependencies?.["expo-system-ui"],
    "expo-system-ui must stay installed: it is what makes userInterfaceStyle: light " +
      "effective under the DayNight theme that API 36 builds generate.",
  );
});
