/**
 * The artifact gate decides on facts read from a built APK. These tests pin
 * the decisions and the parsers on fixtures shaped like real `aapt2`,
 * `readelf` and `apksigner` output, and above all pin that no key value or
 * certificate digest can reach a report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeBool,
  evaluateArtifact,
  isHermesBytecode,
  parseBadging,
  parseManifestTree,
  parseMinLoadAlign,
  parseSigner,
  renderGateReport,
  type ArtifactFacts,
} from "../androidArtifactGate";

const BADGING = `package: name='io.movenrun.app' versionCode='7' versionName='1.0.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
sdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.ACCESS_COARSE_LOCATION'
uses-permission: name='android.permission.ACCESS_FINE_LOCATION'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.VIBRATE'
uses-permission: name='io.movenrun.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
application-label:'MovenRun'
launchable-activity: name='io.movenrun.app.MainActivity'  label='' icon=''
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'
`;

const MAPS_KEY_VALUE = "AIzaFAKE_FIXTURE_KEY_VALUE_123456789";
const SIGNING_DIGEST = "ab".repeat(32);

function xmltree(opts: { exported?: string; extra?: string; cleartext?: string; backup?: string } = {}): string {
  return `N: android=http://schemas.android.com/apk/res/android (line=2)
  E: manifest (line=2)
    A: http://schemas.android.com/apk/res/android:versionCode(0x0101021b)=7
    A: package="io.movenrun.app" (Raw: "io.movenrun.app")
    E: uses-permission (line=3)
      A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")
    E: application (line=10)
      A: http://schemas.android.com/apk/res/android:name(0x01010003)="io.movenrun.app.MainApplication" (Raw: "io.movenrun.app.MainApplication")
      A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=${opts.backup ?? "false"}
      A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=${opts.cleartext ?? "false"}
      A: http://schemas.android.com/apk/res/android:dataExtractionRules(0x0101063e)=@0x7f150000
      E: meta-data (line=11)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.android.geo.API_KEY" (Raw: "com.google.android.geo.API_KEY")
        A: http://schemas.android.com/apk/res/android:value(0x01010024)="${MAPS_KEY_VALUE}" (Raw: "${MAPS_KEY_VALUE}")
      E: activity (line=12)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)=".MainActivity" (Raw: ".MainActivity")
        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=${opts.exported ?? "true"}
        E: intent-filter (line=13)
          E: action (line=14)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
        E: intent-filter (line=16)
          E: action (line=17)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")
          E: data (line=18)
            A: http://schemas.android.com/apk/res/android:scheme(0x01010027)="movenrun" (Raw: "movenrun")
      E: service (line=20)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="expo.modules.location.services.LocationTaskService" (Raw: "expo.modules.location.services.LocationTaskService")
        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=(type 0x12)0x0
      E: receiver (line=22)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="androidx.profileinstaller.ProfileInstallReceiver" (Raw: "androidx.profileinstaller.ProfileInstallReceiver")
        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=(type 0x12)0xffffffff
${opts.extra ?? ""}`;
}

const READELF_16K = `
Elf file type is DYN (Shared object file)
Program Headers:
  Type           Offset   VirtAddr           PhysAddr           FileSiz  MemSiz   Flg Align
  PHDR           0x000040 0x0000000000000040 0x0000000000000040 0x000230 0x000230 R   0x8
  LOAD           0x000000 0x0000000000000000 0x0000000000000000 0x0a1b2c 0x0a1b2c R   0x4000
  LOAD           0x0a4000 0x00000000000a4000 0x00000000000a4000 0x1c0000 0x1c0000 R E 0x4000
  DYNAMIC        0x2a0000 0x00000000002a0000 0x00000000002a0000 0x000200 0x000200 RW  0x8
`;
const READELF_4K = READELF_16K.replace(/R E 0x4000/, "R E 0x1000");

function goodFacts(kind: ArtifactFacts["kind"] = "ci-release"): ArtifactFacts {
  const badging = parseBadging(BADGING);
  return {
    kind,
    ...badging,
    ...parseManifestTree(xmltree(), badging.packageName),
    hermesBytecode: true,
    nativeLibraries: ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].map((abi) => ({
      abi, name: "libhermes.so", minLoadAlign: abi.includes("64") ? 0x4000 : 0x1000,
    })),
    zipAligned16k: true,
    debugSigned: kind === "ci-release",
    signingMatchesExpected: null,
    secretFindings: 0,
    sizeBytes: 80 * 1024 * 1024,
  };
}

const status = (facts: ArtifactFacts, id: string) => evaluateArtifact(facts).rows.find((r) => r.id === id)?.status;

test("badging parser reads package, versions, SDKs and permissions", () => {
  const b = parseBadging(BADGING);
  assert.equal(b.packageName, "io.movenrun.app");
  assert.equal(b.versionCode, 7);
  assert.equal(b.versionName, "1.0.0");
  assert.equal(b.minSdk, 24);
  assert.equal(b.targetSdk, 36);
  assert.equal(b.permissions.length, 5);
});

test("manifest parser reads backup, cleartext, exported components and schemes", () => {
  const m = parseManifestTree(xmltree(), "io.movenrun.app");
  assert.equal(m.allowBackup, false);
  assert.equal(m.usesCleartextTraffic, false);
  assert.equal(m.hasDataExtractionRules, true);
  assert.deepEqual(m.schemes, ["movenrun"]);
  assert.deepEqual(m.exported.map((c) => c.name),
    ["androidx.profileinstaller.ProfileInstallReceiver", "io.movenrun.app.MainActivity"]);
  assert.equal(m.mapsKeyPresent, true);
});

test("aapt2 typed booleans decode", () => {
  assert.equal(decodeBool("(type 0x12)0xffffffff"), true);
  assert.equal(decodeBool("(type 0x12)0x0"), false);
  assert.equal(decodeBool("true"), true);
  assert.equal(decodeBool(undefined), null);
  assert.equal(decodeBool("@0x7f150000"), null);
});

test("a clean CI release build passes, with signing and Maps rows not applicable", () => {
  const result = evaluateArtifact(goodFacts());
  assert.equal(result.overall, "PASS", JSON.stringify(result.rows.filter((r) => r.status !== "PASS")));
  assert.equal(result.rows.find((r) => r.id === "A19")?.status, "NOT APPLICABLE");
  assert.equal(result.rows.find((r) => r.id === "A18")?.status, "NOT APPLICABLE");
});

test("an EAS artifact without an expected digest is BLOCKED, never PASS", () => {
  const facts = goodFacts("eas-preview");
  assert.equal(evaluateArtifact(facts).overall, "BLOCKED");
  assert.equal(status(facts, "A19"), "BLOCKED");
});

test("an EAS artifact signed with the debug key fails", () => {
  assert.equal(status({ ...goodFacts("eas-preview"), debugSigned: true }, "A19"), "FAIL");
});

test("an EAS artifact with a matching certificate and Maps key passes", () => {
  const facts = { ...goodFacts("eas-preview"), debugSigned: false, signingMatchesExpected: true };
  assert.equal(evaluateArtifact(facts).overall, "PASS");
  assert.equal(status({ ...facts, signingMatchesExpected: false }, "A19"), "FAIL");
  assert.equal(status({ ...facts, mapsKeyPresent: false }, "A18"), "FAIL");
});

test("background location, foreground service or any unlisted permission fails", () => {
  for (const p of ["android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.RECORD_AUDIO", "android.permission.WAKE_LOCK"]) {
    const facts = goodFacts();
    assert.equal(status({ ...facts, permissions: [...facts.permissions, p] }, "A5"), "FAIL", p);
  }
});

test("backup on, cleartext on, debuggable or an extra exported component fails", () => {
  const badging = parseBadging(BADGING);
  assert.equal(status({ ...goodFacts(), ...parseManifestTree(xmltree({ backup: "true" }), badging.packageName) }, "A6"), "FAIL");
  assert.equal(status({ ...goodFacts(), ...parseManifestTree(xmltree({ cleartext: "true" }), badging.packageName) }, "A8"), "FAIL");
  assert.equal(status({ ...goodFacts(), debuggable: true }, "A9"), "FAIL");
  const extra = `      E: service (line=30)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.example.Leaky" (Raw: "com.example.Leaky")
        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
`;
  assert.equal(status({ ...goodFacts(), ...parseManifestTree(xmltree({ extra }), badging.packageName) }, "A10"), "FAIL");
});

test("an unreadable manifest fails closed instead of passing", () => {
  const facts = { ...goodFacts(), ...parseManifestTree("", "io.movenrun.app") };
  const result = evaluateArtifact(facts);
  assert.equal(result.overall, "FAIL");
  assert.equal(status(facts, "A6"), "FAIL");
  assert.equal(status(facts, "A11"), "FAIL");
});

test("a 4 KB-aligned 64-bit library fails the 16 KB row; 32-bit libraries are not judged", () => {
  assert.equal(parseMinLoadAlign(READELF_16K), 0x4000);
  assert.equal(parseMinLoadAlign(READELF_4K), 0x1000);
  const facts = goodFacts();
  assert.equal(status(facts, "A14"), "PASS");
  const bad = { ...facts, nativeLibraries: [...facts.nativeLibraries, { abi: "arm64-v8a", name: "libold.so", minLoadAlign: 0x1000 }] };
  assert.equal(status(bad, "A14"), "FAIL");
});

test("a 32-bit ABI without its 64-bit pair fails", () => {
  const facts = { ...goodFacts(), nativeLibraries: [{ abi: "armeabi-v7a", name: "libx.so", minLoadAlign: 0x1000 }] };
  assert.equal(status(facts, "A13"), "FAIL");
});

test("Hermes magic is recognised; a plain JS bundle is not", () => {
  assert.equal(isHermesBytecode(Uint8Array.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f])), true);
  assert.equal(isHermesBytecode(new TextEncoder().encode("var __BUNDLE")), false);
  assert.equal(status({ ...goodFacts(), hermesBytecode: false }, "A12"), "FAIL");
});

test("signer parser yields booleans only and treats a malformed expectation as not compared", () => {
  const out = `Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Signer #1 certificate DN: CN=Android Debug, O=Android, C=US
Signer #1 certificate SHA-256 digest: ${SIGNING_DIGEST}
Signer #1 certificate SHA-1 digest: ${"cd".repeat(20)}
`;
  assert.deepEqual(parseSigner(out, SIGNING_DIGEST.toUpperCase().match(/../g)!.join(":")),
    { debugSigned: true, signingMatchesExpected: true });
  assert.deepEqual(parseSigner(out, "not-a-digest"), { debugSigned: true, signingMatchesExpected: null });
  assert.deepEqual(parseSigner(out, "ef".repeat(32)), { debugSigned: true, signingMatchesExpected: false });
  assert.deepEqual(parseSigner("", SIGNING_DIGEST), { debugSigned: null, signingMatchesExpected: null });
});

test("no Maps key value or certificate digest can appear in the report or the facts", () => {
  const facts = { ...goodFacts("eas-preview"), ...parseSigner(`Signer #1 certificate DN: CN=Release
Signer #1 certificate SHA-256 digest: ${SIGNING_DIGEST}`, SIGNING_DIGEST) };
  const text = renderGateReport(evaluateArtifact(facts), { "Build": "fixture" }) + JSON.stringify(facts);
  assert.ok(!text.includes(MAPS_KEY_VALUE), "Maps key value leaked");
  assert.ok(!text.includes(SIGNING_DIGEST), "certificate digest leaked");
  assert.ok(!text.toLowerCase().includes("aiza"), "key prefix leaked");
});

test("secret findings, a missing scan or an oversized APK fail", () => {
  assert.equal(status({ ...goodFacts(), secretFindings: 2 }, "A16"), "FAIL");
  assert.equal(status({ ...goodFacts(), secretFindings: null }, "A16"), "FAIL");
  assert.equal(status({ ...goodFacts(), sizeBytes: 400 * 1024 * 1024 }, "A17"), "FAIL");
});
