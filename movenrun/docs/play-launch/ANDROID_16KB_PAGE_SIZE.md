# 16 KB memory page readiness (Play v1)

**State (17 Oct 2026):** every native library the build will ship is expected
to be 16 KB-aligned from its version and build flags. Nothing is proven on a
built APK or AAB yet: no build has run (X-04, X-09). The checks below close
R-04 once a build exists.

## The requirement

Google's page ([Support 16 KB page sizes](https://developer.android.com/guide/practices/page-sizes),
read 17 Oct 2026): "all apps targeting Android 15 (API level 35) and higher
must support 16 KB memory page sizes on 64-bit devices on Google Play.
Starting February 1, 2027, if your app updates don't support 16 KB memory page
sizes, you won't be able to release these updates." MovenRun targets API 36
and ships native code, so it applies from the first upload.

Two things must hold for each 64-bit library (`arm64-v8a`, `x86_64`):

1. ELF LOAD segments aligned to 16 KB (`align 2**14`, `0x4000`) or more.
2. Uncompressed libraries 16 KB zip-aligned in the APK. The page: "Upgrade to
   AGP version 8.5.1 or higher and use uncompressed shared libraries."

32-bit libraries (`armeabi-v7a`, `x86`) are not part of the requirement; they
stay 4 KB-aligned and that is expected.

## Inventory

Build inputs: Expo SDK 54.0.36, React Native 0.81.5 (old architecture,
`newArchEnabled: false`), Hermes, NDK 27.1.12297006 and AGP 8.11.0 from React
Native's version catalog (`react-native/gradle/libs.versions.toml`),
`expo.useLegacyPackaging=false` (uncompressed libraries). "Read" means the
64-bit `.so` files were extracted from the published Maven Central AAR and
`llvm-readelf -lW` showed every LOAD segment at `0x4000`.

| Library (`.so`) | Comes from | Version | 16 KB? | Evidence |
|---|---|---|---|---|
| `libreactnative.so`, `libjsi.so` and the other React Native core libraries | `com.facebook.react:react-android` prebuilt AAR | 0.81.5 | Expected yes | Built with `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` (`ReactAndroid/build.gradle.kts` line 526) and NDK r27. React Native announced 16 KB page support in 0.77 ([release post](https://reactnative.dev/blog/2025/01/21/version-0.77)). The AAR itself is served from `repo.reactnative.dev`, which this workspace cannot reach, so it was not read |
| `libhermes.so` (and `libhermestooling.so`) | `com.facebook.react:hermes-android` prebuilt AAR | 0.81.5 | Expected yes | Same flag in `ReactAndroid/hermes-engine/build.gradle.kts` line 259. Not read (same host) |
| `libfbjni.so` | `com.facebook.fbjni:fbjni` | 0.7.0 | **Yes, read** | arm64-v8a and x86_64: LOAD `0x4000` |
| `libc++_shared.so` | NDK r27 STL, packaged from fbjni / React Native | NDK r27 | **Yes, read** (fbjni copy) | arm64-v8a and x86_64: LOAD `0x4000` |
| `libimagepipeline.so` | `com.facebook.fresco:imagepipeline-native` | 3.6.0 | **Yes, read** | LOAD `0x4000` |
| `libnative-filters.so` | `com.facebook.fresco:nativeimagefilters` | 3.6.0 | **Yes, read** | LOAD `0x4000` |
| `libnative-imagetranscoder.so` | `com.facebook.fresco:nativeimagetranscoder` | 3.6.0 | **Yes, read** | LOAD `0x4000` |
| `libgifimage.so` | `com.facebook.fresco:animated-gif` (`expo.gif.enabled=true` in the template) | 3.6.0 | **Yes, read** | LOAD `0x4000` |
| `libstatic-webp.so` | `com.facebook.fresco:webpsupport` (`expo.webp.enabled=true`) | 3.6.0 | **Yes, read** | LOAD `0x4000` |
| `libexpo-modules-core.so` | `expo-modules-core`, compiled during the build | 3.0.30 | Expected yes | `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` in `expo-modules-core/android/build.gradle` line 92, NDK r27 |
| `librnscreens.so` | `react-native-screens`, compiled during the build | 4.16.0 | Expected yes | Same flag in `react-native-screens/android/build.gradle` line 142, NDK r27 |
| App CMake targets | None under the old architecture (no `libappmodules.so`) | | n/a | The React Native Gradle plugin would add the flag anyway (`NdkConfiguratorUtils.kt` line 58) |

No native code (Java or Kotlin only, nothing to align):

| Package | Version | Notes |
|---|---|---|
| `react-native-maps` | 1.20.1 | Uses `play-services-maps` 18.2.0, `play-services-base`, `play-services-location` 21.0.1, `android-maps-utils` 3.8.2: no `.so` (the map renderer runs inside Google Play services) |
| `expo-location` | 19.0.8 | `play-services-location` |
| `h3-js` | 4.5.0 | Pure JavaScript, runs inside Hermes; nothing native |
| `@react-native-async-storage/async-storage` | 2.2.0 | AndroidX Room on the platform SQLite |
| `react-native-safe-area-context` | 5.6.2 | Its C++ is only built under the new architecture |
| `react-native-view-shot`, `expo-secure-store`, `expo-crypto`, `expo-web-browser`, `expo-file-system`, `expo-sharing`, `expo-haptics`, `expo-system-ui`, `expo-constants`, `expo-font`, `expo-linking` | as in `mobile/package.json` | Kotlin/Java |
| Fresco `memory-type-native`, `memory-type-ashmem`, SoLoader 0.12.1 | | Read: no `.so` in the AARs |

`src/lib/__tests__/android16kPageSize.test.ts` fails if Hermes is switched
off, the NDK drops below r27, AGP drops below 8.5.1, legacy (compressed)
packaging is turned on, fbjni or Fresco go below the versions read above, or
a dependency that compiles C++ does not pass the 16 KB flag. If
`newArchEnabled` is ever turned on, codegen libraries and `libappmodules.so`
join the build: redo this inventory.

## Verifying a built APK or AAB (free, local)

Tools: Android SDK build-tools 35+ (`zipalign`, `aapt2`), the NDK's
`llvm-readelf` or `llvm-objdump` (or binutils `readelf`), and `bundletool`
for an AAB. None of this needs an account or a build service.

**Preview APK (X-04):**

```bash
# 1. Zip alignment of uncompressed libraries
zipalign -v -c -P 16 4 movenrun.apk | tail -1        # "Verification successful"

# 2. ELF LOAD alignment of every 64-bit library
mkdir apk && unzip -q movenrun.apk 'lib/*' -d apk
for so in apk/lib/arm64-v8a/*.so apk/lib/x86_64/*.so; do
  printf '%s ' "$so"; llvm-readelf -lW "$so" | awk '/LOAD/{print $NF}' | sort -u | tr '\n' ' '; echo
done
# Every line must show only 0x4000 (or larger). 0x1000 or 0x2000 on a 64-bit
# library is a fail: note the library and stop.
```

Google also publishes `check_elf_alignment.sh`, which prints `ALIGNED` or
`UNALIGNED` per `arm64-v8a` library (see the page above).

**Production AAB (X-09):**

```bash
bundletool dump config --bundle=movenrun.aab | grep -i alignment   # PAGE_ALIGNMENT_16K
mkdir aab && unzip -q movenrun.aab 'base/lib/*' -d aab
for so in aab/base/lib/arm64-v8a/*.so aab/base/lib/x86_64/*.so; do
  printf '%s ' "$so"; llvm-readelf -lW "$so" | awk '/LOAD/{print $NF}' | sort -u | tr '\n' ' '; echo
done
# To check what a phone actually receives:
bundletool build-apks --bundle=movenrun.aab --output=movenrun.apks --mode=universal
unzip -p movenrun.apks universal.apk > universal.apk && zipalign -v -c -P 16 4 universal.apk | tail -1
```

`build-apks` without `--ks` signs with a debug key; that is fine for this
check and the output is never distributed.

**On a phone or emulator (optional):** an Android 15+ emulator image with a
16 KB kernel ("16 KB page size" system image in the SDK manager); `adb shell
getconf PAGE_SIZE` prints `16384`. Install the APK and repeat Q0-1 (cold
start) there.

**In Play Console (after X-12):** App bundle explorer → the version →
"Memory page size" (or the 16 KB compatibility notice) shows whether Play
considers the bundle compliant. Record the result with the readelf output.

Evidence: the `zipalign` last line, the readelf list (library names and
alignments only), the `bundletool` alignment line, and the App bundle explorer
result. Record under R-04 in `EVIDENCE_REGISTER.md`.
