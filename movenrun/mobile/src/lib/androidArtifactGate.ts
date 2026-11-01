/**
 * Android artifact gate: what a built APK must prove before anyone installs it
 * for the handset sheet or uploads anything to Play.
 *
 * Source tests (`androidPrebuildManifest.test.ts`, `androidManifestHardening`,
 * `androidTargetSdk`) prove what the *config* asks for. They cannot see the
 * Gradle manifest merge, the Hermes compile, the native libraries that ship or
 * the certificate that signed the file. This module decides on those facts,
 * read from an actual APK by `scripts/inspect-android-artifact.ts`.
 *
 * Two kinds of artifact pass through it and must never be confused:
 *
 * - `ci-release`: built on a GitHub runner with `expo prebuild` and
 *   `gradlew assembleRelease`, signed with the template's debug key and with no
 *   Maps key. It proves the merged manifest, permissions, Hermes, ABIs and
 *   16 KB alignment for this commit. It is never installable proof, never the
 *   EAS artifact and never a release signature.
 * - `eas-preview` / `eas-production`: the file EAS built. Only this kind can
 *   answer the signing row, and only as a boolean against an expected
 *   certificate digest the owner stored as a secret.
 *
 * Pure: no file system, no process, no `react-native`. Every value that could
 * identify a key (the Maps key meta-data value, a certificate digest) is
 * reduced to a boolean before it leaves the parser, so a report built from the
 * result cannot print one.
 */

export type ArtifactKind = "ci-release" | "eas-preview" | "eas-production";
export type GateStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT APPLICABLE";

/** The application package Play knows. */
export const EXPECTED_PACKAGE = "io.movenrun.app";
/** Play's target API floor for new apps and updates from 31 Aug 2025. */
export const MIN_TARGET_SDK = 35;
/** The candidate's own baseline (Expo SDK 54); lower means the wrong stack. */
export const EXPECTED_TARGET_SDK = 36;
/** Hermes bytecode file magic, little endian, as the first eight bytes. */
export const HERMES_MAGIC: readonly number[] = Object.freeze([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
/** 16 KB page support: every LOAD segment of a 64-bit library aligned to this. */
export const PAGE_16K = 0x4000;
/** A universal preview APK with four ABIs; far above this means something leaked in. */
export const MAX_APK_BYTES = 160 * 1024 * 1024;

/**
 * Every permission the merged manifest may hold, each with the reason it is
 * there. Anything else fails the gate until a person adds it here on purpose,
 * with a reason a Data safety reviewer could read.
 */
export const ALLOWED_PERMISSIONS: Readonly<Record<string, string>> = Object.freeze({
  "android.permission.ACCESS_FINE_LOCATION": "foreground route recording (app.json)",
  "android.permission.ACCESS_COARSE_LOCATION": "required alongside fine location on Android 12+ (app.json)",
  "android.permission.INTERNET": "API, sign-in and map tiles",
  "android.permission.ACCESS_NETWORK_STATE": "connectivity checks by React Native and Play services; no user data",
  "android.permission.VIBRATE": "haptic feedback (expo-haptics)",
  "android.permission.WAKE_LOCK":
    "AndroidX WorkManager, pulled in by react-native-maps; normal-level, runs no location work",
  "android.permission.RECEIVE_BOOT_COMPLETED":
    "AndroidX WorkManager reschedules its own queued jobs after reboot; the app starts no location or session on boot",
  "io.movenrun.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION":
    "AndroidX core signature permission for the app's own non-exported receivers",
});

/** Never acceptable in Movement Game v1, whatever library asks for them. */
export const FORBIDDEN_PERMISSIONS: readonly string[] = Object.freeze([
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.READ_CONTACTS",
  "android.permission.ACCESS_MEDIA_LOCATION",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "com.google.android.gms.permission.AD_ID",
  /* androidx.biometric (via expo-secure-store) declares these; the app never
     asks for biometric unlock, so app.json removes them in the merge. */
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
]);

/**
 * Components other apps may start, why each is reachable, and the permission
 * that must guard it. `null` means deliberately reachable by any app (the
 * launcher and the sign-in return). A listed component that has lost its
 * guard fails the gate as surely as an unlisted one.
 */
export const ALLOWED_EXPORTED: Readonly<Record<string, { reason: string; permission: string | null }>> = Object.freeze({
  "io.movenrun.app.MainActivity": { reason: "launcher and the movenrun:// sign-in return", permission: null },
  "androidx.profileinstaller.ProfileInstallReceiver":
    { reason: "AndroidX baseline profiles", permission: "android.permission.DUMP" },
  "androidx.work.impl.background.systemjob.SystemJobService":
    { reason: "AndroidX WorkManager (react-native-maps); only the system job scheduler can bind it",
      permission: "android.permission.BIND_JOB_SERVICE" },
  "androidx.work.impl.diagnostics.DiagnosticsReceiver":
    { reason: "AndroidX WorkManager diagnostics", permission: "android.permission.DUMP" },
});

const SIXTY_FOUR_BIT = new Set(["arm64-v8a", "x86_64"]);
const THIRTY_TWO_TO_SIXTY_FOUR: Readonly<Record<string, string>> = { "armeabi-v7a": "arm64-v8a", x86: "x86_64" };

export interface NativeLibrary {
  abi: string;
  name: string;
  /** Smallest LOAD segment alignment; null when it could not be read. */
  minLoadAlign: number | null;
}

export interface ExportedComponent {
  kind: "activity" | "activity-alias" | "service" | "receiver" | "provider";
  name: string;
  /** The permission a caller must hold, when the component declares one. */
  permission?: string;
}

/** What the inspection read from one APK. Nothing in here may be a secret. */
export interface ArtifactFacts {
  kind: ArtifactKind;
  packageName: string | null;
  versionCode: number | null;
  versionName: string | null;
  minSdk: number | null;
  targetSdk: number | null;
  permissions: string[];
  allowBackup: boolean | null;
  usesCleartextTraffic: boolean | null;
  debuggable: boolean | null;
  testOnly: boolean | null;
  /** False when the xmltree dump had no <manifest> element (tool missing or failed). */
  manifestParsed: boolean;
  hasDataExtractionRules: boolean;
  exported: ExportedComponent[];
  /** Every scheme in a VIEW intent filter. */
  schemes: string[];
  /** Whether the Maps key meta-data is present. Its value is never read out. */
  mapsKeyPresent: boolean;
  hermesBytecode: boolean | null;
  nativeLibraries: NativeLibrary[];
  /** `zipalign -c -P 16 4` result; null when not run. */
  zipAligned16k: boolean | null;
  /** True when signed by the well-known Android debug certificate. */
  debugSigned: boolean | null;
  /** False when apksigner output had no signer DN or digest (tool missing, failed or unsigned). */
  signerReadable: boolean;
  /** Certificate digest equals the owner's expected digest; null when not compared. */
  signingMatchesExpected: boolean | null;
  /** Server-secret patterns found in the unpacked APK; null when not scanned. */
  secretFindings: number | null;
  /** Files the scanner skipped because of their size (20 MB or more); null when not counted. */
  secretScanSkipped: number | null;
  sizeBytes: number | null;
}

export interface GateRow {
  id: string;
  check: string;
  status: GateStatus;
  detail: string;
}

export interface GateResult {
  kind: ArtifactKind;
  rows: GateRow[];
  /** FAIL if any row failed; BLOCKED if any row is blocked; otherwise PASS. */
  overall: "PASS" | "FAIL" | "BLOCKED";
}

/* ---------------------------------------------------------------- parsers */

/** `aapt2 dump badging` → package, versions, SDKs, permissions. */
export function parseBadging(text: string): Pick<ArtifactFacts,
  "packageName" | "versionCode" | "versionName" | "minSdk" | "targetSdk" | "permissions"> {
  const pkg = /^package:\s*(.*)$/m.exec(text)?.[1] ?? "";
  const attr = (line: string, key: string) => new RegExp(`\\b${key}='([^']*)'`).exec(line)?.[1] ?? null;
  const num = (value: string | null) => (value !== null && /^\d+$/.test(value) ? Number(value) : null);
  const permissions = new Set<string>();
  for (const m of text.matchAll(/^uses-permission(?:-sdk-23)?:\s*name='([^']+)'/gm)) permissions.add(m[1]!);
  return {
    packageName: attr(pkg, "name"),
    versionCode: num(attr(pkg, "versionCode")),
    versionName: attr(pkg, "versionName"),
    minSdk: num(/^(?:sdkVersion|minSdkVersion):'(\d+)'/m.exec(text)?.[1] ?? null),
    targetSdk: num(/^targetSdkVersion:'(\d+)'/m.exec(text)?.[1] ?? null),
    permissions: [...permissions].sort(),
  };
}

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

/**
 * `aapt2 dump xmltree --file AndroidManifest.xml` → element tree.
 *
 * Attribute names are reduced to their local part (`android:exported` →
 * `exported`). Values are kept raw for the decoders below; the tree never
 * leaves this module, so a meta-data value cannot reach a report.
 */
function parseXmlTree(text: string): XmlNode | null {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack: { depth: number; node: XmlNode }[] = [{ depth: -1, node: root }];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^(\s*)([ENAT]):\s?(.*)$/.exec(raw);
    if (!m) continue;
    const depth = m[1]!.length;
    const tag = m[2]!;
    const body = m[3]!;
    if (tag === "E") {
      const name = body.split(/\s+/)[0] ?? "";
      while (stack.length > 1 && stack[stack.length - 1]!.depth >= depth) stack.pop();
      const node: XmlNode = { name, attrs: {}, children: [] };
      stack[stack.length - 1]!.node.children.push(node);
      stack.push({ depth, node });
    } else if (tag === "A") {
      while (stack.length > 1 && stack[stack.length - 1]!.depth >= depth) stack.pop();
      const eq = body.indexOf("=");
      if (eq < 0) continue;
      const fullName = body.slice(0, eq).replace(/\(0x[0-9a-f]+\)$/i, "");
      const local = fullName.slice(fullName.lastIndexOf(":") + 1);
      let value = body.slice(eq + 1).trim();
      const raw = /\s\(Raw:\s*"([^"]*)"\)$/.exec(value);
      if (raw) value = raw[1]!;
      else value = value.replace(/^"(.*)"$/, "$1");
      stack[stack.length - 1]!.node.attrs[local] = value;
    }
  }
  return root.children.find((n) => n.name === "manifest") ?? null;
}

/** aapt2 prints booleans as `true`/`false` or as `(type 0x12)0xffffffff`/`0x0`. */
export function decodeBool(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  const typed = /^\(type 0x12\)0x([0-9a-f]+)$/.exec(v);
  if (typed) return Number.parseInt(typed[1]!, 16) !== 0;
  return null;
}

const COMPONENT_KINDS = new Set(["activity", "activity-alias", "service", "receiver", "provider"]);

/** The manifest facts the gate needs, from the xmltree dump. */
export function parseManifestTree(text: string, packageName: string | null): Pick<ArtifactFacts,
  "allowBackup" | "usesCleartextTraffic" | "debuggable" | "testOnly" | "manifestParsed" | "hasDataExtractionRules" |
  "exported" | "schemes" | "mapsKeyPresent"> {
  const manifest = parseXmlTree(text);
  const app = manifest?.children.find((n) => n.name === "application");
  const exported: ExportedComponent[] = [];
  const schemes = new Set<string>();
  let mapsKeyPresent = false;
  const qualify = (name: string) => (name.startsWith(".") && packageName ? `${packageName}${name}` : name);
  for (const child of app?.children ?? []) {
    if (child.name === "meta-data" && child.attrs.name === "com.google.android.geo.API_KEY") {
      mapsKeyPresent = (child.attrs.value ?? "").length > 0;
      continue;
    }
    if (!COMPONENT_KINDS.has(child.name)) continue;
    const filters = child.children.filter((n) => n.name === "intent-filter");
    for (const filter of filters) {
      const isView = filter.children.some((n) => n.name === "action" && n.attrs.name === "android.intent.action.VIEW");
      if (!isView) continue;
      for (const data of filter.children.filter((n) => n.name === "data")) {
        if (data.attrs.scheme) schemes.add(data.attrs.scheme);
      }
    }
    /* An absent `exported` means "exported if it has an intent filter" only
       below API 31; this candidate targets 36, where the merge refuses that
       case, so absent is treated as not exported. A provider is the one
       exception that never defaulted to true at our targets either. */
    if (decodeBool(child.attrs.exported) === true) {
      const component: ExportedComponent = { kind: child.name as ExportedComponent["kind"], name: qualify(child.attrs.name ?? "") };
      if (child.attrs.permission) component.permission = child.attrs.permission;
      exported.push(component);
    }
  }
  return {
    allowBackup: decodeBool(app?.attrs.allowBackup),
    usesCleartextTraffic: decodeBool(app?.attrs.usesCleartextTraffic),
    debuggable: decodeBool(app?.attrs.debuggable),
    testOnly: decodeBool(app?.attrs.testOnly),
    manifestParsed: manifest !== null,
    hasDataExtractionRules: app?.attrs.dataExtractionRules !== undefined,
    exported: exported.sort((a, b) => a.name.localeCompare(b.name)),
    schemes: [...schemes].sort(),
    mapsKeyPresent,
  };
}

/** `readelf -lW lib.so` → the smallest LOAD alignment, or null. */
export function parseMinLoadAlign(text: string): number | null {
  let min: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*LOAD\s+.*\s(0x[0-9a-fA-F]+)\s*$/.exec(line);
    if (!m) continue;
    const align = Number.parseInt(m[1]!, 16);
    if (!Number.isFinite(align)) continue;
    min = min === null ? align : Math.min(min, align);
  }
  return min;
}

/** `apksigner verify --print-certs` → digest match and debug-key use, as booleans only. */
export function parseSigner(text: string, expectedSha256: string | null | undefined): {
  debugSigned: boolean | null; signerReadable: boolean; signingMatchesExpected: boolean | null;
} {
  const dn = /Signer #1 certificate DN:\s*(.+)$/m.exec(text)?.[1] ?? null;
  const digest = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/m.exec(text)?.[1] ?? null;
  const norm = (v: string) => v.replace(/:/g, "").trim().toLowerCase();
  const expected = typeof expectedSha256 === "string" && norm(expectedSha256).length === 64 ? norm(expectedSha256) : null;
  return {
    debugSigned: dn === null ? null : /\bCN=Android Debug\b/.test(dn),
    signerReadable: dn !== null && digest !== null,
    signingMatchesExpected: digest === null || expected === null ? null : norm(digest) === expected,
  };
}

export function isHermesBytecode(head: Uint8Array | null): boolean | null {
  if (head === null) return null;
  if (head.length < HERMES_MAGIC.length) return false;
  return HERMES_MAGIC.every((byte, i) => head[i] === byte);
}

/* --------------------------------------------------------------- decision */

const row = (id: string, check: string, status: GateStatus, detail: string): GateRow => ({ id, check, status, detail });
const bool = (id: string, check: string, value: boolean | null, want: boolean, detail: string): GateRow =>
  value === null ? row(id, check, "FAIL", `${detail}: not readable from the APK`)
    : row(id, check, value === want ? "PASS" : "FAIL", `${detail}: ${String(value)}`);

export function evaluateArtifact(f: ArtifactFacts): GateResult {
  const isEas = f.kind !== "ci-release";
  const rows: GateRow[] = [];

  rows.push(row("A1", "Package name", f.packageName === EXPECTED_PACKAGE ? "PASS" : "FAIL",
    `${f.packageName ?? "unreadable"} (expected ${EXPECTED_PACKAGE})`));
  rows.push(row("A2", "versionCode present", f.versionCode !== null && f.versionCode > 0 ? "PASS" : "FAIL",
    `versionCode ${f.versionCode ?? "unreadable"}, versionName ${f.versionName ?? "unreadable"}`));
  rows.push(row("A3", "targetSdk", f.targetSdk !== null && f.targetSdk >= EXPECTED_TARGET_SDK ? "PASS" : "FAIL",
    `targetSdk ${f.targetSdk ?? "unreadable"} (Play floor ${MIN_TARGET_SDK}, candidate baseline ${EXPECTED_TARGET_SDK})`));
  rows.push(row("A4", "minSdk", f.minSdk !== null && f.minSdk >= 24 ? "PASS" : "FAIL",
    `minSdk ${f.minSdk ?? "unreadable"}`));

  const forbidden = f.permissions.filter((p) => FORBIDDEN_PERMISSIONS.includes(p));
  const unknown = f.permissions.filter((p) => !Object.prototype.hasOwnProperty.call(ALLOWED_PERMISSIONS, p) && !FORBIDDEN_PERMISSIONS.includes(p));
  const missing = ["android.permission.ACCESS_FINE_LOCATION", "android.permission.INTERNET"]
    .filter((p) => !f.permissions.includes(p));
  rows.push(row("A5", "Merged permissions", forbidden.length || unknown.length || missing.length ? "FAIL" : "PASS",
    forbidden.length ? `forbidden: ${forbidden.join(", ")}`
      : unknown.length ? `not on the allowlist: ${unknown.join(", ")}`
        : missing.length ? `missing: ${missing.join(", ")}`
          : `${f.permissions.length} permissions, all allowlisted`));

  rows.push(bool("A6", "allowBackup is false", f.allowBackup, false, "allowBackup"));
  rows.push(row("A7", "Data extraction rules present", f.hasDataExtractionRules ? "PASS" : "FAIL",
    f.hasDataExtractionRules ? "dataExtractionRules set" : "dataExtractionRules missing"));
  rows.push(bool("A8", "Cleartext traffic off", f.usesCleartextTraffic, false, "usesCleartextTraffic"));
  rows.push(row("A9", "Not debuggable or test-only",
    !f.manifestParsed || f.debuggable === true || f.testOnly === true ? "FAIL" : "PASS",
    !f.manifestParsed ? "manifest not readable from the APK" : `debuggable ${String(f.debuggable ?? false)}, testOnly ${String(f.testOnly ?? false)}`));

  const unexpected = f.exported.filter((c) => {
    const allowed = Object.prototype.hasOwnProperty.call(ALLOWED_EXPORTED, c.name) ? ALLOWED_EXPORTED[c.name] : undefined;
    return !allowed || (allowed.permission !== null && c.permission !== allowed.permission);
  });
  rows.push(row("A10", "Exported components", unexpected.length ? "FAIL" : "PASS",
    unexpected.length ? `unexpected or unguarded: ${unexpected.map((c) => `${c.kind} ${c.name}${c.permission ? ` (${c.permission})` : " (no permission)"}`).join(", ")}`
      : `${f.exported.map((c) => c.name).join(", ") || "none"}`));
  const badSchemes = f.schemes.filter((s) => s !== "movenrun");
  rows.push(row("A11", "Deep-link schemes", badSchemes.length || !f.schemes.includes("movenrun") ? "FAIL" : "PASS",
    `schemes: ${f.schemes.join(", ") || "none"}`));

  rows.push(bool("A12", "Hermes bytecode bundle", f.hermesBytecode, true, "assets/index.android.bundle is Hermes bytecode"));

  const abis = [...new Set(f.nativeLibraries.map((l) => l.abi))].sort();
  const lacking64 = abis.filter((a) => a in THIRTY_TWO_TO_SIXTY_FOUR && !abis.includes(THIRTY_TWO_TO_SIXTY_FOUR[a]!));
  rows.push(row("A13", "64-bit native libraries", !abis.includes("arm64-v8a") || lacking64.length ? "FAIL" : "PASS",
    `ABIs: ${abis.join(", ") || "none"}${lacking64.length ? `; no 64-bit pair for ${lacking64.join(", ")}` : ""}`));
  const libs64 = f.nativeLibraries.filter((l) => SIXTY_FOUR_BIT.has(l.abi));
  const misaligned = libs64.filter((l) => l.minLoadAlign === null || l.minLoadAlign < PAGE_16K);
  rows.push(row("A14", "16 KB ELF alignment (64-bit libraries)", libs64.length === 0 || misaligned.length ? "FAIL" : "PASS",
    misaligned.length ? `below 0x4000: ${misaligned.map((l) => `${l.abi}/${l.name}`).join(", ")}`
      : `${libs64.length} libraries at 0x4000 or more`));
  rows.push(f.zipAligned16k === null ? row("A15", "16 KB zip alignment", "FAIL", "zipalign not run")
    : row("A15", "16 KB zip alignment", f.zipAligned16k ? "PASS" : "FAIL", `zipalign -c -P 16: ${f.zipAligned16k ? "verified" : "failed"}`));

  rows.push(f.secretFindings === null || f.secretScanSkipped === null ? row("A16", "Static secret scan", "FAIL", "not run")
    : f.secretScanSkipped > 0 ? row("A16", "Static secret scan", "FAIL",
      `${f.secretScanSkipped} file(s) of 20 MB or more were not scanned; ${f.secretFindings} finding(s) in the rest`)
      : row("A16", "Static secret scan", f.secretFindings === 0 ? "PASS" : "FAIL", `${f.secretFindings} finding(s); kinds only, never values`));
  rows.push(f.sizeBytes === null ? row("A17", "APK size", "FAIL", "size unknown")
    : row("A17", "APK size", f.sizeBytes <= MAX_APK_BYTES ? "PASS" : "FAIL",
      `${(f.sizeBytes / 1024 / 1024).toFixed(1)} MiB (limit ${MAX_APK_BYTES / 1024 / 1024} MiB)`));

  if (!isEas) {
    rows.push(row("A18", "Maps key compiled in", "NOT APPLICABLE", "CI build has no Maps key by design"));
    rows.push(row("A19", "Release signing certificate", "NOT APPLICABLE",
      "CI build is signed with the template debug key; it is not installable proof and not the EAS artifact"));
  } else {
    rows.push(row("A18", "Maps key compiled in", f.mapsKeyPresent ? "PASS" : "FAIL",
      f.mapsKeyPresent ? "present (value not read)" : "missing: the map would render without tiles"));
    if (!f.signerReadable) {
      rows.push(row("A19", "Release signing certificate", "FAIL", "signer unreadable: apksigner gave no certificate"));
    } else if (f.debugSigned === true) {
      rows.push(row("A19", "Release signing certificate", "FAIL", "signed with the Android debug certificate"));
    } else if (f.signingMatchesExpected === null) {
      rows.push(row("A19", "Release signing certificate", "BLOCKED",
        "expected certificate digest not provided; compared as a boolean only once the owner stores it"));
    } else {
      rows.push(row("A19", "Release signing certificate", f.signingMatchesExpected ? "PASS" : "FAIL",
        f.signingMatchesExpected ? "matches the expected certificate" : "does not match the expected certificate"));
    }
  }

  const overall = rows.some((r) => r.status === "FAIL") ? "FAIL"
    : rows.some((r) => r.status === "BLOCKED") ? "BLOCKED" : "PASS";
  return { kind: f.kind, rows, overall };
}

/** The report a person reads. Built only from `GateResult`, which holds no secret. */
export function renderGateReport(result: GateResult, provenance: Readonly<Record<string, string>>): string {
  const lines = [
    `# Android artifact gate: ${result.overall}`,
    "",
    `Artifact kind: \`${result.kind}\`${result.kind === "ci-release"
      ? " (GitHub runner build, debug-signed, no Maps key: proves packaging, not installability or release signing)" : ""}`,
    "",
    "| Field | Value |",
    "|---|---|",
    ...Object.entries(provenance).map(([k, v]) => `| ${k} | ${v.replace(/\|/g, "\\|")} |`),
    "",
    "| Row | Check | Result | Detail |",
    "|---|---|---|---|",
    ...result.rows.map((r) => `| ${r.id} | ${r.check} | ${r.status} | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
  ];
  return lines.join("\n");
}
