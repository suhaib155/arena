#!/usr/bin/env node
/**
 * Deterministic test discovery runner (backend and shared).
 *
 * Why this exists: `node --test src/**\/*.test.ts` inside an npm script runs
 * under plain `sh` (dash on Linux CI), where `**` is just `*`. It matches one
 * directory level and silently skips everything deeper, so whole directories
 * of tests stopped running with no failure. Here the shell never expands
 * anything: the file list comes from a sorted filesystem walk, and the exact
 * count is printed before anything runs.
 *
 * Usage (run from the package directory):
 *   node ../scripts/run-tests.mjs [--category all|unit|db] [--dir src]
 *        [--strict] [--list] [--timeout-ms N] [--test-timeout-ms N]
 *
 * Categories are derived from the file itself, not from a hand-kept list:
 *   db    the file reads MOVENRUN_TEST_DATABASE_URL, so it needs a disposable
 *         PostgreSQL. Without the variable its database tests SKIP.
 *   unit  everything else; needs no database.
 *   all   unit, then db (the default, what `yarn test` runs).
 *
 * Skips are counted and listed separately; a skip is never reported as a pass.
 * `--strict` makes any skip a failure (use it where a database is provided).
 * The `db` category refuses to start without MOVENRUN_TEST_DATABASE_URL, and
 * runs one file at a time because some of those tests reset the schema of the
 * database they are given. Environment values are never printed.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DB_ENV = "MOVENRUN_TEST_DATABASE_URL";
const TEST_FILE = /\.test\.(?:ts|mts|cts|tsx|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

function parseArgs(argv) {
  const o = { category: "all", dir: "src", strict: false, list: false, timeoutMs: 15 * 60_000, testTimeoutMs: 120_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`); return argv[++i]; };
    if (a === "--category") o.category = val();
    else if (a === "--dir") o.dir = val();
    else if (a === "--strict") o.strict = true;
    else if (a === "--list") o.list = true;
    else if (a === "--timeout-ms") o.timeoutMs = Number(val());
    else if (a === "--test-timeout-ms") o.testTimeoutMs = Number(val());
    else fail(`unknown argument ${a}`);
  }
  if (!["all", "unit", "db"].includes(o.category)) fail(`unknown category ${o.category}`);
  if (!(o.timeoutMs > 0) || !(o.testTimeoutMs > 0)) fail("timeouts must be positive numbers");
  return o;
}

function fail(msg) {
  console.error(`run-tests: ${msg}`);
  process.exit(2);
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (e.isFile() && TEST_FILE.test(e.name)) out.push(p);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const root = process.cwd();
if (!existsSync(join(root, opts.dir)) || !statSync(join(root, opts.dir)).isDirectory()) fail(`no ${opts.dir}/ directory under the current package`);

const posix = (p) => relative(root, p).split(sep).join("/");
const files = walk(join(root, opts.dir), []).map(posix).sort();
const isDb = (f) => readFileSync(join(root, f), "utf8").includes(DB_ENV);
const groups = { unit: [], db: [] };
for (const f of files) groups[isDb(f) ? "db" : "unit"].push(f);

console.log(`run-tests: ${files.length} test files under ${opts.dir}/ (unit ${groups.unit.length}, db ${groups.db.length}); category=${opts.category}`);
if (opts.list) {
  for (const c of ["unit", "db"]) for (const f of groups[c]) console.log(`${c}\t${f}`);
  process.exit(0);
}
if (files.length === 0) fail("no test files discovered");

const dbConfigured = Boolean(process.env[DB_ENV]);
const phases = opts.category === "all" ? ["unit", "db"] : [opts.category];
if (phases.includes("db") && groups.db.length) {
  if (opts.category === "db" && !dbConfigured) fail(`category db needs ${DB_ENV} (a disposable local or service-container PostgreSQL)`);
  if (!dbConfigured) console.log(`run-tests: ${DB_ENV} is not set; the db category will report its database tests as SKIPPED, not passed`);
  if (dbConfigured && groups.db.includes("src/api/runtime.test.ts") && !existsSync(join(root, "dist", "api.cjs"))) {
    fail("src/api/runtime.test.ts needs the built API: run `yarn build` (or node scripts/build-api.mjs) first");
  }
}

function redact(line) {
  const v = process.env[DB_ENV];
  if (v) line = line.split(v).join("[redacted]");
  return line.replace(/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]*@/gi, "$1://[redacted]@");
}

function runPhase(name, list) {
  return new Promise((resolve) => {
    const args = ["--import", "tsx", "--test", "--test-reporter=tap", `--test-timeout=${opts.testTimeoutMs}`];
    if (name === "db") args.push("--test-concurrency=1");
    args.push(...list);
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const stats = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
    const skipped = [];
    let timedOut = false;
    let inFailure = false;
    let buf = "";
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs);
    const onLine = (line) => {
      const m = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
      if (m) stats[m[1]] = Number(m[2]);
      const s = /^\s*ok \d+ - (.*?) # SKIP\b\s*(.*)$/.exec(line);
      if (s) skipped.push(s[1]);
      if (/^\s*not ok /.test(line)) { console.log(line); inFailure = true; return; }
      if (/^\s*(ok \d+|# )/.test(line)) inFailure = false;
      // Print the diagnostic block of a failing test so CI logs say why,
      // with the database URL and any URL credentials removed.
      if (inFailure) console.log(redact(line));
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (buf) onLine(buf);
      resolve({ name, files: list.length, stats, skipped, code, signal, timedOut });
    });
  });
}

const results = [];
for (const name of phases) {
  const list = groups[name];
  if (!list.length) { results.push({ name, files: 0, stats: { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, skipped: [], code: 0 }); continue; }
  console.log(`\nrun-tests: phase ${name}: ${list.length} files`);
  results.push(await runPhase(name, list));
}

console.log("\nrun-tests summary");
let bad = false;
const total = { files: 0, tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 };
for (const r of results) {
  console.log(`  ${r.name.padEnd(5)} files ${r.files}  tests ${r.stats.tests}  pass ${r.stats.pass}  fail ${r.stats.fail}  cancelled ${r.stats.cancelled}  skipped ${r.stats.skipped}`);
  for (const k of Object.keys(total)) total[k] += k === "files" ? r.files : r.stats[k];
  if (r.timedOut) { console.error(`run-tests: phase ${r.name} exceeded ${opts.timeoutMs} ms and was killed`); bad = true; }
  else if (r.code !== 0 || r.stats.fail > 0 || r.stats.cancelled > 0) { console.error(`run-tests: phase ${r.name} failed (exit ${r.code ?? r.signal})`); bad = true; }
  else if (r.files > 0 && r.stats.tests === 0) { console.error(`run-tests: phase ${r.name} ran zero tests`); bad = true; }
}
console.log(`  total files ${total.files}  tests ${total.tests}  pass ${total.pass}  fail ${total.fail}  cancelled ${total.cancelled}  skipped ${total.skipped}`);
const skippedNames = results.flatMap((r) => r.skipped.map((n) => `${r.name}: ${n}`));
if (skippedNames.length) {
  console.log(`  SKIPPED (not passed): ${skippedNames.length}`);
  for (const n of skippedNames) console.log(`    - ${n}`);
  if (opts.strict) { console.error("run-tests: --strict: skips are failures"); bad = true; }
}
process.exit(bad ? 1 : 0);
