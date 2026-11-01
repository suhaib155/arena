/**
 * Read one APK with the Android build tools and decide it with
 * `src/lib/androidArtifactGate.ts`.
 *
 *   node --import tsx scripts/inspect-android-artifact.ts \
 *     --apk app.apk --kind ci-release|eas-preview|eas-production \
 *     --out report.md [--json report.json] [--provenance key=value ...]
 *
 * Tools come from the environment GitHub's Ubuntu runner already has:
 * `aapt2`, `apksigner` and `zipalign` from the newest `$ANDROID_HOME/build-tools`,
 * plus `unzip` and binutils `readelf`. A tool that is missing makes its rows
 * FAIL; nothing is skipped quietly.
 *
 * Secret handling: raw tool output is parsed in memory and never printed. The
 * expected signing digest is read from `EXPECTED_SIGNING_CERT_SHA256` (an
 * Actions secret) and compared as a boolean. The secret scan reuses
 * `../scripts/check-secrets.mjs`, which prints kinds and paths only.
 *
 * Exit code: 0 for PASS, 2 for BLOCKED, 1 for FAIL.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  evaluateArtifact,
  isHermesBytecode,
  parseBadging,
  parseManifestTree,
  parseMinLoadAlign,
  parseSigner,
  renderGateReport,
  type ArtifactFacts,
  type ArtifactKind,
  type NativeLibrary,
} from "../src/lib/androidArtifactGate";

const KINDS: readonly ArtifactKind[] = ["ci-release", "eas-preview", "eas-production"];

function args(argv: string[]) {
  const out: { apk?: string; kind?: ArtifactKind; out?: string; json?: string; provenance: Record<string, string> } = { provenance: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--apk") out.apk = next();
    else if (a === "--kind") out.kind = next() as ArtifactKind;
    else if (a === "--out") out.out = next();
    else if (a === "--json") out.json = next();
    else if (a === "--provenance") {
      const [k, ...v] = next().split("=");
      if (k) out.provenance[k] = v.join("=");
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!out.apk || !out.kind || !KINDS.includes(out.kind) || !out.out) {
    throw new Error("usage: --apk <file> --kind ci-release|eas-preview|eas-production --out <report.md>");
  }
  return out;
}

function buildTool(name: string): string | null {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!home) return null;
  const dir = join(home, "build-tools");
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir).filter((v) => existsSync(join(dir, v, name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const best = versions[versions.length - 1];
  return best ? join(dir, best, name) : null;
}

/** Run a tool and return stdout, or null on any failure. Output is never echoed. */
function run(tool: string | null, argv: string[]): string | null {
  if (!tool) return null;
  const r = spawnSync(tool, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function readHead(path: string, bytes: number): Uint8Array | null {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(bytes);
      const n = readSync(fd, buf, 0, bytes, 0);
      return buf.subarray(0, n);
    } finally { closeSync(fd); }
  } catch { return null; }
}

function main() {
  const opts = args(process.argv.slice(2));
  const apk = resolve(opts.apk!);
  const aapt2 = buildTool("aapt2");
  const apksigner = buildTool("apksigner");
  const zipalign = buildTool("zipalign");

  const badging = parseBadging(run(aapt2, ["dump", "badging", apk]) ?? "");
  const manifest = parseManifestTree(run(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", apk]) ?? "", badging.packageName);

  const work = mkdtempSync(join(tmpdir(), "apk-gate-"));
  const unpacked = join(work, "apk");
  let unzipped = true;
  try { execFileSync("unzip", ["-q", "-o", apk, "-d", unpacked], { stdio: "ignore" }); } catch { unzipped = false; }

  const bundle = join(unpacked, "assets", "index.android.bundle");
  const hermesBytecode = unzipped ? (existsSync(bundle) ? isHermesBytecode(readHead(bundle, 8)) : false) : null;

  const nativeLibraries: NativeLibrary[] = [];
  const libRoot = join(unpacked, "lib");
  if (unzipped && existsSync(libRoot)) {
    for (const abi of readdirSync(libRoot).sort()) {
      for (const name of readdirSync(join(libRoot, abi)).filter((n) => n.endsWith(".so")).sort()) {
        const elf = run("readelf", ["-lW", join(libRoot, abi, name)]);
        nativeLibraries.push({ abi, name, minLoadAlign: elf === null ? null : parseMinLoadAlign(elf) });
      }
    }
  }

  const zipAligned16k = zipalign ? spawnSync(zipalign, ["-c", "-P", "16", "4", apk], { stdio: "ignore" }).status === 0 : null;
  const signer = parseSigner(run(apksigner, ["verify", "--print-certs", apk]) ?? "", process.env.EXPECTED_SIGNING_CERT_SHA256);

  let secretFindings: number | null = null;
  let secretScanSkipped: number | null = null;
  if (unzipped) {
    /* check-secrets.mjs skips files of 20 MB or more; count them so A16 can say so. */
    const SKIP_BYTES = 20 * 1024 * 1024;
    const walk = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
      const p = join(dir, e.name);
      return n + (e.isDirectory() ? walk(p) : e.isFile() && statSync(p).size >= SKIP_BYTES ? 1 : 0);
    }, 0);
    try { secretScanSkipped = walk(unpacked); } catch { secretScanSkipped = null; }
    const scanner = resolve(__dirname, "..", "..", "scripts", "check-secrets.mjs");
    const scan = spawnSync(process.execPath, [scanner, unpacked], { encoding: "utf8" });
    const m = /Secret scan FAILED \((\d+)\)/.exec(scan.stderr);
    secretFindings = scan.status === 0 ? 0 : m ? Number(m[1]) : null;
    /* Kinds and paths are safe to show (check-secrets never prints a value). */
    if (scan.status !== 0) process.stderr.write(scan.stdout + scan.stderr);
  }

  const facts: ArtifactFacts = {
    kind: opts.kind!,
    ...badging,
    ...manifest,
    hermesBytecode,
    nativeLibraries,
    zipAligned16k,
    ...signer,
    secretFindings,
    secretScanSkipped,
    sizeBytes: existsSync(apk) ? statSync(apk).size : null,
  };
  const result = evaluateArtifact(facts);
  const report = renderGateReport(result, {
    ...opts.provenance,
    "Tools": `aapt2 ${aapt2 ? "found" : "MISSING"}, apksigner ${apksigner ? "found" : "MISSING"}, zipalign ${zipalign ? "found" : "MISSING"}`,
  });
  writeFileSync(opts.out!, report);
  if (opts.json) {
    /* Facts hold no secret by construction: booleans for the key and the certificate. */
    writeFileSync(opts.json, JSON.stringify({ result, facts }, null, 2));
  }
  process.stdout.write(report);
  process.exitCode = result.overall === "PASS" ? 0 : result.overall === "BLOCKED" ? 2 : 1;
}

main();
