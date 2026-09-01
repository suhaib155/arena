/**
 * Android target-API guards — offline, structural, no device required.
 *
 * Google Play requires new apps and app updates to target Android 16
 * (API 36) or higher from 2026-08-31
 * (https://developer.android.com/google/play/requirements/target-sdk).
 *
 * This project is managed/CNG: there is no committed `android/` directory, so
 * `targetSdkVersion` is never written down in the repo. It is resolved at
 * build time by Expo's `expo-root-project` Gradle plugin, which reads the
 * React Native version catalog and falls back to its own defaults:
 *
 *   android/settings.gradle          → expoAutolinking.useExpoVersionCatalog()
 *   expo-modules-autolinking         → ExpoRootProjectPlugin.kt
 *     compileSdk = catalog "compileSdk" (fallback "35")
 *     targetSdk  = catalog "targetSdk"  (fallback "35")
 *   react-native/gradle/libs.versions.toml → the catalog itself
 *
 * So the effective API level is a property of the *installed React Native
 * version*, and it regresses silently if react-native is downgraded or if a
 * build-properties override pins something lower. These guards read the same
 * inputs Gradle does and fail when the effective level drops below what Play
 * requires — which is exactly the regression a changed JSON field would hide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Play's floor for new apps and updates as of 2026-08-31. */
const REQUIRED_API_LEVEL = 36;

const MOBILE = process.cwd();

/** react-native is hoisted to the workspace root, but tolerate a local install. */
function reactNativeCatalogPath(): string {
  const candidates = [
    join(MOBILE, "node_modules", "react-native", "gradle", "libs.versions.toml"),
    join(MOBILE, "..", "node_modules", "react-native", "gradle", "libs.versions.toml"),
  ];
  const found = candidates.find((p) => existsSync(p));
  assert.ok(
    found,
    `React Native version catalog not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Run `yarn install` from movenrun/ before running the mobile tests.",
  );
  return found as string;
}

/** Read a bare `key = "value"` entry out of the version catalog. */
function catalogValue(key: string): string {
  const path = reactNativeCatalogPath();
  const toml = readFileSync(path, "utf8");
  const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  assert.ok(match, `"${key}" is missing from ${path}`);
  return (match as RegExpMatchArray)[1];
}

function appConfig(): Record<string, any> {
  const raw = readFileSync(join(MOBILE, "app.json"), "utf8");
  return JSON.parse(raw).expo as Record<string, any>;
}

test("effective Android targetSdk meets the Play requirement", () => {
  const targetSdk = Number(catalogValue("targetSdk"));
  assert.ok(
    targetSdk >= REQUIRED_API_LEVEL,
    `Effective targetSdk is ${targetSdk}; Google Play requires >= ${REQUIRED_API_LEVEL} ` +
      "for new apps and updates from 2026-08-31. This is resolved from the installed " +
      "react-native version catalog — a react-native/Expo SDK downgrade is the usual cause.",
  );
});

test("effective Android compileSdk meets the Play requirement", () => {
  const compileSdk = Number(catalogValue("compileSdk"));
  assert.ok(
    compileSdk >= REQUIRED_API_LEVEL,
    `Effective compileSdk is ${compileSdk}; must be >= ${REQUIRED_API_LEVEL} to compile ` +
      "against the Android 16 SDK.",
  );
});

test("no config plugin pins the Android SDK levels below the requirement", () => {
  // expo-build-properties is the supported way to override the resolved SDK
  // levels. It is not used today; if it is ever added, it must not lower them.
  const plugins = (appConfig().plugins ?? []) as unknown[];
  for (const entry of plugins) {
    if (!Array.isArray(entry) || entry[0] !== "expo-build-properties") continue;
    const android = ((entry[1] ?? {}) as Record<string, any>).android ?? {};
    for (const key of ["targetSdkVersion", "compileSdkVersion"]) {
      if (android[key] === undefined) continue;
      assert.ok(
        Number(android[key]) >= REQUIRED_API_LEVEL,
        `expo-build-properties pins android.${key} to ${android[key]}, below the ` +
          `required API ${REQUIRED_API_LEVEL}.`,
      );
    }
  }
});

// The product invariants that this upgrade must not widen — foreground-only
// tracking, the declared runtime architecture, and the light canvas — live in
// `androidRuntimePolicy.test.ts`. They answer a different question from the
// Play API-level floor asserted above and are resolved from different inputs,
// so keeping them here made a failure message ambiguous about which contract
// had actually broken.
