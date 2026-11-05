/**
 * 16 KB memory page guards: offline, structural, no device.
 *
 * Google Play requires apps targeting Android 15+ that ship native code to
 * support 16 KB page sizes: every 64-bit `.so` needs ELF LOAD segments aligned
 * to 16 KB, and uncompressed libraries need 16 KB zip alignment. This file
 * pins the inputs that make the build compliant; the built bundle is checked
 * with `zipalign -c -P 16` and `llvm-readelf -l` as written in
 * `docs/play-launch/ANDROID_16KB_PAGE_SIZE.md`.
 *
 *   Prebuilt from Maven: react-android and hermes-android (built by React
 *   Native with ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON), fbjni 0.7.0 and the
 *   Fresco 3.6.0 natives (their 64-bit libraries were read with llvm-readelf:
 *   LOAD align 0x4000).
 *   Compiled during the build: expo-modules-core and react-native-screens,
 *   each passing the same CMake flag, with NDK r27.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MOBILE = process.cwd();
const req = createRequire(join(MOBILE, "package.json"));
const FLAG = "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON";

function pkgDir(name: string): string {
  return dirname(req.resolve(`${name}/package.json`));
}

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

const RN = pkgDir("react-native");
const catalog = read(RN, "gradle", "libs.versions.toml");

function catalogValue(key: string): string {
  const m = catalog.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  assert.ok(m, `${key} missing from the React Native version catalog`);
  return m[1];
}

/** -1, 0 or 1, comparing dotted numeric versions. */
function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const app = JSON.parse(read(MOBILE, "app.json")).expo;

test("Hermes stays the JavaScript engine", () => {
  for (const value of [app.jsEngine, app.android?.jsEngine]) {
    assert.ok(value === undefined || value === "hermes", `jsEngine is ${value}; Hermes is required (#94, Q0-1)`);
  }
});

test("the NDK used for native code supports flexible page sizes (r27 or later)", () => {
  const ndk = catalogValue("ndkVersion");
  assert.ok(Number(ndk.split(".")[0]) >= 27, `ndkVersion ${ndk}`);
});

test("React Native passes the 16 KB flag to its own libraries, Hermes and app CMake builds", () => {
  assert.ok(read(RN, "ReactAndroid", "build.gradle.kts").includes(FLAG), "react-android");
  assert.ok(read(RN, "ReactAndroid", "hermes-engine", "build.gradle.kts").includes(FLAG), "hermes-android");
  const plugin = join(
    pkgDir("@react-native/gradle-plugin"),
    "react-native-gradle-plugin/src/main/kotlin/com/facebook/react/utils/NdkConfiguratorUtils.kt",
  );
  assert.ok(readFileSync(plugin, "utf8").includes("ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"), "app CMake");
});

test("every dependency compiled from C++ in the build passes the 16 KB flag", () => {
  const compiled: string[] = [];
  const pkg = JSON.parse(read(MOBILE, "package.json"));
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), "expo-modules-core"]);
  for (const name of names) {
    let dir: string;
    try {
      dir = pkgDir(name);
    } catch {
      continue;
    }
    if (!existsSync(join(dir, "android", "CMakeLists.txt"))) continue;
    compiled.push(name);
    assert.ok(read(dir, "android", "build.gradle").includes(FLAG), `${name} builds native code without ${FLAG}`);
  }
  assert.deepEqual(compiled.sort(), ["expo-modules-core", "react-native-screens"]);
});

test("prebuilt native libraries are at versions whose 64-bit .so files are 16 KB aligned", () => {
  // Read with llvm-readelf from the Maven Central AARs (arm64-v8a, x86_64):
  // fbjni 0.7.0 libfbjni.so, libc++_shared.so; Fresco 3.6.0 libimagepipeline,
  // libnative-filters, libnative-imagetranscoder, libgifimage, libstatic-webp.
  assert.ok(compare(catalogValue("fbjni"), "0.7.0") >= 0, "fbjni");
  assert.ok(compare(catalogValue("fresco"), "3.6.0") >= 0, "fresco");
});

test("uncompressed libraries get 16 KB zip alignment (AGP 8.5.1+, no legacy packaging)", () => {
  assert.ok(compare(catalogValue("agp"), "8.5.1") >= 0, `AGP ${catalogValue("agp")}`);
  const props = (app.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as
    | [string, Record<string, any>]
    | undefined;
  assert.notEqual(props?.[1]?.android?.useLegacyPackaging, true, "useLegacyPackaging compresses .so files");
});
