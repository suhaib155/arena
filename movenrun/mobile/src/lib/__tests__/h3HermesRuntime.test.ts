/**
 * The dependency boundary between H3 and the Android JavaScript engine.
 *
 * ## What went wrong
 *
 * The APK built from the sealing-engine head compiled cleanly, shipped, and
 * then died on launch on a physical Android device:
 *
 *     RangeError: Unknown encoding: utf-16le (normalized: utf-16le)
 *
 * The cause was one line of generated Emscripten runtime code inside the h3-js
 * bundle, executed while the module initialised:
 *
 *     var UTF16Decoder = typeof TextDecoder !== "undefined"
 *       ? new TextDecoder("utf-16le") : undefined;
 *
 * Hermes implements `TextDecoder` for UTF-8 only. The guard in that line asks
 * whether `TextDecoder` exists — it does — and then constructs one for an
 * encoding Hermes does not have. `UTF16Decoder` is never read anywhere in the
 * bundle; the minified UMD build is proof, because its minifier already found
 * the binding unused and deleted it, keeping only the constructor call it could
 * not prove side-effect-free. So the app was killed at startup by a value
 * nothing would ever have used.
 *
 * A committed Yarn patch removes the construction from every shipped h3-js
 * artifact and leaves the binding at `undefined` — a value the unpatched module
 * already assigns on any runtime with no global `TextDecoder`.
 *
 * ## Why these tests are shaped the way they are
 *
 * The failure happens **once, during module initialisation, on the first
 * load**. Asserting anything about `h3` in this process would prove nothing:
 * the test runner has already initialised it under Node's own `TextDecoder`.
 * So every runtime check here spawns a cold child process, installs a
 * Hermes-shaped `TextDecoder` before anything is required, loads the real
 * artifact the real bundler resolves, and runs real H3. Nothing is mocked, and
 * no expected value is read back from the library under test — the H3 indices
 * below are the same golden vectors the shared domain suite pins, and
 * `8928308280fffff` is H3's own documented example for that coordinate.
 *
 * Build success is not runtime initialisation proof for a native JavaScript
 * bundle. That is the whole lesson, and it is what this file exists to hold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

const MOBILE = process.cwd();
/** The Yarn workspace root, reached by name rather than by counting `..`. */
const REPO = join(MOBILE, "..");
/**
 * Where the installed package actually is, asked of Node rather than assumed to
 * be hoisted to the workspace root. Yarn nests a package the moment two
 * workspaces need different versions, and a guard pointed at an empty directory
 * would find no offending artifacts and call that a pass.
 */
const H3_PACKAGE = dirname(
  createRequire(join(REPO, "shared", "package.json")).resolve("h3-js/package.json"),
);
const PROBE = join(MOBILE, "src", "lib", "__tests__", "support", "hermesH3Probe.cjs");

const read = (path: string) => readFileSync(path, "utf8");

/* ── resolving the artifact the way each consumer resolves it ─────────────── */

/**
 * Where Node lands, asked from the workspace that declares the dependency.
 *
 * `shared` owns `h3-js`, and the backend reaches the same hoisted copy, so this
 * is the file that runs under Node in tests, in CI and in the API process.
 */
function nodeResolvedEntry(): string {
  const fromShared = createRequire(join(REPO, "shared", "package.json"));
  return fromShared.resolve("h3-js");
}

/**
 * Where Metro lands for the Android bundle.
 *
 * Resolution is *performed*, not remembered: the main-field order comes from
 * the project's own Expo Metro config, and the redirect from the package's own
 * `browser` map. Writing the answer down as a constant would have made this
 * guard agree with a stale belief instead of with the build.
 *
 * `@expo/metro-config` is not a declared dependency of this workspace — it
 * arrives with `expo`. That is deliberate: if it cannot be loaded then the
 * mobile bundle cannot be built either, and a test that quietly fell back to a
 * hardcoded field order would be claiming knowledge it no longer had.
 */
function metroResolvedEntry(): { entry: string; mainFields: string[] } {
  const fromMobile = createRequire(join(MOBILE, "package.json"));
  const { getDefaultConfig } = fromMobile("@expo/metro-config") as {
    getDefaultConfig: (root: string) => { resolver: { resolverMainFields: string[] } };
  };
  const mainFields = getDefaultConfig(MOBILE).resolver.resolverMainFields;

  const manifest = JSON.parse(read(join(H3_PACKAGE, "package.json"))) as Record<string, unknown>;
  let target: string | null = null;
  for (const field of mainFields) {
    const value = manifest[field];
    if (typeof value === "string") {
      target = value;
      break;
    }
  }
  assert.ok(target, `h3-js declares none of ${mainFields.join(", ")} as a file`);

  /* The object form of `browser` is a redirect table, not an entry point: it
     rewrites a resolved path to a different one. Metro applies it after the
     main field has chosen a file, which is how `main` ends up loading the
     browser build. */
  const browser = manifest.browser;
  if (browser && typeof browser === "object" && !Array.isArray(browser)) {
    const redirect = (browser as Record<string, string>)[`./${target.replace(/^\.\//, "")}`];
    if (typeof redirect === "string") target = redirect;
  }

  return { entry: join(H3_PACKAGE, target.replace(/^\.\//, "")), mainFields };
}

/* ── shipped artifacts ────────────────────────────────────────────────────── */

/** Every executable JavaScript file the package ships (source maps excluded). */
function shippedArtifacts(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) out.push(full);
    }
  };
  walk(join(H3_PACKAGE, "dist"));
  return out;
}

/**
 * A UTF-16 `TextDecoder` construction, in either the readable or the minified
 * spelling. Matched on the *construction*, not on the encoding name: a comment
 * or a variable may still mention UTF-16 — only building one is the crash.
 */
const UTF16_CONSTRUCTION = /new\s+TextDecoder\s*\(\s*["'`]\s*utf-?16/i;

/* ── the probe ────────────────────────────────────────────────────────────── */

interface ProbeReport {
  ok: boolean;
  /** The module body ran to completion — the thing that failed on the device. */
  loaded: boolean;
  /** Whether this artifact is the public H3 API rather than the raw runtime. */
  publicApi?: boolean;
  entry: string;
  rejectsUtf16le: { accepted: boolean; message: string | null };
  acceptsUtf8: { accepted: boolean; message: string | null };
  bengaluruRes8?: string;
  sanFranciscoRes9?: string;
  resolution?: number;
  isValid?: boolean;
  rejectsNonsense?: boolean;
  centerLat?: number;
  centerLng?: number;
  boundaryVertices?: number;
  diskSize?: number;
  diskContainsOrigin?: boolean;
  parentRes5?: string;
  pentagonCount?: number;
  error?: { name: string; message: string };
}

/** Load one artifact in a cold process under the Hermes model. */
function probe(entry: string): ProbeReport {
  const run = spawnSync(process.execPath, [PROBE, entry], { encoding: "utf8" });
  const line = run.stdout.trim().split("\n").pop() ?? "";
  assert.ok(
    line.startsWith("{"),
    `probe produced no report for ${entry}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
  );
  return JSON.parse(line) as ProbeReport;
}

/** The H3 answers, identical for every artifact because it is one library. */
function assertRealH3(report: ProbeReport, entry: string): void {
  const where = relative(REPO, entry);
  assert.equal(report.loaded, true, `${where} failed to initialise: ${JSON.stringify(report.error)}`);
  assert.equal(report.publicApi, true, `${where} is not the public H3 API`);
  assert.equal(report.ok, true, `${where} failed to compute: ${JSON.stringify(report.error)}`);
  assert.equal(report.bengaluruRes8, "8860145b49fffff", where);
  assert.equal(report.sanFranciscoRes9, "8928308280fffff", where);
  assert.equal(report.resolution, 8, where);
  assert.equal(report.isValid, true, where);
  assert.equal(report.rejectsNonsense, false, where);
  assert.ok(Math.abs((report.centerLat ?? 0) - 12.971003) < 1e-5, where);
  assert.ok(Math.abs((report.centerLng ?? 0) - 77.594484) < 1e-5, where);
  assert.equal(report.boundaryVertices, 6, where);
  assert.equal(report.diskSize, 7, where);
  assert.equal(report.diskContainsOrigin, true, where);
  assert.equal(report.parentRes5, "8560145bfffffff", where);
  assert.equal(report.pentagonCount, 12, where);
}

/* ── the model is real ────────────────────────────────────────────────────── */

test("the Hermes model rejects utf-16le with the message the device produced", () => {
  /* Without this the whole file could pass green while proving nothing: a shim
     that failed to install would let Node's own TextDecoder answer every call,
     and the unpatched dependency would load happily. */
  const report = probe(nodeResolvedEntry());
  assert.equal(report.rejectsUtf16le.accepted, false);
  assert.equal(
    report.rejectsUtf16le.message,
    "Unknown encoding: utf-16le (normalized: utf-16le)",
  );
});

test("the Hermes model still accepts the UTF-8 label h3-js keeps using", () => {
  /* h3-js constructs `new TextDecoder("utf8")` earlier in the same file than
     the line that crashed, so the device reached line 260 only by executing
     line 185 first. The engine accepts UTF-8; a model that rejected it would
     be testing a runtime that does not exist. */
  const report = probe(nodeResolvedEntry());
  assert.equal(report.acceptsUtf8.accepted, true, report.acceptsUtf8.message ?? "");
});

/* ── the fix, at the boundary that actually failed ────────────────────────── */

test("the Metro-resolved artifact initialises under Hermes and computes real H3", () => {
  const { entry } = metroResolvedEntry();
  assertRealH3(probe(entry), entry);
});

test("the Node-resolved artifact initialises under Hermes and computes real H3", () => {
  const entry = nodeResolvedEntry();
  assertRealH3(probe(entry), entry);
});

test("every shipped artifact that can be required initialises under Hermes", () => {
  /* The two entries above are the ones this repo loads today. These are the
     ones a different bundler, a web target or a direct path import could load
     tomorrow, and a package that still crashes down any of those routes is not
     fixed — it is fixed where we happened to look.

     Only *initialisation* is asserted, because that is all these have in
     common: `libh3-browser.js` is the raw Emscripten runtime the browser
     bundles were built from and exports no H3 functions at all, yet it carried
     the same fatal line. ES-module bundles cannot be `require`d and are covered
     by the static guard below instead. */
  const requirable = shippedArtifacts().filter(
    (f) => !f.endsWith(".es.js") && !f.endsWith("legacy.js") && !f.endsWith("print-bindings.js"),
  );
  assert.ok(requirable.length >= 3, `expected several requirable artifacts, saw ${requirable.length}`);
  for (const entry of requirable) {
    const report = probe(entry);
    assert.equal(
      report.loaded,
      true,
      `${relative(REPO, entry)} failed under Hermes: ${JSON.stringify(report.error)}`,
    );
  }
});

/* ── the artifact guard ───────────────────────────────────────────────────── */

test("no shipped h3-js artifact constructs a UTF-16 TextDecoder", () => {
  const offenders = shippedArtifacts()
    .filter((file) => UTF16_CONSTRUCTION.test(read(file)))
    .map((file) => relative(REPO, file));
  assert.deepEqual(
    offenders,
    [],
    "the Yarn patch did not reach these artifacts — the app will die at startup on Android",
  );
});

test("the artifact Metro resolves is one the patch covers, and is the browser build", () => {
  const { entry, mainFields } = metroResolvedEntry();
  assert.ok(
    mainFields.indexOf("browser") !== -1 && mainFields.indexOf("main") !== -1,
    `unexpected Metro main fields: ${mainFields.join(", ")}`,
  );
  assert.equal(
    relative(H3_PACKAGE, entry).split("\\").join("/"),
    "dist/browser/h3-js.js",
    "the Android bundle's h3-js entry moved; confirm the new file against a fresh " +
      "`expo export --dump-sourcemap` before trusting this suite again",
  );
  assert.ok(shippedArtifacts().includes(entry));
});

test("the UTF-8 decoder h3-js needs was left alone", () => {
  /* Substituting UTF-8 for UTF-16 would have been the wrong fix, but deleting
     the UTF-8 decoder as collateral would be a worse one: it is the decoder
     every H3 index string comes back through. */
  const survivors = shippedArtifacts().filter((f) => /new\s+TextDecoder\s*\(\s*["'`]utf-?8/i.test(read(f)));
  assert.ok(survivors.length >= 4, `UTF-8 decoders were removed too: ${survivors.length} left`);
});

/* ── the patch is recorded, not local ─────────────────────────────────────── */

function patchFile(): { name: string; body: string } {
  const dir = join(REPO, ".yarn", "patches");
  const names = readdirSync(dir).filter((n) => n.startsWith("h3-js") && n.endsWith(".patch"));
  assert.equal(names.length, 1, `expected exactly one h3-js patch, found: ${names.join(", ")}`);
  return { name: names[0], body: read(join(dir, names[0])) };
}

/** One changed line and its replacement, paired hunk by hunk. */
interface Replacement {
  file: string;
  removed: string;
  added: string;
}

function patchReplacements(body: string): Replacement[] {
  const out: Replacement[] = [];
  let file = "";
  let removed: string[] = [];
  let added: string[] = [];

  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    assert.equal(
      `${removed.length}/${added.length}`,
      "1/1",
      `${file}: a hunk changes ${removed.length} lines into ${added.length}; ` +
        "this patch is only ever meant to rewrite one line per artifact",
    );
    out.push({ file, removed: removed[0], added: added[0] });
    removed = [];
    added = [];
  };

  for (const line of body.split("\n")) {
    if (line.startsWith("+++ b/")) {
      flush();
      file = line.slice(6);
    } else if (line.startsWith("--- ") || line.startsWith("diff --git") || line.startsWith("index ")) {
      flush();
    } else if (line.startsWith("@@")) {
      flush();
    } else if (line.startsWith("-")) {
      removed.push(line.slice(1));
    } else if (line.startsWith("+")) {
      added.push(line.slice(1));
    }
  }
  flush();
  return out;
}

/**
 * The differing middle of two lines, once their common prefix and suffix are
 * removed.
 *
 * Two of the patched artifacts are minified, so a single changed line there is
 * two hundred kilobytes long and a diff of it is unreadable. Comparing whole
 * lines would let a patch delete half a bundle and still satisfy "the removed
 * line mentions a UTF-16 decoder". Comparing only the middles bounds the change
 * to the region that actually differs, whatever the line's length.
 */
function editedMiddle(removed: string, added: string): { removed: string; added: string } {
  let prefix = 0;
  while (prefix < removed.length && prefix < added.length && removed[prefix] === added[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < removed.length - prefix &&
    suffix < added.length - prefix &&
    removed[removed.length - 1 - suffix] === added[added.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    removed: removed.slice(prefix, removed.length - suffix),
    added: added.slice(prefix, added.length - suffix),
  };
}

/** Nothing this patch writes should be longer than the line it replaces plus a note. */
const MAX_EDIT_CHARS = 200;

test("the fix is a committed patch file, not an edit somebody made to node_modules", () => {
  const { body } = patchFile();
  const replacements = patchReplacements(body);
  assert.ok(replacements.length >= 4, `the patch rewrites only ${replacements.length} artifacts`);

  for (const { file, removed, added } of replacements) {
    const middle = editedMiddle(removed, added);
    assert.ok(
      middle.removed.length <= MAX_EDIT_CHARS && middle.added.length <= MAX_EDIT_CHARS,
      `${file}: the patch changes ${middle.removed.length} characters into ${middle.added.length}; ` +
        "a change this large is not the removal of one decoder construction",
    );
    assert.ok(
      UTF16_CONSTRUCTION.test(middle.removed),
      `${file}: the patch removes something that is not a UTF-16 decoder construction: ` +
        JSON.stringify(middle.removed),
    );
    assert.ok(
      !/TextDecoder/.test(middle.added),
      `${file}: the patch writes a new TextDecoder in place of the old one: ` +
        JSON.stringify(middle.added),
    );
  }
});

test("the lockfile resolves h3-js through that patch, so a clean install carries it", () => {
  const { name } = patchFile();
  const lock = read(join(REPO, "yarn.lock"));
  assert.ok(
    lock.includes(name),
    `yarn.lock does not mention ${name}; a fresh install would ship the unpatched package`,
  );
  assert.ok(
    /"h3-js@patch:[^"]+":\n {2}version: 4\.5\.0/.test(lock),
    "yarn.lock has no patched h3-js resolution",
  );
});

test("every workspace that depends on h3-js depends on the patched one", () => {
  const { name } = patchFile();
  const dependants = ["shared", "backend"];
  for (const workspace of dependants) {
    const manifest = JSON.parse(read(join(REPO, workspace, "package.json"))) as {
      dependencies?: Record<string, string>;
    };
    const range = manifest.dependencies?.["h3-js"];
    assert.ok(range, `${workspace} no longer depends on h3-js — update this guard`);
    assert.ok(
      range.startsWith("patch:") && range.includes(name),
      `${workspace} depends on unpatched h3-js (${range}); the Android build would crash`,
    );
  }
});

/* ── the runtime this file models is the runtime the app ships ────────────── */

test("the app still runs on Hermes, which is the engine everything above assumes", () => {
  /* Switching to JSC would make this whole file a model of a runtime the app no
     longer uses, and — worse — it would "fix" the crash by changing the engine
     rather than the bug, silently discarding every device result the app was
     validated against. Expo SDK 54 uses Hermes unless told otherwise, so an
     absent key is correct; only an explicit non-Hermes choice is a failure. */
  const expo = JSON.parse(read(join(MOBILE, "app.json"))).expo as {
    jsEngine?: string;
    android?: { jsEngine?: string };
  };
  for (const [where, engine] of [
    ["expo.jsEngine", expo.jsEngine],
    ["expo.android.jsEngine", expo.android?.jsEngine],
  ] as const) {
    assert.ok(
      engine === undefined || engine === "hermes",
      `${where} is "${engine}" — the H3 fix and its device validation are Hermes-specific`,
    );
  }
});

/* ── the removal plan points at something real ────────────────────────────── */

test("the compatibility note names the patch file that actually exists", () => {
  /* The note is how a future maintainer knows what to delete once upstream
     h3-js stops shipping the line. Yarn names a patch after the version and a
     content hash, so regenerating it — for a new h3-js, or a different edit —
     produces a different filename and leaves those instructions pointing at a
     file that is gone. This is the one thing about the prose worth enforcing. */
  const { name } = patchFile();
  const note = read(join(REPO, "docs", "HERMES_H3_COMPATIBILITY.md"));
  assert.ok(
    note.includes(name),
    `docs/HERMES_H3_COMPATIBILITY.md does not mention ${name}; its removal instructions are stale`,
  );
});
